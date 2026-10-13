// Per-device preferences, kept in localStorage.
import { checkName } from "../../shared/src/protocol.js";
import { Store, storage } from "./store.js";

export type ThemePref = "system" | "light" | "dark";

export interface Prefs {
  name: string;
  theme: ThemePref;
  muted: boolean;
  /** Browser only: show system notifications while the tab is in the background. */
  notifications: boolean;
  botLevel: "easy" | "normal";
  soloBots: number;
  soloMode: "classic" | "quick";
  soloColor: number;
}

const KEY = "ludo.prefs";

function load(): Prefs {
  const saved = storage.json<Partial<Prefs>>(KEY, {});
  const name = typeof saved.name === "string" && checkName(saved.name).ok ? saved.name : "";
  return {
    name,
    theme: saved.theme === "light" || saved.theme === "dark" ? saved.theme : "system",
    muted: saved.muted === true,
    notifications: saved.notifications === true,
    botLevel: saved.botLevel === "easy" ? "easy" : "normal",
    soloBots: typeof saved.soloBots === "number" && saved.soloBots >= 1 && saved.soloBots <= 3 ? saved.soloBots : 3,
    soloMode: saved.soloMode === "quick" ? "quick" : "classic",
    soloColor: typeof saved.soloColor === "number" && saved.soloColor >= 0 && saved.soloColor <= 3 ? saved.soloColor : 0,
  };
}

export const prefs = new Store<Prefs>(load());
prefs.subscribe(() => storage.set(KEY, JSON.stringify(prefs.get())));

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
  prefs.set({ ...prefs.get(), [key]: value });
}

// ---------------------------------------------------------------- seat secrets (rejoin a room)

const SEATS = "ludo.seats";
const SEAT_DAYS = 2;

export function seatSecret(room: string): string | null {
  const all = storage.json<Record<string, { s: string; at: number }>>(SEATS, {});
  const entry = all[room];
  return entry && Date.now() - entry.at < SEAT_DAYS * 86400_000 ? entry.s : null;
}

export function saveSeatSecret(room: string, secret: string): void {
  const all = storage.json<Record<string, { s: string; at: number }>>(SEATS, {});
  const now = Date.now();
  for (const [k, v] of Object.entries(all)) if (now - v.at > SEAT_DAYS * 86400_000) delete all[k];
  all[room] = { s: secret, at: now };
  storage.set(SEATS, JSON.stringify(all));
}

export function forgetSeat(room: string): void {
  const all = storage.json<Record<string, { s: string; at: number }>>(SEATS, {});
  delete all[room];
  storage.set(SEATS, JSON.stringify(all));
}
