// Turns the server's events into animation: the die tumbles, tokens hop square by square, captured
// tokens fly home. The board always ends up exactly where the server says. When updates pile up
// (slow device, hidden tab) it skips ahead instead of falling behind.
import { HOME, YARD, tokenPoint } from "../../shared/src/board.js";
import type { GameEvent } from "../../shared/src/engine.js";
import type { RoomView } from "../../shared/src/protocol.js";
import type { Batch } from "./session.js";
import { play } from "./sound.js";
import { Store } from "./store.js";

export interface Effect {
  id: number;
  kind: "capture" | "home" | "six";
  x: number;
  y: number;
  c: number;
}

export interface DisplayState {
  room: RoomView | null;
  pos: number[][];
  dice: number;
  rolling: boolean;
  diceColor: number;
  /** Token in motion (drawn on top, with a hop). */
  hop: { c: number; t: number } | null;
  /** Tokens flying back to their yard. */
  flying: string[];
  trail: { c: number; points: Array<[number, number]>; id: number } | null;
  effects: Effect[];
  banner: { text: string; id: number } | null;
  busy: boolean;
}

const EMPTY_POS = [0, 1, 2, 3].map(() => [YARD, YARD, YARD, YARD]);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class Animator {
  readonly display = new Store<DisplayState>({
    room: null,
    pos: EMPTY_POS,
    dice: 0,
    rolling: false,
    diceColor: 0,
    hop: null,
    flying: [],
    trail: null,
    effects: [],
    banner: null,
    busy: false,
  });

  private queue: Batch[] = [];
  private running = false;
  private disposed = false;
  private ids = 1;
  private generation = 0;

  constructor(private readonly you: () => number | null) {}

  dispose(): void {
    this.disposed = true;
    this.queue = [];
  }

  private patch(p: Partial<DisplayState>): void {
    this.display.set({ ...this.display.get(), ...p });
  }

  push(batch: Batch): void {
    if (this.disposed) return;
    if (batch.reset) {
      this.queue = [];
      this.generation++;
      this.snap(batch.room);
      return;
    }
    this.queue.push(batch);
    if (!this.running) void this.run();
  }

  /** Jump straight to a room state. */
  private snap(room: RoomView): void {
    const g = room.game;
    this.patch({
      room,
      pos: g ? g.pos.map((r) => [...r]) : EMPTY_POS,
      dice: g?.dice || this.display.get().dice,
      diceColor: g ? g.turn : this.display.get().diceColor,
      rolling: false,
      hop: null,
      flying: [],
      busy: false,
    });
  }

  private async run(): Promise<void> {
    this.running = true;
    const gen = this.generation;
    try {
      while (this.queue.length > 0 && !this.disposed && gen === this.generation) {
        const batch = this.queue.shift()!;
        const fast = this.queue.length >= 2 || document.hidden;
        if (batch.events.length > 0) {
          this.patch({ busy: true });
          for (const e of batch.events) {
            if (this.disposed || gen !== this.generation) return;
            await this.animate(e, fast, batch.room);
          }
        }
        if (gen !== this.generation) return;
        this.snap(batch.room);
      }
    } finally {
      this.running = false;
      if (!this.disposed && this.queue.length > 0) void this.run();
    }
  }

  private wait(ms: number, fast: boolean): Promise<void> {
    return fast ? Promise.resolve() : sleep(ms);
  }

  private effect(kind: Effect["kind"], x: number, y: number, c: number): void {
    const id = this.ids++;
    this.patch({ effects: [...this.display.get().effects, { id, kind, x, y, c }] });
    setTimeout(() => this.patch({ effects: this.display.get().effects.filter((f) => f.id !== id) }), 900);
  }

  private banner(text: string): void {
    const id = this.ids++;
    this.patch({ banner: { text, id } });
    setTimeout(() => {
      if (this.display.get().banner?.id === id) this.patch({ banner: null });
    }, 1300);
  }

  private async animate(e: GameEvent, fast: boolean, room: RoomView): Promise<void> {
    switch (e.e) {
      case "roll": {
        if (!fast) play("dice");
        this.patch({ rolling: !fast, diceColor: e.c });
        await this.wait(560, fast);
        this.patch({ rolling: false, dice: e.v });
        if (e.v === 6 && !fast) {
          const [x, y] = tokenPoint(e.c, 0, YARD);
          this.effect("six", x, y, e.c);
        }
        await this.wait(160, fast);
        return;
      }
      case "move": {
        const pos = this.display.get().pos.map((r) => [...r]);
        const steps: number[] = [];
        if (e.from === YARD) steps.push(0);
        else for (let p = e.from + 1; p <= e.to; p++) steps.push(p);
        const points: Array<[number, number]> = [];
        if (e.from !== YARD) points.push(tokenPoint(e.m, e.t, e.from));
        this.patch({ hop: { c: e.m, t: e.t } });
        for (const p of steps) {
          pos[e.m]![e.t] = p;
          points.push(tokenPoint(e.m, e.t, p));
          this.patch({ pos: pos.map((r) => [...r]) });
          if (!fast) play("move");
          await this.wait(e.from === YARD ? 240 : 125, fast);
        }
        this.patch({ hop: null, trail: { c: e.m, points, id: this.ids++ } });
        if (e.cap.length > 0) {
          const [x, y] = tokenPoint(e.m, e.t, e.to);
          this.effect("capture", x, y, e.m);
          if (!fast) play("capture");
          for (const c of e.cap) pos[c.c]![c.t] = YARD;
          this.patch({ pos: pos.map((r) => [...r]), flying: e.cap.map((c) => `${c.c}:${c.t}`) });
          await this.wait(520, fast);
          this.patch({ flying: [] });
        }
        if (e.to >= HOME) {
          const [x, y] = tokenPoint(e.m, e.t, HOME);
          this.effect("home", x, y, e.m);
          if (!fast) play("home");
          await this.wait(260, fast);
        }
        return;
      }
      case "nomove":
        this.banner(e.c === this.you() ? "No move this time" : "No move");
        await this.wait(650, fast);
        return;
      case "forfeit":
        this.banner("Three sixes: turn lost!");
        await this.wait(900, fast);
        return;
      case "bonus":
        this.banner(e.why === "capture" ? "Capture! Roll again" : e.why === "home" ? "Home! Roll again" : "Six! Roll again");
        return;
      case "turn":
        if (e.c === this.you() && !fast) play("turn");
        this.patch({ diceColor: e.c, dice: 0 });
        await this.wait(120, fast);
        return;
      case "done":
        return;
      case "win":
        if (!document.hidden) play("win");
        void room;
        return;
    }
  }
}
