// PlayerDO: one Durable Object per friend code. It holds the player's nickname, friends list,
// pending friend requests and blocks, knows whether the player is online (any connected client),
// and pushes friend requests, invites and "your turn" to that player's open clients.
// No accounts: a random friend code plus a secret token (only its SHA-256 is stored).
import { DurableObject } from "cloudflare:workers";
import {
  type FriendView,
  MAX_CLIENT_MESSAGE,
  type PlayerClientMessage,
  type PlayerServerMessage,
  checkName,
  parsePlayerMessage,
} from "../../shared/src/protocol.js";
import { Bucket, closeSocket, sameSecret, send, sha256Hex } from "./util.js";

interface PlayerData {
  code: string;
  tokenHash: string;
  name: string;
  created: number;
  lastSeen: number;
  friends: Record<string, { name: string; since: number }>;
  incoming: Record<string, { name: string; at: number }>;
  outgoing: Record<string, number>;
  blocked: string[];
  /** Rooms this player sits in (room code -> until): "your turn" is only delivered for these. */
  watch: Record<string, number>;
}

interface Attachment {
  authed: boolean;
  at: number;
}

const MAX_FRIENDS = 200;
const MAX_PENDING = 50;
const MAX_BLOCKED = 200;
const MAX_WATCH = 20;
const MAX_SOCKETS = 8;
const WATCH_MS = 3 * 3600_000;
const AUTH_TIMEOUT_MS = 10_000;
/** Players who never come back are forgotten after about a year. */
const FORGET_AFTER_MS = 400 * 24 * 3600_000;

export type RequestResult = { status: "sent" | "accepted" | "not-found" | "full"; name?: string; online?: boolean };

function attachmentOf(ws: WebSocket): Attachment {
  return (ws.deserializeAttachment() as Attachment | null) ?? { authed: false, at: 0 };
}

export class PlayerDO extends DurableObject<Env> {
  private data: PlayerData | null = null;
  /** Friends' online state as last reported to us. */
  private readonly presence = new Map<string, boolean>();
  private presenceLoaded = false;
  private readonly buckets = new WeakMap<WebSocket, Bucket>();
  private readonly inviteBuckets = new WeakMap<WebSocket, Bucket>();
  private readonly closing = new WeakSet<WebSocket>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      this.data = (await ctx.storage.get<PlayerData>("player")) ?? null;
    });
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
  }

  // ------------------------------------------------------------------ RPC from the Worker and other objects

  /** Claims this friend code for a new player. False if it's taken. */
  async register(code: string, tokenHash: string): Promise<boolean> {
    if (this.data) return false;
    const now = Date.now();
    this.data = { code, tokenHash, name: "Player", created: now, lastSeen: now, friends: {}, incoming: {}, outgoing: {}, blocked: [], watch: {} };
    await this.save();
    await this.ctx.storage.setAlarm(now + FORGET_AFTER_MS);
    return true;
  }

  async friendRequest(from: string, name: string, fromOnline: boolean): Promise<RequestResult> {
    const d = this.data;
    if (!d || from === d.code) return { status: "not-found" };
    if (d.blocked.includes(from)) return { status: "sent" }; // never reveal a block
    const online = this.authedSockets().length > 0;
    if (d.friends[from]) {
      d.friends[from]!.name = name;
      await this.save();
      return { status: "accepted", name: d.name, online };
    }
    if (d.outgoing[from] !== undefined) {
      // Both asked: that's a yes from both sides.
      delete d.outgoing[from];
      d.friends[from] = { name, since: Date.now() };
      this.presence.set(from, fromOnline);
      await this.save();
      this.push({ t: "friend", friend: { code: from, name, online: fromOnline } });
      return { status: "accepted", name: d.name, online };
    }
    if (d.incoming[from]) return { status: "sent" };
    if (Object.keys(d.incoming).length >= MAX_PENDING || Object.keys(d.friends).length >= MAX_FRIENDS) return { status: "full" };
    d.incoming[from] = { name, at: Date.now() };
    await this.save();
    this.push({ t: "request", code: from, name });
    return { status: "sent" };
  }

  async friendAccepted(from: string, name: string, fromOnline: boolean): Promise<boolean> {
    const d = this.data;
    if (!d || d.outgoing[from] === undefined) return false;
    delete d.outgoing[from];
    d.friends[from] = { name, since: Date.now() };
    this.presence.set(from, fromOnline);
    await this.save();
    this.push({ t: "friend", friend: { code: from, name, online: fromOnline } });
    this.push({ t: "info", code: "accepted", message: `${name} accepted your friend request.` });
    return this.authedSockets().length > 0;
  }

  async friendRemoved(from: string): Promise<void> {
    const d = this.data;
    if (!d) return;
    const had = !!d.friends[from] || !!d.incoming[from] || d.outgoing[from] !== undefined;
    delete d.friends[from];
    delete d.incoming[from];
    delete d.outgoing[from];
    this.presence.delete(from);
    if (!had) return;
    await this.save();
    this.push({ t: "unfriend", code: from });
  }

  async presenceChanged(from: string, online: boolean): Promise<void> {
    if (!this.data?.friends[from]) return;
    this.presence.set(from, online);
    this.push({ t: "presence", code: from, online });
  }

  async isOnline(): Promise<boolean> {
    return this.authedSockets().length > 0;
  }

  async invite(from: string, name: string, room: string): Promise<"sent" | "offline" | "not-friend"> {
    const d = this.data;
    if (!d || !d.friends[from] || d.blocked.includes(from)) return "not-friend";
    if (this.authedSockets().length === 0) return "offline";
    this.push({ t: "invite", from, name, room });
    return "sent";
  }

  async roomTurn(room: string): Promise<void> {
    const d = this.data;
    if (!d) return;
    const until = d.watch[room];
    if (until === undefined || until < Date.now()) return;
    this.push({ t: "turn", room });
  }

  // ------------------------------------------------------------------ sockets

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
    const now = Date.now();
    const sockets = this.ctx.getWebSockets().filter((s) => !this.closing.has(s));
    for (const ws of sockets) {
      const a = attachmentOf(ws);
      if (!a.authed && now - a.at > AUTH_TIMEOUT_MS) this.drop(ws, 4408, "Sign-in timeout");
    }
    if (sockets.length >= MAX_SOCKETS) return new Response("Too many connections", { status: 429 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ authed: false, at: now } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string" || message.length > MAX_CLIENT_MESSAGE) {
      this.drop(ws, 1009, "Message too big");
      return;
    }
    let bucket = this.buckets.get(ws);
    if (!bucket) {
      bucket = new Bucket(10, 3);
      this.buckets.set(ws, bucket);
    }
    if (!bucket.take()) {
      this.reply(ws, { t: "error", code: "slow-down", message: "Slow down a little." });
      return;
    }
    const msg = parsePlayerMessage(message);
    if (!msg) {
      this.reply(ws, { t: "error", code: "bad-message", message: "That message wasn't understood." });
      return;
    }
    const att = attachmentOf(ws);
    if (!att.authed) {
      if (msg.t !== "auth") {
        this.drop(ws, 1008, "Sign in first");
        return;
      }
      await this.auth(ws, msg);
      return;
    }
    if (msg.t === "auth") return;
    await this.handle(ws, msg);
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    await this.onGone(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.onGone(ws);
  }

  private async onGone(ws: WebSocket): Promise<void> {
    if (this.closing.has(ws)) return;
    const wasAuthed = attachmentOf(ws).authed;
    this.closing.add(ws);
    closeSocket(ws, 1000, "Bye");
    if (wasAuthed && this.authedSockets().length === 0) await this.announce(false);
  }

  private drop(ws: WebSocket, code: number, reason: string): void {
    this.closing.add(ws);
    closeSocket(ws, code, reason);
  }

  private authedSockets(): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => !this.closing.has(ws) && attachmentOf(ws).authed);
  }

  private reply(ws: WebSocket, msg: PlayerServerMessage): void {
    send(ws, msg);
  }

  private push(msg: PlayerServerMessage): void {
    const text = JSON.stringify(msg);
    for (const ws of this.authedSockets()) {
      try {
        ws.send(text);
      } catch {
        // closed meanwhile
      }
    }
  }

  private stub(code: string) {
    return this.env.PLAYERS.get(this.env.PLAYERS.idFromName(code));
  }

  /** Tells every friend whether we're online now. */
  private async announce(online: boolean): Promise<void> {
    const d = this.data;
    if (!d) return;
    const me = d.code;
    await Promise.allSettled(Object.keys(d.friends).map((code) => this.stub(code).presenceChanged(me, online)));
  }

  private async auth(ws: WebSocket, msg: Extract<PlayerClientMessage, { t: "auth" }>): Promise<void> {
    const d = this.data;
    if (!d) {
      this.reply(ws, { t: "error", code: "unknown", message: "This friend code isn't registered." });
      this.drop(ws, 4404, "Unknown player");
      return;
    }
    if (!sameSecret(await sha256Hex(msg.token), d.tokenHash)) {
      this.reply(ws, { t: "error", code: "auth", message: "Sign-in failed." });
      this.drop(ws, 4401, "Sign-in failed");
      return;
    }
    const firstClient = this.authedSockets().length === 0;
    ws.serializeAttachment({ authed: true, at: Date.now() } satisfies Attachment);
    const name = checkName(msg.name);
    if (name.ok) d.name = name.name;
    d.lastSeen = Date.now();
    this.pruneWatch();
    await this.save();
    await this.ctx.storage.setAlarm(Date.now() + FORGET_AFTER_MS);
    if (!this.presenceLoaded || firstClient) await this.loadPresence();
    this.reply(ws, this.me());
    if (firstClient) await this.announce(true);
  }

  private async loadPresence(): Promise<void> {
    const d = this.data!;
    const codes = Object.keys(d.friends);
    const results = await Promise.allSettled(codes.map((code) => this.stub(code).isOnline()));
    results.forEach((r, i) => this.presence.set(codes[i]!, r.status === "fulfilled" && r.value === true));
    this.presenceLoaded = true;
  }

  private me(): PlayerServerMessage {
    const d = this.data!;
    const friends: FriendView[] = Object.entries(d.friends)
      .map(([code, f]) => ({ code, name: f.name, online: this.presence.get(code) ?? false }))
      .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
    return {
      t: "me",
      code: d.code,
      name: d.name,
      friends,
      incoming: Object.entries(d.incoming).map(([code, r]) => ({ code, name: r.name })),
      outgoing: Object.keys(d.outgoing),
      blocked: [...d.blocked],
    };
  }

  private pushMe(): void {
    this.push(this.me());
  }

  private pruneWatch(): void {
    const d = this.data!;
    const now = Date.now();
    for (const [room, until] of Object.entries(d.watch)) if (until < now) delete d.watch[room];
  }

  private async handle(ws: WebSocket, msg: PlayerClientMessage): Promise<void> {
    const d = this.data!;
    switch (msg.t) {
      case "name": {
        const name = checkName(msg.name);
        if (!name.ok) {
          this.reply(ws, { t: "error", code: "bad-name", message: name.error });
          return;
        }
        d.name = name.name;
        await this.save();
        this.pushMe();
        return;
      }
      case "add": {
        const code = msg.code;
        if (code === d.code) {
          this.reply(ws, { t: "error", code: "self", message: "That's your own friend code." });
          return;
        }
        if (d.friends[code]) {
          this.reply(ws, { t: "info", code: "already", message: "You're already friends." });
          return;
        }
        if (d.blocked.includes(code)) {
          this.reply(ws, { t: "error", code: "blocked", message: "Unblock this player first." });
          return;
        }
        if (d.incoming[code]) return this.handle(ws, { t: "accept", code });
        if (Object.keys(d.outgoing).length >= MAX_PENDING || Object.keys(d.friends).length >= MAX_FRIENDS) {
          this.reply(ws, { t: "error", code: "full", message: "Too many pending requests or friends." });
          return;
        }
        const result = await this.stub(code).friendRequest(d.code, d.name, true);
        if (result.status === "not-found") {
          this.reply(ws, { t: "error", code: "not-found", message: "No player has that friend code." });
          return;
        }
        if (result.status === "full") {
          this.reply(ws, { t: "error", code: "full", message: "That player can't take more friend requests right now." });
          return;
        }
        if (result.status === "accepted") {
          d.friends[code] = { name: result.name ?? "Friend", since: Date.now() };
          delete d.outgoing[code];
          this.presence.set(code, result.online ?? false);
        } else {
          d.outgoing[code] = Date.now();
          this.reply(ws, { t: "info", code: "sent", message: "Friend request sent." });
        }
        await this.save();
        this.pushMe();
        return;
      }
      case "accept": {
        const req = d.incoming[msg.code];
        if (!req) return;
        delete d.incoming[msg.code];
        d.friends[msg.code] = { name: req.name, since: Date.now() };
        await this.save();
        const online = await this.stub(msg.code).friendAccepted(d.code, d.name, true).catch(() => false);
        this.presence.set(msg.code, online);
        this.pushMe();
        return;
      }
      case "decline": {
        if (!d.incoming[msg.code]) return;
        delete d.incoming[msg.code];
        await this.save();
        this.pushMe();
        return;
      }
      case "remove": {
        delete d.friends[msg.code];
        delete d.incoming[msg.code];
        delete d.outgoing[msg.code];
        this.presence.delete(msg.code);
        await this.save();
        await this.stub(msg.code).friendRemoved(d.code).catch(() => undefined);
        this.pushMe();
        return;
      }
      case "block": {
        if (msg.code === d.code) return;
        delete d.friends[msg.code];
        delete d.incoming[msg.code];
        delete d.outgoing[msg.code];
        this.presence.delete(msg.code);
        if (!d.blocked.includes(msg.code)) d.blocked.push(msg.code);
        if (d.blocked.length > MAX_BLOCKED) d.blocked.shift();
        await this.save();
        await this.stub(msg.code).friendRemoved(d.code).catch(() => undefined);
        this.pushMe();
        return;
      }
      case "unblock": {
        d.blocked = d.blocked.filter((c) => c !== msg.code);
        await this.save();
        this.pushMe();
        return;
      }
      case "invite": {
        let bucket = this.inviteBuckets.get(ws);
        if (!bucket) {
          bucket = new Bucket(4, 0.25);
          this.inviteBuckets.set(ws, bucket);
        }
        if (!bucket.take()) {
          this.reply(ws, { t: "error", code: "slow-down", message: "Wait a moment before sending more invites." });
          return;
        }
        if (!d.friends[msg.code]) {
          this.reply(ws, { t: "error", code: "not-friend", message: "You can only invite friends." });
          return;
        }
        const result = await this.stub(msg.code).invite(d.code, d.name, msg.room).catch(() => "offline" as const);
        if (result === "sent") this.reply(ws, { t: "info", code: "invited", message: `Invite sent to ${d.friends[msg.code]!.name}.` });
        else if (result === "offline") this.reply(ws, { t: "error", code: "offline", message: `${d.friends[msg.code]!.name} is offline right now.` });
        else this.reply(ws, { t: "error", code: "not-friend", message: "You can only invite friends." });
        return;
      }
      case "watch": {
        this.pruneWatch();
        d.watch[msg.room] = Date.now() + WATCH_MS;
        const rooms = Object.entries(d.watch).sort((a, b) => b[1] - a[1]);
        for (const [room] of rooms.slice(MAX_WATCH)) delete d.watch[room];
        await this.save();
        return;
      }
      case "auth":
        return;
    }
  }

  private async save(): Promise<void> {
    if (this.data) await this.ctx.storage.put("player", this.data);
  }

  /** Not seen for about a year: delete everything about this player. */
  override async alarm(): Promise<void> {
    const d = this.data;
    if (!d) return;
    if (Date.now() - d.lastSeen < FORGET_AFTER_MS - 60_000 || this.authedSockets().length > 0) {
      await this.ctx.storage.setAlarm(d.lastSeen + FORGET_AFTER_MS);
      return;
    }
    const me = d.code;
    await Promise.allSettled(Object.keys(d.friends).map((code) => this.stub(code).friendRemoved(me)));
    this.data = null;
    await this.ctx.storage.deleteAll();
  }
}
