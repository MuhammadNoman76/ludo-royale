import { describe, expect, it } from "vitest";
import { HOME, SAFE_SQUARES, TRACK_CELLS, YARD, homeColumnCell, startSquare, trackSquare } from "../src/board.js";
import { chooseToken, scoreMove, threatsTo } from "../src/bot.js";
import {
  type GameConfig,
  type GameState,
  RuleError,
  applyMove,
  applyRoll,
  capturesAt,
  createGame,
  legalTokens,
  standings,
  validateConfig,
} from "../src/engine.js";

const classic2: GameConfig = { mode: "classic", teams: false, seats: [0, 2] };
const classic4: GameConfig = { mode: "classic", teams: false, seats: [0, 1, 2, 3] };
const teams: GameConfig = { mode: "classic", teams: true, seats: [0, 1, 2, 3] };
const quick: GameConfig = { mode: "quick", teams: false, seats: [0, 1] };

function withPositions(config: GameConfig, pos: Record<number, number[]>, turn?: number): GameState {
  const s = createGame(config, turn);
  for (const [c, row] of Object.entries(pos)) s.pos[Number(c)] = [...row];
  s.moveColor = s.turn;
  return s;
}

describe("board", () => {
  it("has a 52-square track of distinct cells on the cross", () => {
    expect(TRACK_CELLS).toHaveLength(52);
    const keys = new Set(TRACK_CELLS.map(([c, r]) => `${c},${r}`));
    expect(keys.size).toBe(52);
    for (const [c, r] of TRACK_CELLS) {
      const inArm = (c >= 6 && c <= 8) || (r >= 6 && r <= 8);
      expect(inArm).toBe(true);
      expect(c === 7 && r === 7).toBe(false);
    }
    // Neighbouring squares touch (the path is continuous and closes on itself).
    for (let i = 0; i < 52; i++) {
      const [c1, r1] = TRACK_CELLS[i]!;
      const [c2, r2] = TRACK_CELLS[(i + 1) % 52]!;
      expect(Math.max(Math.abs(c1 - c2), Math.abs(r1 - r2))).toBe(1);
    }
  });

  it("puts every colour's start square and star where the board shows them", () => {
    expect(TRACK_CELLS[startSquare(0)]).toEqual([1, 6]);
    expect(TRACK_CELLS[startSquare(1)]).toEqual([8, 1]);
    expect(TRACK_CELLS[startSquare(2)]).toEqual([13, 8]);
    expect(TRACK_CELLS[startSquare(3)]).toEqual([6, 13]);
    expect([...SAFE_SQUARES].sort((a, b) => a - b)).toEqual([0, 8, 13, 21, 26, 34, 39, 47]);
    expect(TRACK_CELLS[8]).toEqual([6, 2]);
  });

  it("leads each colour from its last track square into its own home column", () => {
    for (let c = 0; c < 4; c++) {
      const [lc, lr] = TRACK_CELLS[trackSquare(c, 50)]!;
      const [hc, hr] = homeColumnCell(c, 0);
      expect(Math.abs(lc - hc) + Math.abs(lr - hr)).toBe(1);
      const [ec, er] = homeColumnCell(c, 4);
      expect(Math.max(Math.abs(ec - 7), Math.abs(er - 7))).toBe(2); // touches the centre square
    }
  });
});

describe("setup", () => {
  it("validates configurations", () => {
    expect(validateConfig(classic2)).toBeNull();
    expect(validateConfig({ ...classic2, seats: [0] })).not.toBeNull();
    expect(validateConfig({ ...classic2, seats: [2, 0] })).not.toBeNull();
    expect(validateConfig({ ...classic2, seats: [0, 0] })).not.toBeNull();
    expect(validateConfig({ ...classic2, seats: [0, 4] })).not.toBeNull();
    expect(validateConfig({ ...classic2, teams: true })).not.toBeNull();
    expect(validateConfig(teams)).toBeNull();
    expect(() => createGame({ ...classic2, seats: [1] })).toThrow(RuleError);
  });

  it("starts classic games with every token in the yard", () => {
    const s = createGame(classic4);
    for (const c of [0, 1, 2, 3]) expect(s.pos[c]).toEqual([YARD, YARD, YARD, YARD]);
    expect(s.phase).toBe("roll");
    expect(s.turn).toBe(0);
  });

  it("starts quick games with one token out per player", () => {
    const s = createGame(quick, 1);
    expect(s.pos[0]).toEqual([0, YARD, YARD, YARD]);
    expect(s.pos[1]).toEqual([0, YARD, YARD, YARD]);
    expect(s.pos[2]).toEqual([YARD, YARD, YARD, YARD]);
    expect(s.turn).toBe(1);
  });
});

describe("moves", () => {
  it("needs a six to leave the yard and passes the turn otherwise", () => {
    const s = createGame(classic2);
    const r = applyRoll(s, 4);
    expect(r.events.map((e) => e.e)).toEqual(["roll", "nomove", "turn"]);
    expect(r.state.turn).toBe(2);
    expect(r.state.phase).toBe("roll");
  });

  it("brings a token out on a six and gives another roll", () => {
    let s = createGame(classic2);
    let r = applyRoll(s, 6);
    expect(r.state.phase).toBe("move");
    expect(r.state.movable).toEqual([0, 1, 2, 3]);
    r = applyMove(r.state, 2);
    s = r.state;
    expect(s.pos[0]![2]).toBe(0);
    expect(s.turn).toBe(0);
    expect(s.phase).toBe("roll");
    expect(r.events.at(-1)).toEqual({ e: "bonus", c: 0, why: "six" });
  });

  it("forfeits the turn on three sixes in a row", () => {
    let s = withPositions(classic2, { 0: [10, YARD, YARD, YARD] });
    s = applyMove(applyRoll(s, 6).state, 0).state;
    s = applyMove(applyRoll(s, 6).state, 0).state;
    expect(s.pos[0]![0]).toBe(22);
    const r = applyRoll(s, 6);
    expect(r.events.map((e) => e.e)).toEqual(["roll", "forfeit", "turn"]);
    expect(r.state.turn).toBe(2);
    expect(r.state.pos[0]![0]).toBe(22); // earlier moves stand
  });

  it("resets the six counter after another number", () => {
    let s = withPositions(classic2, { 0: [10, 20, YARD, YARD] });
    s = applyMove(applyRoll(s, 6).state, 0).state;
    s = applyMove(applyRoll(s, 6).state, 0).state;
    expect(s.sixes).toBe(2);
    const roll = applyRoll(s, 3);
    expect(roll.state.sixes).toBe(0);
    expect(roll.state.phase).toBe("move");
  });

  it("captures an opponent, sends it to the yard and grants an extra roll", () => {
    // Red token on absolute square 10; green comes from progress 46 (absolute 7) with a 3.
    const s = withPositions(classic4, { 0: [10, YARD, YARD, YARD], 1: [46, YARD, YARD, YARD] }, 1);
    expect(trackSquare(1, 49)).toBe(10);
    const rolled = applyRoll(s, 3).state;
    expect(rolled.movable).toEqual([0]);
    const r = applyMove(rolled, 0);
    expect(r.state.pos[0]![0]).toBe(YARD);
    expect(r.state.pos[1]![0]).toBe(49);
    expect(r.state.turn).toBe(1);
    expect(r.state.phase).toBe("roll");
    const move = r.events.find((e) => e.e === "move");
    expect(move).toMatchObject({ cap: [{ c: 0, t: 0, from: 10 }] });
    expect(r.events.at(-1)).toEqual({ e: "bonus", c: 1, why: "capture" });
  });

  it("captures every opponent token on the square", () => {
    const s = withPositions(classic4, { 0: [10, 10, YARD, YARD], 1: [46, YARD, YARD, YARD] }, 1);
    const r = applyMove(applyRoll(s, 3).state, 0);
    expect(r.state.pos[0]).toEqual([YARD, YARD, YARD, YARD]);
  });

  it("never captures on stars or start squares", () => {
    // Star at absolute 8 (red progress 8, green progress 47).
    let s = withPositions(classic4, { 0: [8, YARD, YARD, YARD], 1: [44, YARD, YARD, YARD] }, 1);
    let r = applyMove(applyRoll(s, 3).state, 0);
    expect(r.state.pos[0]![0]).toBe(8);
    expect(r.state.pos[1]![0]).toBe(47);
    expect(r.state.turn).toBe(2); // no bonus

    // Green's start square (absolute 13) holds a red token; green enters there with a six.
    s = withPositions(classic4, { 0: [13, YARD, YARD, YARD] }, 1);
    r = applyMove(applyRoll(s, 6).state, 0);
    expect(r.state.pos[0]![0]).toBe(13);
    expect(r.state.pos[1]![0]).toBe(0);
    expect(capturesAt(s, 1, 0)).toEqual([]);
  });

  it("doesn't capture a partner's token in 2 vs 2", () => {
    // Yellow (2) is red's partner. Yellow progress p with absolute 10: (26 + p) % 52 = 10 -> p = 36.
    const s = withPositions(teams, { 0: [7, YARD, YARD, YARD], 2: [36, YARD, YARD, YARD] }, 0);
    const r = applyMove(applyRoll(s, 3).state, 0);
    expect(r.state.pos[2]![0]).toBe(36);
    expect(r.state.pos[0]![0]).toBe(10);
  });

  it("needs the exact roll to finish and gives a bonus for reaching home", () => {
    let s = withPositions(classic2, { 0: [53, YARD, YARD, YARD] });
    let r = applyRoll(s, 4);
    expect(r.events.map((e) => e.e)).toEqual(["roll", "nomove", "turn"]);
    s = withPositions(classic2, { 0: [53, YARD, YARD, YARD] });
    r = applyRoll(s, 3);
    r = applyMove(r.state, 0);
    expect(r.state.pos[0]![0]).toBe(HOME);
    expect(r.events.at(-1)).toEqual({ e: "bonus", c: 0, why: "home" });
    expect(legalTokens(r.state, 0, 1)).toEqual([]);
  });

  it("moves from the last track square into the home column", () => {
    const s = withPositions(classic2, { 0: [48, YARD, YARD, YARD] });
    const r = applyMove(applyRoll(s, 5).state, 0);
    expect(r.state.pos[0]![0]).toBe(53);
  });

  it("rejects moves out of turn order or for tokens that can't move", () => {
    const s = withPositions(classic2, { 0: [10, YARD, YARD, YARD] });
    expect(() => applyMove(s, 0)).toThrow(RuleError);
    const rolled = applyRoll(s, 2).state;
    expect(() => applyRoll(rolled, 3)).toThrow(RuleError);
    expect(() => applyMove(rolled, 1)).toThrow(RuleError);
    expect(() => applyRoll(s, 7)).toThrow(RuleError);
    expect(() => applyRoll(s, 0)).toThrow(RuleError);
  });

  it("plays clockwise among the seated colours", () => {
    let s = createGame({ mode: "classic", teams: false, seats: [1, 2, 3] });
    const order: number[] = [];
    for (let i = 0; i < 6; i++) {
      order.push(s.turn);
      s = applyRoll(s, 2).state;
    }
    expect(order).toEqual([1, 2, 3, 1, 2, 3]);
  });
});

describe("winning", () => {
  it("ends a classic game when a player has all four tokens home", () => {
    const s = withPositions(classic2, { 0: [HOME, HOME, HOME, 54] });
    const r = applyMove(applyRoll(s, 2).state, 3);
    expect(r.state.phase).toBe("over");
    expect(r.state.winners).toEqual([0]);
    expect(r.events.map((e) => e.e)).toEqual(["move", "done", "win"]);
    expect(standings(r.state)[0]).toBe(0);
    expect(() => applyRoll(r.state, 3)).toThrow(RuleError);
  });

  it("ends a quick game at two tokens home", () => {
    const s = withPositions(quick, { 0: [HOME, 55, YARD, YARD] });
    const r = applyMove(applyRoll(s, 1).state, 1);
    expect(r.state.phase).toBe("over");
    expect(r.state.winners).toEqual([0]);
  });

  it("lets a finished 2 vs 2 player move their partner's tokens, and the team wins together", () => {
    let s = withPositions(teams, { 0: [HOME, HOME, HOME, HOME], 2: [HOME, HOME, HOME, 50] }, 0);
    let r = applyRoll(s, 3);
    expect(r.state.moveColor).toBe(2);
    expect(r.state.movable).toEqual([3]);
    r = applyMove(r.state, 3);
    expect(r.state.pos[2]![3]).toBe(53);
    expect(r.state.phase).toBe("roll");
    expect(r.state.turn).toBe(1);

    s = withPositions(teams, { 0: [HOME, HOME, HOME, HOME], 2: [HOME, HOME, HOME, 53] }, 0);
    r = applyMove(applyRoll(s, 3).state, 3);
    expect(r.state.phase).toBe("over");
    expect(r.state.winners).toEqual([0, 2]);
  });

  it("doesn't end a 2 vs 2 game when only one partner is done", () => {
    const s = withPositions(teams, { 0: [HOME, HOME, HOME, 54], 2: [10, YARD, YARD, YARD] }, 0);
    const r = applyMove(applyRoll(s, 2).state, 3);
    expect(r.state.phase).toBe("roll");
    expect(r.events.some((e) => e.e === "done")).toBe(true);
    expect(r.state.moveColor).toBe(2); // the bonus roll moves the partner's tokens
  });
});

describe("bots", () => {
  it("prefers captures and finishing, avoids danger at the normal level", () => {
    // Red rolls 3: token 0 captures green at absolute 10, token 1 just walks.
    const s = withPositions(classic4, { 0: [7, 30, YARD, YARD], 1: [49, YARD, YARD, YARD] }, 0);
    const rolled = applyRoll(s, 3).state;
    expect(chooseToken(rolled, "normal", () => 0.3)).toBe(0);
    expect(scoreMove(rolled, 0)).toBeGreaterThan(scoreMove(rolled, 1));
  });

  it("sees threats from tokens up to six squares behind", () => {
    const s = withPositions(classic4, { 0: [20, YARD, YARD, YARD], 1: [3, YARD, YARD, YARD] }, 0);
    // Green progress 3 = absolute 16; red at absolute 20 is 4 ahead of it.
    expect(threatsTo(s, 0, 20)).toBe(1);
    expect(threatsTo(s, 0, 21)).toBe(0); // star
    expect(threatsTo(s, 0, 30)).toBe(0); // too far
  });

  for (const level of ["easy", "normal"] as const) {
    for (const config of [classic2, classic4, teams, quick, { mode: "quick", teams: true, seats: [0, 1, 2, 3] } as GameConfig]) {
      it(`never makes an illegal move and always finishes (${level}, ${config.mode}, ${config.seats.length}p${config.teams ? ", teams" : ""})`, () => {
        let seed = 12345 + config.seats.length * 7 + (level === "easy" ? 1 : 2) + (config.teams ? 11 : 0);
        const random = () => {
          seed = (seed * 1103515245 + 12345) & 0x7fffffff;
          return seed / 0x80000000;
        };
        for (let game = 0; game < 25; game++) {
          let s = createGame(config);
          let steps = 0;
          while (s.phase !== "over") {
            if (++steps > 20000) throw new Error("game never ended");
            if (s.phase === "roll") {
              s = applyRoll(s, 1 + Math.floor(random() * 6)).state;
            } else {
              const t = chooseToken(s, level, random);
              if (!s.movable.includes(t)) throw new Error(`bot chose illegal token ${t}`);
              s = applyMove(s, t).state; // applyMove throws on anything illegal too
            }
            for (const row of s.pos) for (const p of row) if (p < YARD || p > HOME) throw new Error(`bad position ${p}`);
          }
          expect(s.winners.length).toBe(config.teams ? 2 : 1);
        }
      }, 60_000);
    }
  }
});
