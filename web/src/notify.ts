// In-page toasts plus system notifications: Windows notifications through the app, or the browser's
// Notification API (only after the player switched it on and granted permission).
import { isApp, postToHost } from "./host.js";
import { prefs } from "./prefs.js";
import { Store } from "./store.js";

export interface Toast {
  id: number;
  title: string;
  body?: string;
  tone: "info" | "good" | "warn";
  action?: { label: string; run: () => void };
}

export const toasts = new Store<Toast[]>([]);
let nextId = 1;

export function toast(title: string, opts: Omit<Toast, "id" | "title" | "tone"> & { tone?: Toast["tone"]; ms?: number } = {}): void {
  const t: Toast = { id: nextId++, title, body: opts.body, tone: opts.tone ?? "info", action: opts.action };
  toasts.update((list) => [...list.slice(-3), t]);
  setTimeout(() => dismiss(t.id), opts.ms ?? (opts.action ? 9000 : 3800));
}

export function dismiss(id: number): void {
  toasts.update((list) => list.filter((t) => t.id !== id));
}

export type AlertKind = "invite" | "turn" | "friend";

export interface Alert {
  kind: AlertKind;
  title: string;
  body: string;
  room?: string;
  friend?: string;
}

function windowFocused(): boolean {
  return !document.hidden && document.hasFocus();
}

// "Your turn" comes every few seconds in a game: notify once, then wait until the player is back.
let turnAlerted = false;
const back = () => {
  if (windowFocused()) turnAlerted = false;
};
document.addEventListener("visibilitychange", back);
window.addEventListener("focus", back);

/** A system notification when the player isn't looking at the game (the app decides for itself). */
export function systemAlert(alert: Alert, onClick?: () => void): void {
  if (isApp) {
    postToHost({ type: "notify", ...alert });
    return;
  }
  if (windowFocused() || !prefs.get().notifications) return;
  if (alert.kind === "turn") {
    if (!document.hidden || turnAlerted) return;
    turnAlerted = true;
  }
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    const n = new Notification(alert.title, { body: alert.body, tag: `${alert.kind}:${alert.room ?? alert.friend ?? ""}`, icon: "/icon-192.png" });
    n.onclick = () => {
      window.focus();
      onClick?.();
      n.close();
    };
  } catch {
    // some browsers only allow notifications from a service worker
  }
}

export async function enableBrowserNotifications(): Promise<boolean> {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  return (await Notification.requestPermission()) === "granted";
}

export function browserNotificationsSupported(): boolean {
  return typeof Notification !== "undefined";
}
