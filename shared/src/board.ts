// Board geometry shared by the rules engine, the bots and the board renderer.
//
// Colours sit in the four corners and play clockwise:
//   0 red (top-left) -> 1 green (top-right) -> 2 yellow (bottom-right) -> 3 blue (bottom-left).
// The main track has 52 squares, numbered from red's start square. A token's position is its own
// progress: -1 = in the yard, 0 = its start square, 50 = the last track square before its home
// column, 51..55 = the home column, 56 = home (finished).

export const COLORS = ["red", "green", "yellow", "blue"] as const;
export type ColorName = (typeof COLORS)[number];

export const TRACK_LENGTH = 52;
export const YARD = -1;
export const LAST_TRACK = 50;
export const HOME = 56;
export const TOKENS = 4;

/** Absolute track index of each colour's start square. */
export function startSquare(color: number): number {
  return color * 13;
}

/** Start squares and the four stars (8 squares after each start) are safe: no captures there. */
export const SAFE_SQUARES: ReadonlySet<number> = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

/** Absolute track square of a token of `color` at `progress` (0..50), or -1 when it isn't on the main track. */
export function trackSquare(color: number, progress: number): number {
  if (progress < 0 || progress > LAST_TRACK) return -1;
  return (startSquare(color) + progress) % TRACK_LENGTH;
}

export function isSafeSquare(square: number): boolean {
  return SAFE_SQUARES.has(square);
}

/** Partner in 2 vs 2: the opposite corner. */
export function partnerOf(color: number): number {
  return (color + 2) % 4;
}

// ---------------------------------------------------------------- 15 x 15 grid coordinates (for drawing)

/** [column, row] of every main-track square, starting at red's start square, clockwise. */
export const TRACK_CELLS: ReadonlyArray<readonly [number, number]> = (() => {
  const cells: Array<[number, number]> = [];
  const run = (c: number, r: number, dc: number, dr: number, n: number) => {
    for (let i = 0; i < n; i++) cells.push([c + dc * i, r + dr * i]);
  };
  run(1, 6, 1, 0, 5); // red arm, top row, to the right
  run(6, 5, 0, -1, 6); // up the top arm's left column
  run(7, 0, 1, 0, 2); // across the top
  run(8, 1, 0, 1, 5); // down the top arm's right column
  run(9, 6, 1, 0, 6); // right arm, top row
  run(14, 7, 0, 1, 2); // down the right edge
  run(13, 8, -1, 0, 5); // right arm, bottom row
  run(8, 9, 0, 1, 6); // down the bottom arm's right column
  run(7, 14, -1, 0, 2); // across the bottom
  run(6, 13, 0, -1, 5); // up the bottom arm's left column
  run(5, 8, -1, 0, 6); // left arm, bottom row
  run(0, 7, 0, -1, 2); // up the left edge
  return cells;
})();

/** [column, row] of the five home-column squares of each colour (progress 51..55). */
export function homeColumnCell(color: number, step: number): readonly [number, number] {
  // step 0..4
  switch (color) {
    case 0:
      return [1 + step, 7];
    case 1:
      return [7, 1 + step];
    case 2:
      return [13 - step, 7];
    default:
      return [7, 13 - step];
  }
}

/** Centre point (in cell units) of a token's square. Yard and home spots are spread per token. */
export function tokenPoint(color: number, token: number, progress: number): [number, number] {
  if (progress === YARD) {
    const [ox, oy] = YARD_ORIGIN[color]!;
    const dx = token % 2 === 0 ? 2.05 : 3.95;
    const dy = token < 2 ? 1.95 : 3.75;
    return [ox + dx, oy + dy];
  }
  if (progress >= HOME) {
    // Inside the centre triangle of its colour, spread a little.
    const spread = (token - 1.5) * 0.42;
    switch (color) {
      case 0:
        return [6.55, 7.5 + spread];
      case 1:
        return [7.5 + spread, 6.55];
      case 2:
        return [8.45, 7.5 + spread];
      default:
        return [7.5 + spread, 8.45];
    }
  }
  if (progress > LAST_TRACK) {
    const [c, r] = homeColumnCell(color, progress - LAST_TRACK - 1);
    return [c + 0.5, r + 0.5];
  }
  const [c, r] = TRACK_CELLS[trackSquare(color, progress)]!;
  return [c + 0.5, r + 0.5];
}

/** Top-left cell of each colour's 6 x 6 yard. */
export const YARD_ORIGIN: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [9, 0],
  [9, 9],
  [0, 9],
];
