// Computer players. They only ever choose among state.movable, so they can't make an illegal move.
import { HOME, LAST_TRACK, TRACK_LENGTH, isSafeSquare, trackSquare } from "./board.js";
import { type GameState, capturesAt, destination, sameTeam } from "./engine.js";

export type BotLevel = "easy" | "normal";

/** Opponent tokens that could reach `square` with one roll (1..6) without turning into their home column. */
export function threatsTo(state: GameState, color: number, square: number): number {
  if (square < 0 || isSafeSquare(square)) return 0;
  let n = 0;
  for (const c of state.config.seats) {
    if (sameTeam(state.config, color, c)) continue;
    for (const p of state.pos[c]!) {
      if (p < 0 || p > LAST_TRACK) continue;
      const at = trackSquare(c, p);
      const distance = (square - at + TRACK_LENGTH) % TRACK_LENGTH;
      if (distance >= 1 && distance <= 6 && p + distance <= LAST_TRACK) n++;
    }
  }
  return n;
}

/** How good moving `token` is for the current player (higher is better). */
export function scoreMove(state: GameState, token: number): number {
  const m = state.moveColor;
  const from = state.pos[m]![token]!;
  const to = destination(from, state.dice);
  if (to === null) return -Infinity;
  let score = 0;

  const captured = capturesAt(state, m, to);
  score += captured.length * 100;
  for (const c of captured) score += c.from * 0.8; // the further the victim had come, the better
  if (to >= HOME) score += 80;
  if (from < 0) score += 55;

  const fromSquare = from >= 0 && from <= LAST_TRACK ? trackSquare(m, from) : -1;
  const toSquare = to <= LAST_TRACK ? trackSquare(m, to) : -1;
  const dangerBefore = fromSquare >= 0 ? threatsTo(state, m, fromSquare) : 0;
  const dangerAfter = toSquare >= 0 ? threatsTo(state, m, toSquare) : 0;

  if (to > LAST_TRACK && to < HOME) score += 30; // safe in the home column
  if (toSquare >= 0 && isSafeSquare(toSquare)) score += 25;
  if (dangerBefore > 0 && dangerAfter === 0) score += 35 + from * 0.3; // run away
  score -= dangerAfter * (22 + to * 0.35); // don't walk into trouble
  score += to * 0.12; // otherwise keep tokens moving forward
  return score;
}

/** Picks a token from state.movable. `random` returns a number in [0, 1). */
export function chooseToken(state: GameState, level: BotLevel, random: () => number): number {
  const options = state.movable;
  if (options.length === 0) throw new Error("No legal move to choose from.");
  if (options.length === 1) return options[0]!;
  if (level === "easy") {
    // Mostly random, but it does take a capture or a finish when it sees one half of the time.
    if (random() < 0.5) {
      const good = options.filter((t) => {
        const to = destination(state.pos[state.moveColor]![t]!, state.dice);
        return to !== null && (to >= HOME || capturesAt(state, state.moveColor, to).length > 0);
      });
      if (good.length > 0) return good[Math.floor(random() * good.length)]!;
    }
    return options[Math.floor(random() * options.length)]!;
  }
  let best = options[0]!;
  let bestScore = -Infinity;
  for (const t of options) {
    const s = scoreMove(state, t) + random() * 0.5; // tiny jitter so equal choices vary
    if (s > bestScore) {
      bestScore = s;
      best = t;
    }
  }
  return best;
}
