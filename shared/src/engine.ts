// The Ludo rules engine. Pure functions: the server runs it for online rooms (it rolls the dice and
// validates every move), the web client runs the very same code for offline games against bots.
import { HOME, LAST_TRACK, TOKENS, YARD, isSafeSquare, partnerOf, trackSquare } from "./board.js";

export type Mode = "classic" | "quick";

export interface GameConfig {
  /** classic: 4 tokens each, all start in the yard. quick: one token starts on the board, 2 home wins. */
  mode: Mode;
  /** 2 vs 2: red + yellow against green + blue (needs all four colours). */
  teams: boolean;
  /** Colours in play (0..3), in clockwise turn order. */
  seats: number[];
}

export interface Capture {
  c: number;
  t: number;
  from: number;
}

export type GameEvent =
  | { e: "roll"; c: number; v: number }
  | { e: "move"; c: number; m: number; t: number; from: number; to: number; cap: Capture[] }
  | { e: "nomove"; c: number }
  | { e: "forfeit"; c: number }
  | { e: "bonus"; c: number; why: "six" | "capture" | "home" }
  | { e: "turn"; c: number }
  | { e: "done"; c: number }
  | { e: "win"; w: number[] };

export interface LastMove {
  m: number;
  t: number;
  from: number;
  to: number;
}

export interface GameState {
  config: GameConfig;
  /** pos[colour][token]: -1 yard, 0..50 main track (own progress), 51..55 home column, 56 home. */
  pos: number[][];
  /** Colour whose turn it is. */
  turn: number;
  phase: "roll" | "move" | "over";
  /** The die of the current turn (0 = not rolled yet). */
  dice: number;
  /** Sixes rolled in a row this turn (three forfeit the turn). */
  sixes: number;
  /** Whose tokens the current player moves (the partner's once their own are home, in 2 vs 2). */
  moveColor: number;
  /** Tokens of moveColor that may move with the current die. */
  movable: number[];
  /** Winning colour (or the winning team's two colours). */
  winners: number[];
  /** Counts turns (each time play passes to the next colour). */
  turnNo: number;
  last: LastMove | null;
}

export interface StepResult {
  state: GameState;
  events: GameEvent[];
}

export class RuleError extends Error {}

// ---------------------------------------------------------------- set-up

export function validateConfig(config: GameConfig): string | null {
  const seats = config.seats;
  if (!Array.isArray(seats) || seats.length < 2 || seats.length > 4) return "Ludo needs 2 to 4 players.";
  for (let i = 0; i < seats.length; i++) {
    const s = seats[i]!;
    if (!Number.isInteger(s) || s < 0 || s > 3) return "Unknown colour.";
    if (i > 0 && s <= seats[i - 1]!) return "Colours must be distinct and in turn order.";
  }
  if (config.mode !== "classic" && config.mode !== "quick") return "Unknown mode.";
  if (config.teams && seats.length !== 4) return "2 vs 2 needs four players.";
  return null;
}

export function createGame(config: GameConfig, first?: number): GameState {
  const problem = validateConfig(config);
  if (problem) throw new RuleError(problem);
  const pos: number[][] = [];
  for (let c = 0; c < 4; c++) {
    const row: number[] = [];
    for (let t = 0; t < TOKENS; t++) row.push(YARD);
    // Quick mode: every player starts with one token already out.
    if (config.mode === "quick" && config.seats.includes(c)) row[0] = 0;
    pos.push(row);
  }
  const turn = first !== undefined && config.seats.includes(first) ? first : config.seats[0]!;
  return {
    config: { mode: config.mode, teams: config.teams, seats: [...config.seats] },
    pos,
    turn,
    phase: "roll",
    dice: 0,
    sixes: 0,
    moveColor: turn,
    movable: [],
    winners: [],
    turnNo: 1,
    last: null,
  };
}

export function cloneState(s: GameState): GameState {
  return {
    config: { mode: s.config.mode, teams: s.config.teams, seats: [...s.config.seats] },
    pos: s.pos.map((row) => [...row]),
    turn: s.turn,
    phase: s.phase,
    dice: s.dice,
    sixes: s.sixes,
    moveColor: s.moveColor,
    movable: [...s.movable],
    winners: [...s.winners],
    turnNo: s.turnNo,
    last: s.last ? { ...s.last } : null,
  };
}

// ---------------------------------------------------------------- queries

/** Tokens a player must bring home to win: 4 in Classic, 2 in Quick. */
export function targetCount(config: GameConfig): number {
  return config.mode === "quick" ? 2 : TOKENS;
}

export function homeCount(state: GameState, color: number): number {
  let n = 0;
  for (const p of state.pos[color]!) if (p >= HOME) n++;
  return n;
}

export function isDone(state: GameState, color: number): boolean {
  return homeCount(state, color) >= targetCount(state.config);
}

export function sameTeam(config: GameConfig, a: number, b: number): boolean {
  return a === b || (config.teams && partnerOf(a) === b);
}

/** Whose tokens `color` moves this turn: its own, or (2 vs 2) its partner's once its own are all home. */
export function controlColor(state: GameState, color: number): number {
  if (state.config.teams && isDone(state, color)) return partnerOf(color);
  return color;
}

/** Where a token would land with `roll`, or null if it can't move. */
export function destination(from: number, roll: number): number | null {
  if (from >= HOME) return null;
  if (from === YARD) return roll === 6 ? 0 : null;
  const to = from + roll;
  return to <= HOME ? to : null; // exact roll needed to finish
}

export function legalTokens(state: GameState, color: number, roll: number): number[] {
  const out: number[] = [];
  const row = state.pos[color]!;
  for (let t = 0; t < TOKENS; t++) if (destination(row[t]!, roll) !== null) out.push(t);
  return out;
}

/** Opponent tokens a token of `color` landing on `to` would capture. */
export function capturesAt(state: GameState, color: number, to: number): Capture[] {
  if (to < 0 || to > LAST_TRACK) return [];
  const square = trackSquare(color, to);
  if (isSafeSquare(square)) return [];
  const out: Capture[] = [];
  for (const c of state.config.seats) {
    if (sameTeam(state.config, color, c)) continue;
    const row = state.pos[c]!;
    for (let t = 0; t < TOKENS; t++) {
      const p = row[t]!;
      if (p >= 0 && p <= LAST_TRACK && trackSquare(c, p) === square) out.push({ c, t, from: p });
    }
  }
  return out;
}

export function nextSeat(config: GameConfig, color: number): number {
  const seats = config.seats;
  const i = seats.indexOf(color);
  return seats[(i + 1) % seats.length]!;
}

// ---------------------------------------------------------------- actions

function passTurn(s: GameState, events: GameEvent[]): void {
  s.turn = nextSeat(s.config, s.turn);
  s.phase = "roll";
  s.dice = 0;
  s.sixes = 0;
  s.movable = [];
  s.moveColor = controlColor(s, s.turn);
  s.turnNo++;
  events.push({ e: "turn", c: s.turn });
}

/** The current player rolled `value` (1..6). */
export function applyRoll(state: GameState, value: number): StepResult {
  if (state.phase !== "roll") throw new RuleError("Not the time to roll.");
  if (!Number.isInteger(value) || value < 1 || value > 6) throw new RuleError("Bad die value.");
  const s = cloneState(state);
  const events: GameEvent[] = [{ e: "roll", c: s.turn, v: value }];
  s.dice = value;
  s.sixes = value === 6 ? s.sixes + 1 : 0;

  if (s.sixes >= 3) {
    // Three sixes in a row: the turn is lost.
    events.push({ e: "forfeit", c: s.turn });
    passTurn(s, events);
    return { state: s, events };
  }

  s.moveColor = controlColor(s, s.turn);
  s.movable = legalTokens(s, s.moveColor, value);
  if (s.movable.length === 0) {
    events.push({ e: "nomove", c: s.turn });
    if (value === 6) {
      // A six still earns another roll.
      s.phase = "roll";
      events.push({ e: "bonus", c: s.turn, why: "six" });
    } else {
      passTurn(s, events);
    }
    return { state: s, events };
  }
  s.phase = "move";
  return { state: s, events };
}

/** The current player moves token `token` (one of state.movable). */
export function applyMove(state: GameState, token: number): StepResult {
  if (state.phase !== "move") throw new RuleError("Roll first.");
  if (!state.movable.includes(token)) throw new RuleError("That token can't move.");
  const s = cloneState(state);
  const m = s.moveColor;
  const from = s.pos[m]![token]!;
  const to = destination(from, s.dice);
  if (to === null) throw new RuleError("That token can't move.");

  const cap = capturesAt(s, m, to);
  for (const c of cap) s.pos[c.c]![c.t] = YARD;
  s.pos[m]![token] = to;
  s.last = { m, t: token, from, to };
  s.movable = [];
  const events: GameEvent[] = [{ e: "move", c: s.turn, m, t: token, from, to, cap }];

  const target = targetCount(s.config);
  if (to >= HOME && homeCount(s, m) === target) events.push({ e: "done", c: m });

  // Winner?
  const winner = s.config.teams
    ? isDone(s, m) && isDone(s, partnerOf(m))
      ? [Math.min(m, partnerOf(m)), Math.max(m, partnerOf(m))]
      : null
    : isDone(s, m)
      ? [m]
      : null;
  if (winner) {
    s.phase = "over";
    s.winners = winner;
    s.dice = 0;
    events.push({ e: "win", w: winner });
    return { state: s, events };
  }

  // Extra roll for a six, a capture or a token reaching home.
  const why = cap.length > 0 ? "capture" : to >= HOME ? "home" : s.dice === 6 ? "six" : null;
  if (why) {
    s.phase = "roll";
    s.moveColor = controlColor(s, s.turn);
    events.push({ e: "bonus", c: s.turn, why });
  } else {
    passTurn(s, events);
  }
  return { state: s, events };
}

/** True when choosing makes no difference (one movable token, or several waiting in the same spot). */
export function onlyOneChoice(state: GameState): boolean {
  if (state.phase !== "move" || state.movable.length === 0) return false;
  const row = state.pos[state.moveColor]!;
  return new Set(state.movable.map((t) => row[t])).size === 1;
}

/** Total progress of a colour (for standings). */
export function progressOf(state: GameState, color: number): number {
  let sum = 0;
  for (const p of state.pos[color]!) sum += p < 0 ? 0 : p + 1;
  return sum;
}

/** Colours ordered best first: winners, then by tokens home and total progress. */
export function standings(state: GameState): number[] {
  const seats = [...state.config.seats];
  return seats.sort((a, b) => {
    const wa = state.winners.includes(a) ? 1 : 0;
    const wb = state.winners.includes(b) ? 1 : 0;
    if (wa !== wb) return wb - wa;
    const ha = homeCount(state, a);
    const hb = homeCount(state, b);
    if (ha !== hb) return hb - ha;
    return progressOf(state, b) - progressOf(state, a);
  });
}
