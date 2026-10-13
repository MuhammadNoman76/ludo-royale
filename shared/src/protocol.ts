// Messages between the game client and the server, and the strict checks applied to everything a
// client sends. Clients only send intents ("roll", "move token 2"); the server owns the game.
import type { BotLevel } from "./bot.js";
import type { GameEvent, GameState, Mode } from "./engine.js";

export const PROTOCOL_VERSION = 1;

/** Largest message a client may send (bytes). Every valid message is far smaller. */
export const MAX_CLIENT_MESSAGE = 512;

/** Fixed reactions (no free-text chat). Clients send the index. */
export const REACTIONS = ["👍", "😂", "😮", "😢", "😡", "🎉", "🔥", "👋"] as const;

// ---------------------------------------------------------------- codes

/** Room codes: 4 letters without I and O (easy to read out loud). */
export const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
export const ROOM_CODE_RE = /^[A-HJ-NP-Z]{4}$/;

/** Friend codes look like LUDO-7K3M-Q9P2 (no 0/O, 1/I/L). */
export const FRIEND_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const FRIEND_CODE_RE = /^LUDO-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/;

/** Secrets (player token, seat secret): base64url, 22..64 characters. */
export const SECRET_RE = /^[A-Za-z0-9_-]{22,64}$/;

export function normalizeRoomCode(text: string): string | null {
  const code = text.trim().toUpperCase();
  return ROOM_CODE_RE.test(code) ? code : null;
}

export function normalizeFriendCode(text: string): string | null {
  let code = text.trim().toUpperCase().replace(/\s+/g, "");
  if (/^[2-9A-HJKMNP-Z]{8}$/.test(code)) code = "LUDO" + code;
  if (/^LUDO[2-9A-HJKMNP-Z]{8}$/.test(code)) code = `LUDO-${code.slice(4, 8)}-${code.slice(8)}`;
  return FRIEND_CODE_RE.test(code) ? code : null;
}

// ---------------------------------------------------------------- nicknames

export const NAME_MIN = 2;
export const NAME_MAX = 16;

// Small, deliberately conservative list. Short words are matched as whole words only, so names
// such as Hassan or Assad are fine.
const BLOCKED_PARTS = [
  "fuck", "shit", "bitch", "cunt", "nigger", "nigga", "faggot", "whore", "slut", "rapist", "pussy",
  "dickhead", "asshole", "bastard", "motherf", "wanker", "retard", "chutiya", "bhenchod", "behenchod",
  "madarchod", "bhosd", "gaandu", "harami", "kanjar", "penis", "vagina", "porn",
];
const BLOCKED_WORDS = new Set([
  "ass", "arse", "dick", "cock", "fag", "nazi", "hitler", "sex", "boob", "boobs", "tits", "cum", "rape",
  "kys", "gandu", "lund", "chod", "kutta", "kutti", "suar",
]);

function deLeet(text: string): string {
  return text
    .toLowerCase()
    .replace(/[0]/g, "o")
    .replace(/[1!|]/g, "i")
    .replace(/[3]/g, "e")
    .replace(/[4@]/g, "a")
    .replace(/[5$]/g, "s")
    .replace(/[7]/g, "t")
    .replace(/[8]/g, "b");
}

export function isProfane(name: string): boolean {
  const clean = deLeet(name);
  const squashed = clean.replace(/[^a-z]/g, "");
  for (const part of BLOCKED_PARTS) if (squashed.includes(part)) return true;
  for (const word of clean.split(/[^a-z]+/)) if (word && BLOCKED_WORDS.has(word)) return true;
  return false;
}

/** Returns the cleaned nickname, or an error message. */
export function checkName(input: unknown): { ok: true; name: string } | { ok: false; error: string } {
  if (typeof input !== "string") return { ok: false, error: "Pick a nickname." };
  const name = input.normalize("NFC").trim().replace(/\s+/g, " ");
  const length = [...name].length;
  if (length < NAME_MIN) return { ok: false, error: `Nicknames need at least ${NAME_MIN} characters.` };
  if (length > NAME_MAX) return { ok: false, error: `Nicknames can have up to ${NAME_MAX} characters.` };
  if (!/^[\p{L}\p{N}][\p{L}\p{M}\p{N} _.'-]*$/u.test(name))
    return { ok: false, error: "Use letters, numbers, spaces and - _ . ' only." };
  if (isProfane(name)) return { ok: false, error: "Please choose a friendlier nickname." };
  return { ok: true, name };
}

// ---------------------------------------------------------------- room protocol

export type SeatKind = "empty" | "human" | "bot";

export interface SeatView {
  kind: SeatKind;
  name: string;
  ready: boolean;
  /** A human seat with an open connection. */
  online: boolean;
  /** A bot plays this human's turns (they left, lost their connection or missed turns). */
  auto: boolean;
  bot: BotLevel | null;
  /** The player's friend code, if they shared it (lets others send a friend request). */
  friend: string | null;
}

export type RoomPhase = "lobby" | "playing" | "over";

export interface RoomView {
  code: string;
  phase: RoomPhase;
  host: number | null;
  mode: Mode;
  teams: boolean;
  seats: SeatView[];
  game: GameState | null;
  /** Milliseconds left for the current human turn (null when no timer runs). */
  timer: number | null;
  /** Total length of a turn's timer, for drawing the countdown. */
  turnMs: number;
  spectators: number;
}

export type RoomClientMessage =
  | { t: "join"; name: string; secret?: string; friend?: string; v?: number }
  | { t: "seat"; c: number }
  | { t: "ready"; v: boolean }
  | { t: "bot"; c: number; level: BotLevel | null }
  | { t: "config"; mode: Mode; teams: boolean }
  | { t: "start" }
  | { t: "roll" }
  | { t: "move"; k: number }
  | { t: "react"; r: number }
  | { t: "back" }
  | { t: "rematch" }
  | { t: "leave" };

export type RoomServerMessage =
  | { t: "welcome"; you: number | null; secret: string | null; room: RoomView }
  | { t: "room"; room: RoomView; ev?: GameEvent[] }
  | { t: "you"; you: number | null }
  | { t: "react"; c: number; r: number }
  | { t: "error"; code: string; message: string }
  | { t: "bye"; reason: string };

// ---------------------------------------------------------------- friends protocol

export interface FriendView {
  code: string;
  name: string;
  online: boolean;
}

export type PlayerClientMessage =
  | { t: "auth"; token: string; name: string; v?: number }
  | { t: "name"; name: string }
  | { t: "add"; code: string }
  | { t: "accept"; code: string }
  | { t: "decline"; code: string }
  | { t: "remove"; code: string }
  | { t: "block"; code: string }
  | { t: "unblock"; code: string }
  | { t: "invite"; code: string; room: string }
  | { t: "watch"; room: string };

export type PlayerServerMessage =
  | {
      t: "me";
      code: string;
      name: string;
      friends: FriendView[];
      incoming: { code: string; name: string }[];
      outgoing: string[];
      blocked: string[];
    }
  | { t: "presence"; code: string; online: boolean }
  | { t: "request"; code: string; name: string }
  | { t: "friend"; friend: FriendView }
  | { t: "unfriend"; code: string }
  | { t: "invite"; from: string; name: string; room: string }
  | { t: "turn"; room: string }
  | { t: "info"; code: string; message: string }
  | { t: "error"; code: string; message: string };

// ---------------------------------------------------------------- validation

type Json = Record<string, unknown>;

function parseObject(raw: unknown): Json | null {
  if (typeof raw !== "string" || raw.length > MAX_CLIENT_MESSAGE) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Json;
}

/** True when obj has exactly these keys (optional ones may be missing). */
function hasOnly(obj: Json, required: string[], optional: string[] = []): boolean {
  for (const k of required) if (!(k in obj)) return false;
  for (const k of Object.keys(obj)) if (!required.includes(k) && !optional.includes(k)) return false;
  return true;
}

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

export function parseRoomMessage(raw: unknown): RoomClientMessage | null {
  const m = parseObject(raw);
  if (!m || typeof m.t !== "string") return null;
  switch (m.t) {
    case "join":
      if (!hasOnly(m, ["t", "name"], ["secret", "friend", "v"])) return null;
      if (typeof m.name !== "string" || m.name.length > 64) return null;
      if (m.secret !== undefined && (typeof m.secret !== "string" || !SECRET_RE.test(m.secret))) return null;
      if (m.friend !== undefined && (typeof m.friend !== "string" || !FRIEND_CODE_RE.test(m.friend))) return null;
      if (m.v !== undefined && !isInt(m.v, 0, 1000)) return null;
      return m as RoomClientMessage;
    case "seat":
      return hasOnly(m, ["t", "c"]) && isInt(m.c, 0, 3) ? (m as RoomClientMessage) : null;
    case "ready":
      return hasOnly(m, ["t", "v"]) && typeof m.v === "boolean" ? (m as RoomClientMessage) : null;
    case "bot":
      return hasOnly(m, ["t", "c", "level"]) && isInt(m.c, 0, 3) && (m.level === null || m.level === "easy" || m.level === "normal")
        ? (m as RoomClientMessage)
        : null;
    case "config":
      return hasOnly(m, ["t", "mode", "teams"]) && (m.mode === "classic" || m.mode === "quick") && typeof m.teams === "boolean"
        ? (m as RoomClientMessage)
        : null;
    case "move":
      return hasOnly(m, ["t", "k"]) && isInt(m.k, 0, 3) ? (m as RoomClientMessage) : null;
    case "react":
      return hasOnly(m, ["t", "r"]) && isInt(m.r, 0, REACTIONS.length - 1) ? (m as RoomClientMessage) : null;
    case "start":
    case "roll":
    case "back":
    case "rematch":
    case "leave":
      return hasOnly(m, ["t"]) ? (m as RoomClientMessage) : null;
    default:
      return null;
  }
}

export function parsePlayerMessage(raw: unknown): PlayerClientMessage | null {
  const m = parseObject(raw);
  if (!m || typeof m.t !== "string") return null;
  switch (m.t) {
    case "auth":
      if (!hasOnly(m, ["t", "token", "name"], ["v"])) return null;
      if (typeof m.token !== "string" || !SECRET_RE.test(m.token)) return null;
      if (typeof m.name !== "string" || m.name.length > 64) return null;
      if (m.v !== undefined && !isInt(m.v, 0, 1000)) return null;
      return m as PlayerClientMessage;
    case "name":
      return hasOnly(m, ["t", "name"]) && typeof m.name === "string" && m.name.length <= 64 ? (m as PlayerClientMessage) : null;
    case "add":
    case "accept":
    case "decline":
    case "remove":
    case "block":
    case "unblock":
      return hasOnly(m, ["t", "code"]) && typeof m.code === "string" && FRIEND_CODE_RE.test(m.code)
        ? (m as PlayerClientMessage)
        : null;
    case "invite":
      return hasOnly(m, ["t", "code", "room"]) &&
        typeof m.code === "string" &&
        FRIEND_CODE_RE.test(m.code) &&
        typeof m.room === "string" &&
        ROOM_CODE_RE.test(m.room)
        ? (m as PlayerClientMessage)
        : null;
    case "watch":
      return hasOnly(m, ["t", "room"]) && typeof m.room === "string" && ROOM_CODE_RE.test(m.room) ? (m as PlayerClientMessage) : null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------- random codes

/** Unbiased random index below `n` (n <= 256) from crypto random bytes. */
export function randomIndex(n: number, bytes: () => Uint8Array): number {
  const limit = 256 - (256 % n);
  for (;;) {
    for (const b of bytes()) if (b < limit) return b % n;
  }
}

export function randomCode(alphabet: string, length: number): string {
  let out = "";
  const bytes = () => crypto.getRandomValues(new Uint8Array(16));
  for (let i = 0; i < length; i++) out += alphabet[randomIndex(alphabet.length, bytes)];
  return out;
}

export function newRoomCode(): string {
  return randomCode(ROOM_ALPHABET, 4);
}

export function newFriendCode(): string {
  return `LUDO-${randomCode(FRIEND_ALPHABET, 4)}-${randomCode(FRIEND_ALPHABET, 4)}`;
}

/** 32 random bytes as base64url (43 characters). */
export function newSecret(byteCount = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteCount));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A fair die roll (1..6) from the platform's cryptographic random generator. */
export function rollDie(): number {
  return randomIndex(6, () => crypto.getRandomValues(new Uint8Array(8))) + 1;
}
