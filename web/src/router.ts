// Client-side routes: / (home), /r/<ROOM> (a room), /f/<FRIEND CODE> (add a friend), /solo.
import { normalizeFriendCode, normalizeRoomCode } from "../../shared/src/protocol.js";
import { Store } from "./store.js";

export type Route = { name: "home" } | { name: "room"; code: string } | { name: "solo" } | { name: "friend"; code: string };

export function parseRoute(path: string): Route {
  const room = /^\/r\/([^/]+)\/?$/i.exec(path);
  if (room) {
    const code = normalizeRoomCode(decodeURIComponent(room[1]!));
    if (code) return { name: "room", code };
  }
  const friend = /^\/f\/([^/]+)\/?$/i.exec(path);
  if (friend) {
    const code = normalizeFriendCode(decodeURIComponent(friend[1]!));
    if (code) return { name: "friend", code };
  }
  if (/^\/solo\/?$/.test(path)) return { name: "solo" };
  return { name: "home" };
}

export function routePath(r: Route): string {
  switch (r.name) {
    case "room":
      return `/r/${r.code}`;
    case "friend":
      return `/f/${r.code}`;
    case "solo":
      return "/solo";
    default:
      return "/";
  }
}

export const route = new Store<Route>(parseRoute(location.pathname));

export function navigate(r: Route, replace = false): void {
  const path = routePath(r);
  try {
    if (replace) history.replaceState(null, "", path);
    else if (location.pathname !== path) history.pushState(null, "", path);
  } catch {
    // ignore (sandboxed)
  }
  route.set(r);
}

window.addEventListener("popstate", () => route.set(parseRoute(location.pathname)));
