import WebSocket from "ws";
import type { PlayerServerMessage, RoomServerMessage, RoomView } from "../../shared/src/protocol.js";

export const BASE = "http://127.0.0.1:8799";
export const WS_BASE = "ws://127.0.0.1:8799";
export const ORIGIN = BASE;
export const APP_ORIGIN = "https://app.ludoroyale.example";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function post(path: string, origin: string | null = ORIGIN): Promise<Response> {
  const headers: Record<string, string> = {};
  if (origin) headers.Origin = origin;
  return fetch(BASE + path, { method: "POST", headers });
}

export async function newRoom(): Promise<string> {
  const r = await post("/api/rooms");
  if (r.status !== 200) throw new Error(`create room: ${r.status} ${await r.text()}`);
  return ((await r.json()) as { code: string }).code;
}

export async function newIdentity(): Promise<{ code: string; token: string }> {
  const r = await post("/api/identity");
  if (r.status !== 200) throw new Error(`identity: ${r.status} ${await r.text()}`);
  return (await r.json()) as { code: string; token: string };
}

/** A test client: records every message and lets tests wait for one that matches. */
export class Client<M extends { t: string }> {
  readonly messages: M[] = [];
  readonly ws: WebSocket;
  closed: { code: number; reason: string } | null = null;
  private waiters: Array<{ pred: (m: M) => boolean; resolve: (m: M) => void; from: number }> = [];
  private cursor = 0;

  constructor(path: string, origin: string = ORIGIN) {
    this.ws = new WebSocket(WS_BASE + path, { headers: { Origin: origin } });
    this.ws.on("message", (data) => {
      const m = JSON.parse(data.toString()) as M;
      this.messages.push(m);
      this.onMessage?.(m);
      for (const w of [...this.waiters]) {
        if (w.pred(m)) {
          this.waiters.splice(this.waiters.indexOf(w), 1);
          w.resolve(m);
        }
      }
    });
    this.ws.on("close", (code, reason) => {
      this.closed = { code, reason: reason.toString() };
    });
  }

  onMessage?: (m: M) => void;

  open(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.ws.once("open", () => resolve());
      this.ws.once("error", reject);
      this.ws.once("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    });
  }

  send(obj: unknown): void {
    this.ws.send(typeof obj === "string" ? obj : JSON.stringify(obj));
  }

  /** Next message (from now on, or already received since the last wait) that matches. */
  wait(pred: (m: M) => boolean, ms = 10_000, label = "message"): Promise<M> {
    for (let i = this.cursor; i < this.messages.length; i++) {
      if (pred(this.messages[i]!)) {
        this.cursor = i + 1;
        return Promise.resolve(this.messages[i]!);
      }
    }
    this.cursor = this.messages.length;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.resolve !== done);
        reject(new Error(`timed out waiting for ${label}; last: ${JSON.stringify(this.messages.at(-1))?.slice(0, 300)}`));
      }, ms);
      const done = (m: M) => {
        clearTimeout(timer);
        this.cursor = this.messages.length;
        resolve(m);
      };
      this.waiters.push({ pred, resolve: done, from: this.messages.length });
    });
  }

  waitClosed(ms = 5000): Promise<{ code: number; reason: string }> {
    if (this.closed) return Promise.resolve(this.closed);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("socket didn't close")), ms);
      this.ws.once("close", (code, reason) => {
        clearTimeout(timer);
        resolve({ code, reason: reason.toString() });
      });
    });
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      // ignore
    }
  }
}

export class RoomClient extends Client<RoomServerMessage> {
  you: number | null = null;
  secret: string | null = null;
  room: RoomView | null = null;
  errors: string[] = [];

  constructor(public code: string, origin: string = ORIGIN) {
    super(`/ws/room/${code}`, origin);
    this.onMessage = (m) => {
      if (m.t === "welcome") {
        this.you = m.you;
        if (m.secret) this.secret = m.secret;
        this.room = m.room;
      } else if (m.t === "you") {
        this.you = m.you;
      } else if (m.t === "room") {
        this.room = m.room;
      } else if (m.t === "error") {
        this.errors.push(`${m.code}: ${m.message}`);
      }
    };
  }

  static async join(code: string, name: string, extra: Record<string, unknown> = {}): Promise<RoomClient> {
    const c = new RoomClient(code);
    await c.open();
    c.send({ t: "join", name, ...extra });
    await c.wait((m) => m.t === "welcome" || m.t === "error", 10_000, "welcome");
    return c;
  }

  waitRoom(pred: (r: RoomView) => boolean, ms = 10_000, label = "room state"): Promise<RoomView> {
    if (this.room && pred(this.room)) return Promise.resolve(this.room);
    return this.wait((m) => (m.t === "room" || m.t === "welcome") && pred(m.room), ms, label).then(() => this.room!);
  }
}

export class PlayerClient extends Client<PlayerServerMessage> {
  constructor(public code: string) {
    super(`/ws/player/${code}`);
  }

  static async signIn(id: { code: string; token: string }, name: string): Promise<PlayerClient> {
    const c = new PlayerClient(id.code);
    await c.open();
    c.send({ t: "auth", token: id.token, name });
    await c.wait((m) => m.t === "me" || m.t === "error", 10_000, "me");
    return c;
  }

  last<T extends PlayerServerMessage["t"]>(t: T): Extract<PlayerServerMessage, { t: T }> | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) if (this.messages[i]!.t === t) return this.messages[i] as Extract<PlayerServerMessage, { t: T }>;
    return undefined;
  }
}

/**
 * Plays for a human client: whenever it's this client's turn, roll or move (first legal token, or a
 * random one). Returns a stop function.
 */
export function autoPlay(c: RoomClient, pick: "first" | "random" = "first"): () => void {
  let stopped = false;
  let lastSent = "";
  const tick = () => {
    if (stopped) return;
    const r = c.room;
    const g = r?.game;
    if (r && g && r.phase === "playing" && g.turn === c.you && c.ws.readyState === WebSocket.OPEN) {
      const key = `${g.turnNo}:${g.phase}:${g.dice}:${g.movable.join()}:${JSON.stringify(g.pos)}`;
      if (key !== lastSent) {
        lastSent = key;
        if (g.phase === "roll") c.send({ t: "roll" });
        else if (g.phase === "move") {
          const k = pick === "first" ? g.movable[0]! : g.movable[Math.floor(Math.random() * g.movable.length)]!;
          c.send({ t: "move", k });
        }
      }
    }
    setTimeout(tick, 15);
  };
  tick();
  return () => {
    stopped = true;
  };
}
