// Small helpers shared by the Worker and the Durable Objects.

export interface Settings {
  turnMs: number;
  graceMs: number;
  botDelayMs: number;
  roomTtlMs: number;
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

export function settingsFrom(env: Env): Settings {
  return {
    turnMs: num(env.TURN_MS, 20_000, 1_000, 120_000),
    graceMs: num(env.GRACE_MS, 30_000, 500, 600_000),
    botDelayMs: num(env.BOT_DELAY_MS, 900, 20, 10_000),
    roomTtlMs: num(env.ROOM_TTL_MS, 7_200_000, 10_000, 86_400_000),
  };
}

const SECURITY_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...SECURITY_HEADERS, ...extra },
  });
}

export function problem(status: number, code: string, message: string, extra: Record<string, string> = {}): Response {
  return json({ error: code, message }, status, extra);
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compares two strings without leaking where they differ. */
export function sameSecret(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  return crypto.subtle.timingSafeEqual(ea, eb);
}

/**
 * Browsers always send Origin on WebSocket and POST requests. Only this Worker's own pages and the
 * listed app origins may use the game API, so other websites can't drive a visitor's connection.
 */
export function originAllowed(request: Request, env: Env): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  const own = new URL(request.url).origin;
  if (origin === own) return true;
  const list = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.includes(origin);
}

export function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "local";
}

/** Token bucket: `burst` messages at once, refilled at `perSecond`. */
export class Bucket {
  private tokens: number;
  private last = Date.now();

  constructor(
    private readonly burst: number,
    private readonly perSecond: number,
  ) {
    this.tokens = burst;
  }

  take(cost = 1): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.perSecond);
    this.last = now;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}

/** Sends on a socket, ignoring sockets that closed meanwhile. */
export function send(ws: WebSocket, message: unknown): void {
  try {
    ws.send(JSON.stringify(message));
  } catch {
    // closed
  }
}

export function closeSocket(ws: WebSocket, code: number, reason: string): void {
  try {
    ws.close(code, reason);
  } catch {
    // already closed
  }
}
