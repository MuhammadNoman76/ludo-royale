import { describe, expect, it } from "vitest";
import {
  FRIEND_CODE_RE,
  MAX_CLIENT_MESSAGE,
  ROOM_CODE_RE,
  checkName,
  isProfane,
  newFriendCode,
  newRoomCode,
  newSecret,
  normalizeFriendCode,
  normalizeRoomCode,
  parsePlayerMessage,
  parseRoomMessage,
  rollDie,
} from "../src/protocol.js";

describe("codes and secrets", () => {
  it("makes well-formed room and friend codes", () => {
    for (let i = 0; i < 500; i++) {
      expect(newRoomCode()).toMatch(ROOM_CODE_RE);
      expect(newFriendCode()).toMatch(FRIEND_CODE_RE);
    }
    expect(newSecret()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newSecret()).not.toBe(newSecret());
  });

  it("normalizes what people type", () => {
    expect(normalizeRoomCode(" abcd ")).toBe("ABCD");
    expect(normalizeRoomCode("ABIO")).toBeNull();
    expect(normalizeRoomCode("ABCDE")).toBeNull();
    expect(normalizeFriendCode("ludo-7k3m-q9p2")).toBe("LUDO-7K3M-Q9P2");
    expect(normalizeFriendCode("7K3MQ9P2")).toBe("LUDO-7K3M-Q9P2");
    expect(normalizeFriendCode("LUDO 7K3M Q9P2")).toBe("LUDO-7K3M-Q9P2");
    expect(normalizeFriendCode("LUDO-7K3M-Q9P0")).toBeNull();
  });

  it("rolls a fair die", () => {
    const counts = [0, 0, 0, 0, 0, 0];
    const n = 60000;
    for (let i = 0; i < n; i++) {
      const v = rollDie();
      expect(v >= 1 && v <= 6).toBe(true);
      counts[v - 1]!++;
    }
    for (const c of counts) expect(Math.abs(c - n / 6)).toBeLessThan(n / 6 * 0.06);
  });
});

describe("nicknames", () => {
  it("accepts ordinary names in any script", () => {
    for (const name of ["Noman", "Hassan", "Assad", "Dickens", "Ana-María", "عمر", "José_7", "O'Neil", "李雷"]) {
      const r = checkName(name);
      expect(r.ok, name).toBe(true);
    }
    expect(checkName("  Big   Ben ")).toEqual({ ok: true, name: "Big Ben" });
  });

  it("rejects bad lengths, characters and words", () => {
    expect(checkName("A").ok).toBe(false);
    expect(checkName("x".repeat(17)).ok).toBe(false);
    expect(checkName("<script>").ok).toBe(false);
    expect(checkName("hi‮there").ok).toBe(false);
    expect(checkName("a@b.com").ok).toBe(false);
    expect(checkName(42).ok).toBe(false);
    expect(checkName("_lead").ok).toBe(false);
    expect(isProfane("sh1t head")).toBe(true);
    expect(isProfane("F U C K")).toBe(true);
    expect(isProfane("big ass")).toBe(true);
    expect(isProfane("Hassan")).toBe(false);
    expect(checkName("Bitch").ok).toBe(false);
  });
});

describe("message validation", () => {
  it("accepts well-formed room messages", () => {
    expect(parseRoomMessage('{"t":"join","name":"Noman"}')).toEqual({ t: "join", name: "Noman" });
    expect(parseRoomMessage('{"t":"move","k":3}')).toEqual({ t: "move", k: 3 });
    expect(parseRoomMessage('{"t":"bot","c":1,"level":null}')).toEqual({ t: "bot", c: 1, level: null });
    expect(parseRoomMessage('{"t":"config","mode":"quick","teams":false}')).not.toBeNull();
    expect(parseRoomMessage('{"t":"react","r":7}')).not.toBeNull();
  });

  it("rejects anything unexpected", () => {
    const bad = [
      "not json",
      "[]",
      "null",
      '{"t":"roll","extra":1}',
      '{"t":"move","k":4}',
      '{"t":"move","k":1.5}',
      '{"t":"move","k":"1"}',
      '{"t":"seat","c":-1}',
      '{"t":"react","r":8}',
      '{"t":"bot","c":1,"level":"hard"}',
      '{"t":"config","mode":"chaos","teams":false}',
      '{"t":"join","name":"x","secret":"short"}',
      '{"t":"join","name":"x","friend":"LUDO-0000-0000"}',
      '{"t":"chat","text":"hi"}',
      '{"t":"__proto__"}',
      JSON.stringify({ t: "join", name: "x".repeat(MAX_CLIENT_MESSAGE) }),
    ];
    for (const raw of bad) expect(parseRoomMessage(raw), raw).toBeNull();
    expect(parseRoomMessage(42)).toBeNull();
  });

  it("checks friend messages", () => {
    expect(parsePlayerMessage('{"t":"add","code":"LUDO-7K3M-Q9P2"}')).not.toBeNull();
    expect(parsePlayerMessage('{"t":"invite","code":"LUDO-7K3M-Q9P2","room":"ABCD"}')).not.toBeNull();
    expect(parsePlayerMessage('{"t":"invite","code":"LUDO-7K3M-Q9P2","room":"abcd"}')).toBeNull();
    expect(parsePlayerMessage('{"t":"add","code":"7K3MQ9P2"}')).toBeNull();
    expect(parsePlayerMessage(`{"t":"auth","token":"${"a".repeat(43)}","name":"Noman"}`)).not.toBeNull();
    expect(parsePlayerMessage('{"t":"auth","token":"bad token","name":"Noman"}')).toBeNull();
  });
});
