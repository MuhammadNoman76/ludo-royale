// A game session the UI can show: an online room (the server decides everything) or an offline
// game against bots that runs the same rules engine right here in the page.
import { type BotLevel, chooseToken } from "../../shared/src/bot.js";
import { type GameEvent, type GameState, type Mode, applyMove, applyRoll, createGame, onlyOneChoice } from "../../shared/src/engine.js";
import { type RoomClientMessage, type RoomServerMessage, type RoomView, type SeatView, rollDie } from "../../shared/src/protocol.js";
import { wsOrigin } from "./config.js";
import { friends, watchRoom } from "./friends.js";
import { ReconnectingSocket } from "./net.js";
import { systemAlert, toast } from "./notify.js";
import { forgetSeat, prefs, saveSeatSecret, seatSecret } from "./prefs.js";
import { Store } from "./store.js";

export interface Batch {
  room: RoomView;
  events: GameEvent[];
  /** A fresh snapshot (first view, reconnect): show it without animating. */
  reset: boolean;
}

export interface SessionState {
  kind: "online" | "local";
  status: "connecting" | "open" | "reconnecting" | "closed";
  /** The session can't go on (room missing, expired, opened elsewhere). */
  fatal: string | null;
  room: RoomView | null;
  you: number | null;
  /** The server didn't like the nickname: ask for another. */
  nameProblem: string | null;
}

export interface Session {
  readonly code: string;
  readonly state: Store<SessionState>;
  onBatch(fn: (b: Batch) => void): () => void;
  onReact(fn: (color: number, reaction: number) => void): () => void;
  send(intent: RoomClientMessage): void;
  rejoin(name: string): void;
  leave(): void;
  dispose(): void;
}

abstract class BaseSession implements Session {
  abstract readonly code: string;
  abstract readonly state: Store<SessionState>;
  private readonly batchListeners = new Set<(b: Batch) => void>();
  private readonly reactListeners = new Set<(c: number, r: number) => void>();

  onBatch(fn: (b: Batch) => void): () => void {
    this.batchListeners.add(fn);
    const room = this.state.get().room;
    if (room) fn({ room, events: [], reset: true });
    return () => this.batchListeners.delete(fn);
  }

  onReact(fn: (c: number, r: number) => void): () => void {
    this.reactListeners.add(fn);
    return () => this.reactListeners.delete(fn);
  }

  protected emitBatch(b: Batch): void {
    for (const l of this.batchListeners) l(b);
  }

  protected emitReact(c: number, r: number): void {
    for (const l of this.reactListeners) l(c, r);
  }

  protected patch(p: Partial<SessionState>): void {
    this.state.set({ ...this.state.get(), ...p });
  }

  /** "Your turn" when the window is in the background. */
  protected checkMyTurn(events: GameEvent[]): void {
    const { you, room } = this.state.get();
    if (you === null || !room) return;
    if (events.some((e) => e.e === "turn" && e.c === you)) {
      systemAlert({ kind: "turn", title: "It's your turn!", body: room.code === "SOLO" ? "Your move." : `Your move in room ${room.code}.`, room: room.code === "SOLO" ? undefined : room.code });
    }
  }

  abstract send(intent: RoomClientMessage): void;
  abstract rejoin(name: string): void;
  abstract leave(): void;
  abstract dispose(): void;
}

// ---------------------------------------------------------------- online

export class OnlineSession extends BaseSession {
  readonly state: Store<SessionState>;
  private readonly socket: ReconnectingSocket;
  private name: string;

  constructor(readonly code: string, name: string) {
    super();
    this.name = name;
    this.state = new Store<SessionState>({ kind: "online", status: "connecting", fatal: null, room: null, you: null, nameProblem: null });
    this.socket = new ReconnectingSocket(() => `${wsOrigin()}/ws/room/${code}`, {
      open: () => this.sendJoin(),
      message: (m) => this.onMessage(m as RoomServerMessage),
      closed: (closeCode) => {
        if (this.state.get().fatal) return false;
        if (closeCode === 4404 || closeCode === 4410 || closeCode === 4000) return false;
        this.patch({ status: "reconnecting" });
        return true;
      },
      status: (s) => {
        if (s === "waiting" || (s === "connecting" && this.state.get().room)) this.patch({ status: "reconnecting" });
      },
    });
  }

  private sendJoin(): void {
    const join: Record<string, unknown> = { t: "join", name: this.name, v: 1 };
    const secret = seatSecret(this.code);
    if (secret) join.secret = secret;
    const myCode = friends.get().code;
    if (myCode) join.friend = myCode;
    this.socket.send(join);
  }

  rejoin(name: string): void {
    this.name = name;
    this.patch({ nameProblem: null });
    this.sendJoin();
  }

  private onMessage(m: RoomServerMessage): void {
    switch (m.t) {
      case "welcome":
        if (m.secret) saveSeatSecret(this.code, m.secret);
        this.patch({ status: "open", room: m.room, you: m.you, nameProblem: null });
        if (m.you !== null) watchRoom(this.code);
        this.emitBatch({ room: m.room, events: [], reset: true });
        return;
      case "room":
        this.patch({ room: m.room });
        this.emitBatch({ room: m.room, events: m.ev ?? [], reset: false });
        if (m.ev) this.checkMyTurn(m.ev);
        return;
      case "you":
        this.patch({ you: m.you });
        return;
      case "react":
        this.emitReact(m.c, m.r);
        return;
      case "error":
        if (m.code === "no-room") {
          forgetSeat(this.code);
          this.patch({ fatal: "This room doesn't exist or has expired.", status: "closed" });
        } else if (m.code === "bad-name") {
          this.patch({ nameProblem: m.message });
        } else if (m.code !== "slow-down") {
          toast(m.message, { tone: "warn" });
        }
        return;
      case "bye":
        if (m.reason === "expired") this.patch({ fatal: "This room expired after a long break.", status: "closed" });
        else if (m.reason === "replaced") this.patch({ fatal: "You opened this room in another window.", status: "closed" });
        else this.patch({ status: "closed" });
        this.socket.stop();
        return;
    }
  }

  send(intent: RoomClientMessage): void {
    if (!this.socket.send(intent)) toast("Reconnecting…", { tone: "warn" });
  }

  leave(): void {
    this.socket.send({ t: "leave" });
    forgetSeat(this.code);
    this.dispose();
  }

  dispose(): void {
    this.socket.stop();
  }
}

// ---------------------------------------------------------------- offline vs bots

export interface SoloOptions {
  color: number;
  bots: number;
  level: BotLevel;
  mode: Mode;
  name: string;
}

const BOT_NAMES = ["Rani", "Sultan", "Pixel", "Mango", "Tiger", "Chai"];
const BOT_DELAY = 850;

export class LocalSession extends BaseSession {
  readonly code = "SOLO";
  readonly state: Store<SessionState>;
  private seats: SeatView[];
  private game: GameState | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(private readonly options: SoloOptions) {
    super();
    const you = options.color;
    const order = [(you + 2) % 4, (you + 1) % 4, (you + 3) % 4].slice(0, Math.max(1, Math.min(3, options.bots)));
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    this.seats = [0, 1, 2, 3].map((c): SeatView => {
      if (c === you) return { kind: "human", name: options.name || "You", ready: true, online: true, auto: false, bot: null, friend: null };
      if (order.includes(c)) return { kind: "bot", name: names[c]!, ready: true, online: false, auto: false, bot: options.level, friend: null };
      return { kind: "empty", name: "", ready: false, online: false, auto: false, bot: null, friend: null };
    });
    this.state = new Store<SessionState>({ kind: "local", status: "open", fatal: null, room: null, you, nameProblem: null });
    this.newGame();
  }

  private view(): RoomView {
    return {
      code: "SOLO",
      phase: !this.game ? "lobby" : this.game.phase === "over" ? "over" : "playing",
      host: this.options.color,
      mode: this.options.mode,
      teams: false,
      seats: this.seats,
      game: this.game,
      timer: null,
      turnMs: 0,
      spectators: 0,
    };
  }

  private newGame(): void {
    const seats = [0, 1, 2, 3].filter((c) => this.seats[c]!.kind !== "empty");
    const first = seats[Math.floor(Math.random() * seats.length)]!;
    this.game = createGame({ mode: this.options.mode, teams: false, seats }, first);
    const room = this.view();
    this.patch({ room });
    this.emitBatch({ room, events: [{ e: "turn", c: first }], reset: true });
    this.planBot();
  }

  private publish(events: GameEvent[]): void {
    const room = this.view();
    this.patch({ room });
    this.emitBatch({ room, events, reset: false });
    this.checkMyTurn(events);
    this.planBot();
  }

  private roll(): GameEvent[] {
    const r = applyRoll(this.game!, rollDie());
    this.game = r.state;
    let events = r.events;
    if (onlyOneChoice(this.game)) {
      const m = applyMove(this.game, this.game.movable[0]!);
      this.game = m.state;
      events = events.concat(m.events);
    }
    return events;
  }

  private planBot(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const g = this.game;
    if (this.disposed || !g || g.phase === "over" || this.seats[g.turn]!.kind !== "bot") return;
    // Wait a little longer after long animations so the bots don't rush ahead.
    this.timer = setTimeout(() => this.botStep(), g.phase === "move" ? BOT_DELAY * 0.8 : BOT_DELAY);
  }

  private botStep(): void {
    const g = this.game;
    if (this.disposed || !g || g.phase === "over") return;
    const level = this.seats[g.turn]!.bot ?? "normal";
    if (g.phase === "roll") this.publish(this.roll());
    else {
      const r = applyMove(g, chooseToken(g, level, Math.random));
      this.game = r.state;
      this.publish(r.events);
    }
  }

  send(intent: RoomClientMessage): void {
    const g = this.game;
    const you = this.options.color;
    switch (intent.t) {
      case "roll":
        if (g && g.phase === "roll" && g.turn === you) this.publish(this.roll());
        return;
      case "move":
        if (g && g.phase === "move" && g.turn === you && g.movable.includes(intent.k)) {
          const r = applyMove(g, intent.k);
          this.game = r.state;
          this.publish(r.events);
        }
        return;
      case "react":
        this.emitReact(you, intent.r);
        return;
      case "rematch":
        this.newGame();
        return;
    }
  }

  rejoin(): void {
    // nothing to do offline
  }

  leave(): void {
    this.dispose();
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
  }
}

export function soloDefaults(): SoloOptions {
  const p = prefs.get();
  return { color: p.soloColor, bots: p.soloBots, level: p.botLevel, mode: p.soloMode, name: p.name || "You" };
}
