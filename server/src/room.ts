// RoomDO: one Durable Object per room code. It owns the game: it rolls the dice, checks every
// intent against the rules engine, runs the turn timer and the bots, and tells every connected
// client what happened. Clients never send positions or dice values, only "roll" and "move token k".
import { DurableObject } from "cloudflare:workers";
import { COLORS } from "../../shared/src/board.js";
import { type BotLevel, chooseToken } from "../../shared/src/bot.js";
import { type GameEvent, type GameState, type Mode, RuleError, applyMove, applyRoll, createGame, onlyOneChoice } from "../../shared/src/engine.js";
import {
  MAX_CLIENT_MESSAGE,
  type RoomClientMessage,
  type RoomServerMessage,
  type RoomView,
  checkName,
  newSecret,
  parseRoomMessage,
  randomIndex,
  rollDie,
} from "../../shared/src/protocol.js";
import { Bucket, type Settings, closeSocket, sameSecret, send, settingsFrom, sha256Hex } from "./util.js";

interface Seat {
  kind: "empty" | "human" | "bot";
  name: string;
  ready: boolean;
  bot: BotLevel | null;
  /** SHA-256 of the seat secret (lets the same player reconnect to this seat). */
  secretHash: string | null;
  friend: string | null;
  /** A bot plays this human's turns until they're back. */
  away: boolean;
  /** Turns in a row the timer ran out. */
  missed: number;
  /** Lost connection: when the bot takes over (game) or the seat is freed (lobby). */
  graceUntil: number | null;
}

interface RoomData {
  code: string;
  created: number;
  lastActive: number;
  phase: "lobby" | "playing" | "over";
  host: number | null;
  mode: Mode;
  teams: boolean;
  seats: Seat[];
  game: GameState | null;
  /** Counts game actions; the turn timer restarts when it changes. */
  step: number;
  planStep: number;
  actAt: number | null;
  actKind: "bot" | "timeout" | null;
  notifiedTurn: number;
}

interface Attachment {
  seat: number | null;
  joined: boolean;
  at: number;
}

class RoomError extends Error {}

const MAX_SOCKETS = 16;
const JOIN_TIMEOUT_MS = 10_000;
/** Seats handed out in this order, so two players sit in opposite corners. */
const SEAT_ORDER = [0, 2, 1, 3];

function emptySeat(): Seat {
  return { kind: "empty", name: "", ready: false, bot: null, secretHash: null, friend: null, away: false, missed: 0, graceUntil: null };
}

function attachmentOf(ws: WebSocket): Attachment {
  return (ws.deserializeAttachment() as Attachment | null) ?? { seat: null, joined: false, at: 0 };
}

function botName(color: number, level: BotLevel): string {
  const name = COLORS[color]!;
  return `${name[0]!.toUpperCase()}${name.slice(1)} bot${level === "easy" ? " (easy)" : ""}`;
}

export class RoomDO extends DurableObject<Env> {
  private data: RoomData | null = null;
  private readonly settings: Settings;
  private readonly buckets = new WeakMap<WebSocket, Bucket>();
  private readonly reactBuckets = new WeakMap<WebSocket, Bucket>();
  private readonly strikes = new WeakMap<WebSocket, number>();
  private readonly closing = new WeakSet<WebSocket>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.settings = settingsFrom(env);
    void ctx.blockConcurrencyWhile(async () => {
      this.data = (await ctx.storage.get<RoomData>("room")) ?? null;
    });
    // Keep-alive pings are answered without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
  }

  // ------------------------------------------------------------------ called by the Worker

  /** Sets up a new room under a freshly drawn code. Returns false if the code is in use. */
  async create(code: string): Promise<boolean> {
    const now = Date.now();
    if (this.data) {
      if (this.data.lastActive + this.settings.roomTtlMs > now) return false;
      await this.expire();
    }
    this.data = {
      code,
      created: now,
      lastActive: now,
      phase: "lobby",
      host: null,
      mode: "classic",
      teams: false,
      seats: [emptySeat(), emptySeat(), emptySeat(), emptySeat()],
      game: null,
      step: 0,
      planStep: -1,
      actAt: null,
      actKind: null,
      notifiedTurn: 0,
    };
    await this.save();
    await this.schedule();
    return true;
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
    const sockets = this.ctx.getWebSockets();
    this.sweepUnjoined(sockets);
    if (sockets.filter((s) => !this.closing.has(s)).length >= MAX_SOCKETS) return new Response("Room is full", { status: 429 });
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ seat: null, joined: false, at: Date.now() } satisfies Attachment);
    if (this.data) await this.schedule(); // makes sure an unjoined socket gets swept
    return new Response(null, { status: 101, webSocket: client });
  }

  // ------------------------------------------------------------------ sockets

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string" || message.length > MAX_CLIENT_MESSAGE) {
      this.reply(ws, { t: "error", code: "too-big", message: "Message too big." });
      closeSocket(ws, 1009, "Message too big");
      return;
    }
    let bucket = this.buckets.get(ws);
    if (!bucket) {
      bucket = new Bucket(12, 6);
      this.buckets.set(ws, bucket);
    }
    if (!bucket.take()) {
      this.strike(ws, "slow-down", "Slow down a little.");
      return;
    }
    const msg = parseRoomMessage(message);
    if (!msg) {
      this.strike(ws, "bad-message", "That message wasn't understood.");
      return;
    }
    if (!this.data) {
      this.reply(ws, { t: "error", code: "no-room", message: "This room doesn't exist or has expired." });
      closeSocket(ws, 4404, "No such room");
      return;
    }
    const att = attachmentOf(ws);
    if (!att.joined && msg.t !== "join") {
      this.reply(ws, { t: "error", code: "join-first", message: "Join the room first." });
      return;
    }
    if (att.joined && msg.t === "join") {
      this.reply(ws, { t: "error", code: "already-joined", message: "Already in this room." });
      return;
    }
    try {
      await this.handle(ws, att, msg);
    } catch (e) {
      if (e instanceof RuleError || e instanceof RoomError) {
        this.reply(ws, { t: "error", code: "rule", message: e.message });
        return;
      }
      throw e;
    }
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    await this.dropSocket(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.dropSocket(ws);
  }

  private async dropSocket(ws: WebSocket): Promise<void> {
    if (this.closing.has(ws)) return;
    this.closing.add(ws);
    closeSocket(ws, 1000, "Bye");
    const d = this.data;
    if (!d) return;
    const att = attachmentOf(ws);
    if (!att.joined || att.seat === null) {
      if (att.joined) this.broadcast({ t: "room", room: this.view() }); // spectator count
      return;
    }
    if (!this.seatOnline(att.seat)) {
      const seat = d.seats[att.seat]!;
      if (seat.kind === "human" && !seat.away) seat.graceUntil = Date.now() + this.settings.graceMs;
    }
    await this.commit([]);
  }

  private strike(ws: WebSocket, code: string, message: string): void {
    const n = (this.strikes.get(ws) ?? 0) + 1;
    this.strikes.set(ws, n);
    this.reply(ws, { t: "error", code, message });
    if (n >= 8) closeSocket(ws, 1008, "Too many bad messages");
  }

  private reply(ws: WebSocket, msg: RoomServerMessage): void {
    send(ws, msg);
  }

  private broadcast(msg: RoomServerMessage): void {
    const text = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (this.closing.has(ws) || !attachmentOf(ws).joined) continue;
      try {
        ws.send(text);
      } catch {
        // closed meanwhile
      }
    }
  }

  private seatOnline(seat: number): boolean {
    for (const ws of this.ctx.getWebSockets()) {
      if (this.closing.has(ws)) continue;
      const a = attachmentOf(ws);
      if (a.joined && a.seat === seat) return true;
    }
    return false;
  }

  private anyHumanOnline(): boolean {
    const d = this.data!;
    return d.seats.some((s, i) => s.kind === "human" && this.seatOnline(i));
  }

  private sweepUnjoined(sockets: WebSocket[]): void {
    const now = Date.now();
    for (const ws of sockets) {
      const a = attachmentOf(ws);
      if (!a.joined && a.at > 0 && now - a.at > JOIN_TIMEOUT_MS && !this.closing.has(ws)) {
        this.closing.add(ws);
        send(ws, { t: "bye", reason: "join-timeout" } satisfies RoomServerMessage);
        closeSocket(ws, 4408, "Join timeout");
      }
    }
  }

  // ------------------------------------------------------------------ intents

  private async handle(ws: WebSocket, att: Attachment, msg: RoomClientMessage): Promise<void> {
    const d = this.data!;
    if (msg.t === "join") return this.join(ws, msg);
    if (msg.t === "leave") return this.leave(ws, att);
    if (att.seat === null) throw new RoomError("Spectators can watch but not play.");
    const me = att.seat;
    const seat = d.seats[me]!;
    d.lastActive = Date.now();

    switch (msg.t) {
      case "seat": {
        this.requirePhase("lobby");
        const target = msg.c;
        if (target === me) return;
        if (d.seats[target]!.kind !== "empty") throw new RoomError("That colour is taken.");
        d.seats[target] = seat;
        d.seats[me] = emptySeat();
        for (const other of this.ctx.getWebSockets()) {
          const a = attachmentOf(other);
          if (a.seat === me) {
            other.serializeAttachment({ ...a, seat: target });
            send(other, { t: "you", you: target } satisfies RoomServerMessage);
          }
        }
        if (d.host === me) d.host = target;
        return this.commit([]);
      }
      case "ready":
        this.requirePhase("lobby");
        seat.ready = msg.v;
        return this.commit([]);
      case "bot": {
        this.requirePhase("lobby");
        this.requireHost(me);
        const target = d.seats[msg.c]!;
        if (target.kind === "human") throw new RoomError("That seat has a player.");
        d.seats[msg.c] = msg.level === null ? emptySeat() : { ...emptySeat(), kind: "bot", name: botName(msg.c, msg.level), ready: true, bot: msg.level };
        return this.commit([]);
      }
      case "config":
        this.requirePhase("lobby");
        this.requireHost(me);
        d.mode = msg.mode;
        d.teams = msg.teams;
        return this.commit([]);
      case "start":
        this.requirePhase("lobby");
        this.requireHost(me);
        return this.start();
      case "roll": {
        this.requireTurn(me, "roll");
        this.welcomeBack(seat);
        return this.commit(this.doRoll());
      }
      case "move": {
        this.requireTurn(me, "move");
        this.welcomeBack(seat);
        return this.commit(this.doMove(msg.k));
      }
      case "react": {
        let bucket = this.reactBuckets.get(ws);
        if (!bucket) {
          bucket = new Bucket(3, 0.8);
          this.reactBuckets.set(ws, bucket);
        }
        if (!bucket.take()) return;
        this.broadcast({ t: "react", c: me, r: msg.r });
        return;
      }
      case "back":
        this.welcomeBack(seat);
        return this.commit([]);
      case "rematch":
        this.requirePhase("over");
        this.requireHost(me);
        return this.rematch();
    }
  }

  private requirePhase(phase: RoomData["phase"]): void {
    if (this.data!.phase !== phase) throw new RoomError(phase === "lobby" ? "The game has already started." : "Not now.");
  }

  private requireHost(seat: number): void {
    if (this.data!.host !== seat) throw new RoomError("Only the host can do that.");
  }

  private requireTurn(seat: number, phase: "roll" | "move"): void {
    const d = this.data!;
    const g = d.game;
    if (d.phase !== "playing" || !g) throw new RoomError("The game isn't running.");
    if (g.turn !== seat) throw new RoomError("It's not your turn.");
    if (g.phase !== phase) throw new RoomError(phase === "roll" ? "Move a token first." : "Roll the dice first.");
  }

  private welcomeBack(seat: Seat): void {
    seat.away = false;
    seat.missed = 0;
    seat.graceUntil = null;
  }

  private async join(ws: WebSocket, msg: Extract<RoomClientMessage, { t: "join" }>): Promise<void> {
    const d = this.data!;
    const name = checkName(msg.name);
    if (!name.ok) {
      this.reply(ws, { t: "error", code: "bad-name", message: name.error });
      return;
    }
    let you: number | null = null;
    let secret: string | null = null;

    if (msg.secret) {
      const hash = await sha256Hex(msg.secret);
      const found = d.seats.findIndex((s) => s.kind === "human" && s.secretHash !== null && sameSecret(s.secretHash, hash));
      if (found >= 0) {
        you = found;
        const seat = d.seats[found]!;
        this.welcomeBack(seat);
        if (d.phase === "lobby") seat.name = name.name;
        if (msg.friend) seat.friend = msg.friend;
        // The same player opened the room again somewhere else: the newest connection wins.
        for (const other of this.ctx.getWebSockets()) {
          if (other === ws || this.closing.has(other)) continue;
          if (attachmentOf(other).seat === found) {
            this.closing.add(other);
            send(other, { t: "bye", reason: "replaced" } satisfies RoomServerMessage);
            closeSocket(other, 4000, "Opened somewhere else");
          }
        }
      }
    }

    if (you === null && d.phase === "lobby") {
      // Hash first: nothing may await between choosing a free seat and taking it.
      const fresh = newSecret(18);
      const freshHash = await sha256Hex(fresh);
      const free = SEAT_ORDER.find((i) => d.seats[i]!.kind === "empty");
      if (free !== undefined && d.phase === "lobby") {
        secret = fresh;
        d.seats[free] = { ...emptySeat(), kind: "human", name: name.name, secretHash: freshHash, friend: msg.friend ?? null };
        you = free;
      }
    }
    if (you !== null && (d.host === null || d.seats[d.host]?.kind !== "human")) d.host = you;
    d.lastActive = Date.now();

    ws.serializeAttachment({ seat: you, joined: true, at: Date.now() } satisfies Attachment);
    this.reply(ws, { t: "welcome", you, secret, room: this.view() });
    await this.commit([]);
  }

  private async leave(ws: WebSocket, att: Attachment): Promise<void> {
    const d = this.data!;
    this.closing.add(ws);
    if (att.seat !== null && att.joined) {
      if (d.phase === "lobby") {
        d.seats[att.seat] = emptySeat();
      } else {
        const seat = d.seats[att.seat]!;
        seat.away = true; // a bot finishes the game for them (they can still come back)
        seat.graceUntil = null;
      }
      if (d.host === att.seat) d.host = this.nextHost(att.seat);
    }
    send(ws, { t: "bye", reason: "left" } satisfies RoomServerMessage);
    closeSocket(ws, 1000, "Left");
    await this.commit([]);
  }

  private nextHost(except: number): number | null {
    const d = this.data!;
    const humans = [0, 1, 2, 3].filter((i) => i !== except && d.seats[i]!.kind === "human");
    return humans.find((i) => this.seatOnline(i)) ?? humans[0] ?? null;
  }

  private async start(): Promise<void> {
    const d = this.data!;
    const occupied = [0, 1, 2, 3].filter((i) => d.seats[i]!.kind !== "empty");
    if (occupied.length < 2) throw new RoomError("Add at least one more player or a bot.");
    if (d.teams && occupied.length !== 4) throw new RoomError("2 vs 2 needs all four seats (bots count).");
    if (occupied.some((i) => d.seats[i]!.kind === "human" && i !== d.host && !d.seats[i]!.ready))
      throw new RoomError("Waiting for everyone to be ready.");
    const first = occupied[randomIndex(occupied.length, () => crypto.getRandomValues(new Uint8Array(8)))]!;
    d.game = createGame({ mode: d.mode, teams: d.teams, seats: occupied }, first);
    d.phase = "playing";
    d.step++;
    d.notifiedTurn = 0;
    const now = Date.now();
    for (const [i, seat] of d.seats.entries()) {
      seat.away = false;
      seat.missed = 0;
      seat.graceUntil = seat.kind === "human" && !this.seatOnline(i) ? now + this.settings.graceMs : null;
    }
    await this.commit([{ e: "turn", c: first }]);
  }

  private async rematch(): Promise<void> {
    const d = this.data!;
    d.phase = "lobby";
    d.game = null;
    d.actAt = null;
    d.actKind = null;
    const now = Date.now();
    for (const [i, seat] of d.seats.entries()) {
      if (seat.kind !== "human") continue;
      seat.ready = false;
      seat.away = false;
      seat.missed = 0;
      seat.graceUntil = this.seatOnline(i) ? null : now + this.settings.graceMs;
    }
    await this.commit([]);
  }

  // ------------------------------------------------------------------ game steps

  private doRoll(): GameEvent[] {
    const d = this.data!;
    const r = applyRoll(d.game!, rollDie());
    d.game = r.state;
    d.step++;
    let events = r.events;
    // No real choice (one token, or only identical tokens in the yard): play it right away.
    if (onlyOneChoice(d.game)) {
      const m = applyMove(d.game, d.game.movable[0]!);
      d.game = m.state;
      events = events.concat(m.events);
    }
    return events;
  }

  private doMove(token: number): GameEvent[] {
    const d = this.data!;
    const r = applyMove(d.game!, token);
    d.game = r.state;
    d.step++;
    return r.events;
  }

  /** The timer ran out or a bot is to play: one step for bots, the whole turn step for a late human. */
  private autoAct(): GameEvent[] {
    const d = this.data!;
    const g = d.game!;
    const seat = d.seats[g.turn]!;
    const level: BotLevel = seat.kind === "bot" ? (seat.bot ?? "normal") : "normal";
    const events: GameEvent[] = [];
    const kind = d.actKind;
    d.actAt = null;
    d.actKind = null;
    if (kind === "timeout") {
      seat.missed++;
      if (seat.missed >= 2) seat.away = true;
      const turn = g.turn;
      if (d.game!.phase === "roll") events.push(...this.doRoll());
      if (d.game!.phase === "move" && d.game!.turn === turn) events.push(...this.doMove(chooseToken(d.game!, "normal", Math.random)));
    } else if (g.phase === "roll") {
      events.push(...this.doRoll());
    } else if (g.phase === "move") {
      events.push(...this.doMove(chooseToken(g, level, Math.random)));
    }
    return events;
  }

  /** Decides who acts next and when (bots after a short pause, humans before their timer runs out). */
  private planTurn(): void {
    const d = this.data!;
    const g = d.game;
    if (d.phase !== "playing" || !g || g.phase === "over" || !this.anyHumanOnline()) {
      // Finished, or nobody is watching: pause (bots don't play to an empty room).
      d.actAt = null;
      d.actKind = null;
      d.planStep = -1;
      return;
    }
    const seat = d.seats[g.turn]!;
    const kind = seat.kind === "bot" || seat.away ? "bot" : "timeout";
    if (d.planStep !== d.step || d.actKind !== kind || d.actAt === null) {
      const delay = kind === "bot" ? (g.phase === "move" ? Math.round(this.settings.botDelayMs * 0.8) : this.settings.botDelayMs) : this.settings.turnMs;
      d.actAt = Date.now() + delay;
      d.actKind = kind;
      d.planStep = d.step;
    }
  }

  /** "Your turn" through the friends service, for a player who has lost the room connection. */
  private notifyTurn(): void {
    const d = this.data!;
    const g = d.game;
    if (d.phase !== "playing" || !g || g.phase === "over" || g.turnNo === d.notifiedTurn) return;
    d.notifiedTurn = g.turnNo;
    const seat = d.seats[g.turn]!;
    if (seat.kind !== "human" || !seat.friend || seat.away || this.seatOnline(g.turn)) return;
    const stub = this.env.PLAYERS.get(this.env.PLAYERS.idFromName(seat.friend));
    this.ctx.waitUntil(stub.roomTurn(d.code).catch(() => undefined));
  }

  // ------------------------------------------------------------------ persistence, timers

  private async commit(events: GameEvent[]): Promise<void> {
    const d = this.data!;
    if (d.phase === "playing" && d.game?.phase === "over") d.phase = "over";
    this.planTurn();
    this.notifyTurn();
    await this.save();
    this.broadcast(events.length > 0 ? { t: "room", room: this.view(), ev: events } : { t: "room", room: this.view() });
    await this.schedule();
  }

  private async save(): Promise<void> {
    if (this.data) await this.ctx.storage.put("room", this.data);
  }

  private async schedule(): Promise<void> {
    const d = this.data;
    if (!d) return;
    const times = [d.lastActive + this.settings.roomTtlMs];
    if (d.actAt !== null) times.push(d.actAt);
    for (const s of d.seats) if (s.graceUntil !== null) times.push(s.graceUntil);
    for (const ws of this.ctx.getWebSockets()) {
      const a = attachmentOf(ws);
      if (!a.joined && a.at > 0 && !this.closing.has(ws)) times.push(a.at + JOIN_TIMEOUT_MS + 50);
    }
    await this.ctx.storage.setAlarm(Math.min(...times));
  }

  override async alarm(): Promise<void> {
    const d = this.data;
    if (!d) return;
    const now = Date.now();
    if (d.lastActive + this.settings.roomTtlMs <= now) {
      await this.expire();
      return;
    }
    this.sweepUnjoined(this.ctx.getWebSockets());
    let changed = false;
    for (const [i, seat] of d.seats.entries()) {
      if (seat.graceUntil === null || seat.graceUntil > now) continue;
      seat.graceUntil = null;
      changed = true;
      if (d.phase === "lobby") {
        d.seats[i] = emptySeat(); // never came back: free the seat
        if (d.host === i) d.host = this.nextHost(i);
      } else if (seat.kind === "human") {
        seat.away = true; // a bot plays for them until they reconnect
      }
    }
    let events: GameEvent[] = [];
    if (d.phase === "playing" && d.actAt !== null && d.actAt <= now + 10) {
      events = this.autoAct();
      changed = true;
    }
    if (changed) await this.commit(events);
    else await this.schedule();
  }

  /** Idle for too long: forget everything. */
  private async expire(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      this.closing.add(ws);
      send(ws, { t: "bye", reason: "expired" } satisfies RoomServerMessage);
      closeSocket(ws, 4410, "Room expired");
    }
    this.data = null;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  // ------------------------------------------------------------------ view

  private view(): RoomView {
    const d = this.data!;
    const online = new Set<number>();
    let spectators = 0;
    for (const ws of this.ctx.getWebSockets()) {
      if (this.closing.has(ws)) continue;
      const a = attachmentOf(ws);
      if (!a.joined) continue;
      if (a.seat === null) spectators++;
      else online.add(a.seat);
    }
    return {
      code: d.code,
      phase: d.phase,
      host: d.host,
      mode: d.mode,
      teams: d.teams,
      seats: d.seats.map((s, i) => ({
        kind: s.kind,
        name: s.name,
        ready: s.ready,
        online: online.has(i),
        auto: s.kind === "human" && s.away,
        bot: s.kind === "bot" ? s.bot : null,
        friend: s.friend,
      })),
      game: d.game,
      timer: d.actKind === "timeout" && d.actAt !== null ? Math.max(0, d.actAt - Date.now()) : null,
      turnMs: this.settings.turnMs,
      spectators,
    };
  }
}
