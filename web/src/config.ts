// Where the game server is. Browser players use the site that served the page; the Windows app
// (and `npm run dev:web`) use the configured server, VITE_SERVER_URL at build time by default.
import { APP_HOST, host, isApp } from "./host.js";

const BUILD_DEFAULT = (import.meta.env.VITE_SERVER_URL as string | undefined) || "https://ludo.nomanshafiq.com";

function isLocal(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/** Only HTTPS, except for a server on this computer (development). */
export function acceptableServer(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.username || u.password || u.search || u.hash) return null;
    if (u.protocol === "https:" || (u.protocol === "http:" && isLocal(u.hostname))) return u.origin;
  } catch {
    // not a URL
  }
  return null;
}

export function serverOrigin(): string {
  if (isApp) return acceptableServer(host.get().serverUrl ?? "") ?? BUILD_DEFAULT;
  // Served by the game server itself (production or `wrangler dev`).
  if (location.hostname !== APP_HOST && !import.meta.env.DEV) return location.origin;
  return acceptableServer(BUILD_DEFAULT) ?? location.origin;
}

export function wsOrigin(): string {
  return serverOrigin().replace(/^http/, "ws");
}

/** Links people share (room and friend links) point at the public site. */
export function publicOrigin(): string {
  return serverOrigin();
}

export function roomLink(code: string): string {
  return `${publicOrigin()}/r/${code}`;
}

export function friendLink(code: string): string {
  return `${publicOrigin()}/f/${code}`;
}
