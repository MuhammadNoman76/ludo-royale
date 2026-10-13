// Your friend code and its secret token. The server hands both out once; the app keeps them in
// %APPDATA%\LudoRoyale (token encrypted for the Windows user), the browser in localStorage.
import { FRIEND_CODE_RE, SECRET_RE } from "../../shared/src/protocol.js";
import { serverOrigin } from "./config.js";
import { host, isApp, postToHost } from "./host.js";
import { storage } from "./store.js";

export interface Identity {
  code: string;
  token: string;
}

const KEY = "ludo.identity";

function valid(id: unknown): id is Identity {
  if (!id || typeof id !== "object") return false;
  const o = id as Record<string, unknown>;
  return typeof o.code === "string" && FRIEND_CODE_RE.test(o.code) && typeof o.token === "string" && SECRET_RE.test(o.token);
}

export function storedIdentity(): Identity | null {
  if (isApp) {
    const id = host.get().identity;
    return valid(id) ? id : null;
  }
  const id = storage.json<unknown>(KEY, null);
  return valid(id) ? id : null;
}

let creating: Promise<Identity | null> | null = null;

/** The saved identity, or a new one from the server (null while the server can't be reached). */
export function ensureIdentity(): Promise<Identity | null> {
  const existing = storedIdentity();
  if (existing) return Promise.resolve(existing);
  creating ??= (async () => {
    try {
      const r = await fetch(`${serverOrigin()}/api/identity`, { method: "POST", credentials: "omit", cache: "no-store" });
      if (!r.ok) return null;
      const id = (await r.json()) as unknown;
      if (!valid(id)) return null;
      if (isApp) {
        postToHost({ type: "identity", code: id.code, token: id.token });
        host.set({ ...host.get(), identity: id });
      } else {
        storage.set(KEY, JSON.stringify({ code: id.code, token: id.token }));
      }
      return id;
    } catch {
      return null;
    } finally {
      creating = null;
    }
  })();
  return creating;
}
