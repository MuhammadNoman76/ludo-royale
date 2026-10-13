// Ludo Royale Worker: a tiny API in front of the two Durable Object classes, plus the web client
// (static assets, served by Cloudflare before this code runs for anything outside /api and /ws).
import { FRIEND_CODE_RE, ROOM_CODE_RE, newFriendCode, newRoomCode, newSecret } from "../../shared/src/protocol.js";
import { clientIp, json, originAllowed, problem, sha256Hex } from "./util.js";

export { PlayerDO } from "./player.js";
export { RoomDO } from "./room.js";

async function limited(limiter: RateLimit, key: string): Promise<boolean> {
  try {
    const { success } = await limiter.limit({ key });
    return !success;
  } catch {
    return false; // never lock everyone out because the limiter had a hiccup
  }
}

const TOO_MANY = () => problem(429, "slow-down", "Too many requests. Try again in a minute.", { "Retry-After": "60" });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const ip = clientIp(request);

    if (path === "/api/health") return json({ ok: true });

    if (path.startsWith("/api/") || path.startsWith("/ws/")) {
      if (!originAllowed(request, env)) return problem(403, "origin", "This page isn't allowed to use the game server.");
    }

    // A new player: a random friend code and a secret token. Only the token's hash is stored.
    if (path === "/api/identity") {
      if (request.method !== "POST") return problem(405, "method", "Use POST.", { Allow: "POST" });
      if (await limited(env.IDENTITY_LIMIT, ip)) return TOO_MANY();
      for (let attempt = 0; attempt < 6; attempt++) {
        const code = newFriendCode();
        const token = newSecret();
        const stub = env.PLAYERS.get(env.PLAYERS.idFromName(code));
        if (await stub.register(code, await sha256Hex(token))) return json({ code, token });
      }
      return problem(503, "busy", "Couldn't create a friend code. Try again.");
    }

    // A new room with a free 4-letter code.
    if (path === "/api/rooms") {
      if (request.method !== "POST") return problem(405, "method", "Use POST.", { Allow: "POST" });
      if (await limited(env.ROOM_LIMIT, ip)) return TOO_MANY();
      for (let attempt = 0; attempt < 12; attempt++) {
        const code = newRoomCode();
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        if (await stub.create(code)) return json({ code });
      }
      return problem(503, "busy", "Couldn't find a free room code. Try again.");
    }

    const room = /^\/ws\/room\/([A-Za-z]{4})$/.exec(path);
    const player = /^\/ws\/player\/(LUDO-[A-Z0-9]{4}-[A-Z0-9]{4})$/.exec(path);
    if (room || player) {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return problem(426, "upgrade", "Expected a WebSocket.");
      if (await limited(env.CONNECT_LIMIT, ip)) return TOO_MANY();
      if (room) {
        const code = room[1]!.toUpperCase();
        if (!ROOM_CODE_RE.test(code)) return problem(404, "no-room", "No such room.");
        return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(request);
      }
      const code = player![1]!;
      if (!FRIEND_CODE_RE.test(code)) return problem(404, "unknown", "No such player.");
      return env.PLAYERS.get(env.PLAYERS.idFromName(code)).fetch(request);
    }

    if (path.startsWith("/api/") || path.startsWith("/ws/")) return problem(404, "not-found", "Not found.");
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
