// The bridge to the Windows app (WebView2). In a browser none of this exists and isApp is false.
import { Store } from "./store.js";

export const APP_HOST = "app.ludoroyale.example";

interface WebView {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (e: { data: unknown }) => void): void;
}

const webview: WebView | undefined = (window as unknown as { chrome?: { webview?: WebView } }).chrome?.webview;

/** Running inside Ludo Royale for Windows. */
export const isApp = !!webview && location.hostname === APP_HOST;

export interface AppSettings {
  startWithWindows: boolean;
  closeAction: "ask" | "tray" | "quit";
  protocol: boolean;
  dnd: boolean;
  checkUpdates: boolean;
}

export interface WindowState {
  mode: "normal" | "panel";
  side: "left" | "right";
  topmost: boolean;
}

export interface UpdateOffer {
  version: string;
  notes: string[];
  canInstall: boolean;
  progress: number | null;
  error: string | null;
}

export interface HostState {
  ready: boolean;
  version: string;
  serverUrl: string | null;
  identity: { code: string; token: string } | null;
  settings: AppSettings;
  window: WindowState;
  update: UpdateOffer | null;
}

export const host = new Store<HostState>({
  ready: !isApp,
  version: "",
  serverUrl: null,
  identity: null,
  settings: { startWithWindows: false, closeAction: "ask", protocol: false, dnd: false, checkUpdates: true },
  window: { mode: "normal", side: "right", topmost: false },
  update: null,
});

type ToastListener = (text: string) => void;
const toastListeners = new Set<ToastListener>();

/** Short messages from the app (for example the result of "Check for updates"). */
export function onHostToast(listener: ToastListener): () => void {
  toastListeners.add(listener);
  return () => toastListeners.delete(listener);
}

export type HostLink = { kind: "join"; value: string } | { kind: "friend"; value: string };
type LinkListener = (link: HostLink) => void;
const linkListeners = new Set<LinkListener>();
let pendingLinks: HostLink[] = [];

/** Links opened through ludoroyale:// (or the tray / a notification click). */
export function onHostLink(listener: LinkListener): () => void {
  linkListeners.add(listener);
  for (const link of pendingLinks) listener(link);
  pendingLinks = [];
  return () => linkListeners.delete(listener);
}

function emitLink(link: HostLink): void {
  if (linkListeners.size === 0) pendingLinks.push(link);
  for (const l of linkListeners) l(link);
}

export function postToHost(message: Record<string, unknown>): void {
  if (!isApp) return;
  try {
    webview!.postMessage(message);
  } catch {
    // host gone (closing)
  }
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function readSettings(v: unknown, fallback: AppSettings): AppSettings {
  if (!v || typeof v !== "object") return fallback;
  const o = v as Record<string, unknown>;
  return {
    startWithWindows: typeof o.startWithWindows === "boolean" ? o.startWithWindows : fallback.startWithWindows,
    closeAction: o.closeAction === "tray" || o.closeAction === "quit" || o.closeAction === "ask" ? o.closeAction : fallback.closeAction,
    protocol: typeof o.protocol === "boolean" ? o.protocol : fallback.protocol,
    dnd: typeof o.dnd === "boolean" ? o.dnd : fallback.dnd,
    checkUpdates: typeof o.checkUpdates === "boolean" ? o.checkUpdates : fallback.checkUpdates,
  };
}

function readWindow(v: unknown, fallback: WindowState): WindowState {
  if (!v || typeof v !== "object") return fallback;
  const o = v as Record<string, unknown>;
  return {
    mode: o.mode === "panel" ? "panel" : o.mode === "normal" ? "normal" : fallback.mode,
    side: o.side === "left" ? "left" : o.side === "right" ? "right" : fallback.side,
    topmost: typeof o.topmost === "boolean" ? o.topmost : fallback.topmost,
  };
}

function onMessage(data: unknown): void {
  if (!data || typeof data !== "object") return;
  const m = data as Record<string, unknown>;
  const s = host.get();
  switch (m.type) {
    case "init": {
      const id = m.identity as Record<string, unknown> | null | undefined;
      host.set({
        ...s,
        ready: true,
        version: str(m.version) ?? "",
        serverUrl: str(m.serverUrl),
        identity: id && str(id.code) && str(id.token) ? { code: id.code as string, token: id.token as string } : null,
        settings: readSettings(m.settings, s.settings),
        window: readWindow(m.window, s.window),
      });
      // Tell the app the page is up (when it started in the tray it can hide its window now).
      postToHost({ type: "started" });
      break;
    }
    case "link": {
      const kind = m.kind;
      const value = str(m.value);
      if ((kind === "join" || kind === "friend") && value) emitLink({ kind, value });
      break;
    }
    case "settings":
      host.set({ ...s, settings: readSettings(m.settings, s.settings) });
      break;
    case "toast": {
      const text = str(m.text);
      if (text && text.length <= 200) for (const l of toastListeners) l(text);
      break;
    }
    case "window":
      host.set({ ...s, window: readWindow(m, s.window) });
      break;
    case "update":
      host.set({
        ...s,
        update: m.version
          ? {
              version: str(m.version) ?? "",
              notes: Array.isArray(m.notes) ? m.notes.filter((n): n is string => typeof n === "string").slice(0, 8) : [],
              canInstall: m.canInstall === true,
              progress: typeof m.progress === "number" ? m.progress : null,
              error: str(m.error),
            }
          : null,
      });
      break;
  }
}

if (isApp) {
  webview!.addEventListener("message", (e) => onMessage(e.data));
  // Ask for the init message, and ask again until it arrives (the app may still be starting up).
  let asks = 0;
  const ask = () => {
    if (host.get().ready || asks++ > 30) return;
    postToHost({ type: "ready" });
    setTimeout(ask, 1000);
  };
  queueMicrotask(ask);
}

/** Opens an https link outside the game (the app hands it to the default browser). */
export function openExternal(url: string): void {
  if (!/^https:\/\//.test(url)) return;
  if (isApp) postToHost({ type: "open", url });
  else window.open(url, "_blank", "noopener,noreferrer");
}
