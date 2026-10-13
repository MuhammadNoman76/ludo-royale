// Integration tests against `wrangler dev --env test` (see global-setup.ts): real WebSockets,
// real Durable Objects, short timers (turn 2.5 s, reconnect grace 1.5 s, bots 60 ms, idle 40 s).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { APP_ORIGIN, BASE, Client, PlayerClient, RoomClient, autoPlay, newIdentity, newRoom, post, sleep } from "./helpers.js";

const open: Array<{ close(): void }> = [];
function track<T extends { close(): void }>(c: T): T {
  open.push(c);
  return c;
}

let idleRoom = "";
let idleCreated = 0;

beforeAll(async () => {
  // Created first and never used: it should be gone by the end of the run (ROOM_TTL_MS = 40 s).
  idleRoom = await newRoom();
  idleCreated = Date.now();
});

afterAll(() => {
  for (const c of open) c.close();
});

describe("HTTP API", () => {
  it("serves the web client and the health check", async () => {
    const health = await fetch(`${BASE}/api/health`);
    expect(await health.json()).toEqual({ ok: true });
    const page = await fetch(`${BASE}/r/ABCD`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("<!doctype html>");
  });

  it("only lets its own pages and the app use the API", async () => {
    expect((await post("/api/rooms", null)).status).toBe(403);
    expect((await post("/api/rooms", "https://evil.example")).status).toBe(403);
    expect((await post("/api/rooms", APP_ORIGIN)).status).toBe(200);
    expect((await fetch(`${BASE}/api/rooms`, { headers: { Origin: BASE } })).status).toBe(405);
    const evil = new Client(`/ws/room/ABCD`, "https://evil.example");
    await expect(evil.open()).rejects.toThrow(/403/);
  });

  it("lets the Windows app read API answers (CORS), and nobody else", async () => {
    const app = await post("/api/rooms", APP_ORIGIN);
    expect(app.headers.get("access-control-allow-origin")).toBe(APP_ORIGIN);
    const own = await post("/api/rooms");
    expect(own.headers.get("access-control-allow-origin")).toBeNull();
    const preflight = await fetch(`${BASE}/api/identity`, { method: "OPTIONS", headers: { Origin: APP_ORIGIN, "Access-Control-Request-Method": "POST" } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(APP_ORIGIN);
    const evil = await fetch(`${BASE}/api/identity`, { method: "OPTIONS", headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" } });
    expect(evil.status).toBe(403);
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("hands out friend codes and room codes", async () => {
    const id = await newIdentity();
    expect(id.code).toMatch(/^LUDO-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
    expect(id.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await newRoom()).toMatch(/^[A-HJ-NP-Z]{4}$/);
  });
});

describe("room protocol", () => {
  it("rejects bad input without trusting the client", async () => {
    const code = await newRoom();
    const c = track(new RoomClient(code));
    await c.open();
    c.send({ t: "roll" });
    expect(await c.wait((m) => m.t === "error")).toMatchObject({ code: "join-first" });
    c.send({ t: "join", name: "<b>x</b>" });
    expect(await c.wait((m) => m.t === "error")).toMatchObject({ code: "bad-name" });
    c.send({ t: "join", name: "Fuck face" });
    expect(await c.wait((m) => m.t === "error")).toMatchObject({ code: "bad-name" });
    c.send({ t: "join", name: "Ayesha" });
    const welcome = await c.wait((m) => m.t === "welcome");
    expect(welcome).toMatchObject({ t: "welcome", you: 0 });
    c.send("not json");
    expect(await c.wait((m) => m.t === "error")).toMatchObject({ code: "bad-message" });
    c.send({ t: "move", k: 9 });
    expect(await c.wait((m) => m.t === "error")).toMatchObject({ code: "bad-message" });
    c.send({ t: "chat", text: "hello" });
    expect(await c.wait((m) => m.t === "error")).toMatchObject({ code: "bad-message" });
    c.send({ t: "roll" });
    expect(await c.wait((m) => m.t === "error")).toMatchObject({ code: "rule" });
    c.send({ t: "start" });
    expect(await c.wait((m) => m.t === "error")).toMatchObject({ code: "rule", message: expect.stringContaining("one more") });
    c.send({ t: "join", name: "x".repeat(600) });
    expect((await c.waitClosed()).code).toBe(1009);
  });

  it("rate-limits a flood of messages", async () => {
    const code = await newRoom();
    const c = track(await RoomClient.join(code, "Flood"));
    for (let i = 0; i < 40; i++) c.send({ t: "ready", v: i % 2 === 0 });
    await c.wait((m) => m.t === "error" && m.code === "slow-down");
    expect(c.errors.some((e) => e.startsWith("slow-down"))).toBe(true);
  });

  it("says when a room doesn't exist", async () => {
    const c = track(new RoomClient("ZZZZ"));
    await c.open();
    c.send({ t: "join", name: "Nobody" });
    expect(await c.wait((m) => m.t === "error")).toMatchObject({ code: "no-room" });
  });
});

describe("full games", () => {
  it("plays a complete 4-player quick game: 2 humans + 2 bots, lobby to victory", async () => {
    const code = await newRoom();
    const a = track(await RoomClient.join(code, "Noman"));
    const b = track(await RoomClient.join(code, "Sara"));
    expect(a.you).toBe(0);
    expect(b.you).toBe(2); // opposite corner
    expect(a.room!.host).toBe(0);

    // Sara picks green instead; the host fills the other seats with bots and picks Quick.
    b.send({ t: "seat", c: 1 });
    await b.waitRoom((r) => r.seats[1]!.name === "Sara" && r.seats[2]!.kind === "empty");
    expect(b.you).toBe(1); // the server told the client its new seat
    b.send({ t: "bot", c: 2, level: "normal" });
    expect(await b.wait((m) => m.t === "error")).toMatchObject({ message: "Only the host can do that." });
    a.send({ t: "bot", c: 2, level: "normal" });
    a.send({ t: "bot", c: 3, level: "easy" });
    a.send({ t: "config", mode: "quick", teams: false });
    await a.waitRoom((r) => r.seats[2]!.kind === "bot" && r.seats[3]!.kind === "bot" && r.mode === "quick");
    a.send({ t: "start" });
    expect(await a.wait((m) => m.t === "error")).toMatchObject({ message: expect.stringContaining("ready") });
    b.send({ t: "ready", v: true });
    await a.waitRoom((r) => r.seats[1]!.ready);
    a.send({ t: "start" });
    await a.waitRoom((r) => r.phase === "playing");
    expect(a.room!.game!.pos[0]![0]).toBe(0); // quick mode: one token out
    a.errors.length = 0;
    b.errors.length = 0;

    const stopA = autoPlay(a, "random");
    const stopB = autoPlay(b, "random");
    const final = await a.waitRoom((r) => r.phase === "over", 90_000, "game over");
    stopA();
    stopB();
    expect(final.game!.winners).toHaveLength(1);
    const winner = final.game!.winners[0]!;
    expect(final.game!.pos[winner]!.filter((p) => p === 56).length).toBeGreaterThanOrEqual(2);
    // Nobody was told off by the rules: the clients only sent legal intents and bots played legally.
    expect([...a.errors, ...b.errors].filter((e) => e.startsWith("rule"))).toEqual([]);
    // Every roll the clients saw was a fair die value.
    const rolls = a.messages.flatMap((m) => (m.t === "room" && m.ev ? m.ev : [])).filter((e) => e.e === "roll");
    expect(rolls.length).toBeGreaterThan(5);
    for (const r of rolls) expect(r.e === "roll" && r.v >= 1 && r.v <= 6).toBe(true);

    // Rematch goes back to the lobby with the same people.
    b.send({ t: "rematch" });
    expect(await b.wait((m) => m.t === "error" && m.code === "rule")).toMatchObject({ message: "Only the host can do that." });
    a.send({ t: "rematch" });
    const lobby = await a.waitRoom((r) => r.phase === "lobby");
    expect(lobby.seats.map((s) => s.kind)).toEqual(["human", "human", "bot", "bot"]);
    expect(lobby.seats[1]!.ready).toBe(false);
  });

  it("plays a classic 2 vs 2 game to the end with bots taking a seat each", async () => {
    const code = await newRoom();
    const a = track(await RoomClient.join(code, "Bilal"));
    const b = track(await RoomClient.join(code, "Hina"));
    a.send({ t: "bot", c: 1, level: "normal" });
    a.send({ t: "bot", c: 3, level: "normal" });
    a.send({ t: "config", mode: "classic", teams: true });
    b.send({ t: "ready", v: true });
    await a.waitRoom((r) => r.seats.every((s) => s.kind !== "empty") && r.teams && r.seats[2]!.ready);
    a.send({ t: "start" });
    await a.waitRoom((r) => r.phase === "playing");
    const stopA = autoPlay(a);
    const stopB = autoPlay(b);
    const final = await a.waitRoom((r) => r.phase === "over", 240_000, "game over");
    stopA();
    stopB();
    const w = final.game!.winners;
    expect(w).toHaveLength(2);
    expect((w[0]! + 2) % 4).toBe(w[1]!); // partners
    for (const c of w) expect(final.game!.pos[c]!.every((p) => p === 56)).toBe(true);
    expect([...a.errors, ...b.errors].filter((e) => e.startsWith("rule"))).toEqual([]);
  });

  it("lets a dropped player rejoin their seat, with a bot covering for them meanwhile", async () => {
    const code = await newRoom();
    const a = track(await RoomClient.join(code, "Omar"));
    let b = track(await RoomClient.join(code, "Zara"));
    const secret = b.secret!;
    expect(secret).toBeTruthy();
    b.send({ t: "ready", v: true });
    a.send({ t: "config", mode: "quick", teams: false });
    await a.waitRoom((r) => r.seats[2]!.ready && r.mode === "quick");
    a.send({ t: "start" });
    await a.waitRoom((r) => r.phase === "playing");
    const stopA = autoPlay(a);

    // Zara's connection drops: after the grace period a bot plays her turns.
    b.ws.terminate();
    await a.waitRoom((r) => !r.seats[2]!.online, 5000, "offline");
    await a.waitRoom((r) => r.seats[2]!.auto, 5000, "bot takes over");
    const before = a.room!.game!.turnNo;
    await a.waitRoom((r) => r.game!.turnNo >= before + 4, 15_000, "turns go on");

    // She comes back with her seat secret: same seat, bot steps aside.
    b = track(await RoomClient.join(code, "Zara", { secret }));
    expect(b.you).toBe(2);
    await a.waitRoom((r) => r.seats[2]!.online && !r.seats[2]!.auto, 5000, "back");
    // A stranger without the secret only gets to watch.
    const s = track(await RoomClient.join(code, "Guest"));
    expect(s.you).toBeNull();
    await a.waitRoom((r) => r.spectators === 1);
    s.send({ t: "roll" });
    expect(await s.wait((m) => m.t === "error")).toMatchObject({ code: "rule" });

    const stopB = autoPlay(b);
    const final = await a.waitRoom((r) => r.phase === "over", 90_000, "game over");
    stopA();
    stopB();
    expect(final.game!.winners).toHaveLength(1);
  });

  it("plays for a player whose timer runs out, then lets a bot take over", async () => {
    const code = await newRoom();
    const a = track(await RoomClient.join(code, "Idle"));
    a.send({ t: "bot", c: 2, level: "easy" });
    await a.waitRoom((r) => r.seats[2]!.kind === "bot");
    a.send({ t: "start" });
    await a.waitRoom((r) => r.phase === "playing");
    // Do nothing: after two missed turns the bot plays for us.
    await a.waitRoom((r) => r.game!.turn === 0 && r.timer !== null, 10_000, "my turn");
    expect(a.room!.timer!).toBeLessThanOrEqual(2500);
    await a.waitRoom((r) => r.seats[0]!.auto, 20_000, "auto after missed turns");
    a.send({ t: "back" });
    await a.waitRoom((r) => !r.seats[0]!.auto, 5000, "back");
    a.send({ t: "leave" });
    expect(await a.wait((m) => m.t === "bye")).toMatchObject({ reason: "left" });
  });
});

describe("friends", () => {
  it("sends, accepts and removes friend requests, tracks presence and delivers invites", async () => {
    const [ida, idb, idc] = await Promise.all([newIdentity(), newIdentity(), newIdentity()]);
    const a = track(await PlayerClient.signIn(ida, "Ali"));
    let b = track(await PlayerClient.signIn(idb, "Bushra"));
    expect(a.last("me")).toMatchObject({ code: ida.code, name: "Ali", friends: [] });

    a.send({ t: "add", code: idb.code });
    expect(await b.wait((m) => m.t === "request")).toMatchObject({ code: ida.code, name: "Ali" });
    await a.wait((m) => m.t === "me" && m.outgoing.includes(idb.code));
    b.send({ t: "accept", code: ida.code });
    expect(await a.wait((m) => m.t === "friend")).toMatchObject({ friend: { code: idb.code, name: "Bushra", online: true } });
    await b.wait((m) => m.t === "me" && m.friends.some((f) => f.code === ida.code && f.online));

    // Presence follows the connection.
    b.close();
    expect(await a.wait((m) => m.t === "presence")).toEqual({ t: "presence", code: idb.code, online: false });
    b = track(await PlayerClient.signIn(idb, "Bushra"));
    expect(await a.wait((m) => m.t === "presence")).toEqual({ t: "presence", code: idb.code, online: true });

    // Invites go to friends only.
    a.send({ t: "invite", code: idb.code, room: "ABCD" });
    expect(await b.wait((m) => m.t === "invite")).toEqual({ t: "invite", from: ida.code, name: "Ali", room: "ABCD" });
    expect(await a.wait((m) => m.t === "info")).toMatchObject({ code: "invited" });
    a.send({ t: "invite", code: idc.code, room: "ABCD" });
    expect(await a.wait((m) => m.t === "error")).toMatchObject({ code: "not-friend" });

    // Unknown codes and your own code.
    a.send({ t: "add", code: "LUDO-2222-2222" });
    expect(await a.wait((m) => m.t === "error")).toMatchObject({ code: "not-found" });
    a.send({ t: "add", code: ida.code });
    expect(await a.wait((m) => m.t === "error")).toMatchObject({ code: "self" });

    // Blocking ends the friendship and silently swallows new requests.
    b.send({ t: "block", code: ida.code });
    expect(await a.wait((m) => m.t === "unfriend")).toEqual({ t: "unfriend", code: idb.code });
    a.send({ t: "add", code: idb.code });
    await a.wait((m) => m.t === "info" && m.code === "sent");
    await sleep(400);
    expect(b.messages.filter((m) => m.t === "request")).toHaveLength(0);

    // Requests in both directions become a friendship at once.
    const c = track(await PlayerClient.signIn(idc, "Chand"));
    c.send({ t: "add", code: ida.code });
    await a.wait((m) => m.t === "request" && m.code === idc.code);
    a.send({ t: "add", code: idc.code });
    await c.wait((m) => m.t === "friend");
    await a.wait((m) => m.t === "me" && m.friends.some((f) => f.code === idc.code));
    c.send({ t: "remove", code: ida.code });
    expect(await a.wait((m) => m.t === "unfriend")).toEqual({ t: "unfriend", code: idc.code });
  });

  it("refuses wrong tokens and unregistered codes", async () => {
    const id = await newIdentity();
    const bad = track(new PlayerClient(id.code));
    await bad.open();
    bad.send({ t: "auth", token: "x".repeat(43), name: "Mallory" });
    expect(await bad.wait((m) => m.t === "error")).toMatchObject({ code: "auth" });
    expect((await bad.waitClosed()).code).toBe(4401);

    const ghost = track(new PlayerClient("LUDO-2345-6789"));
    await ghost.open();
    ghost.send({ t: "auth", token: "y".repeat(43), name: "Ghost" });
    expect(await ghost.wait((m) => m.t === "error")).toMatchObject({ code: "unknown" });

    const early = track(new PlayerClient(id.code));
    await early.open();
    early.send({ t: "add", code: "LUDO-2345-6789" });
    expect((await early.waitClosed()).code).toBe(1008);
  });

  it("sends 'your turn' to a player who lost the room connection", async () => {
    const [ida, idb] = await Promise.all([newIdentity(), newIdentity()]);
    const pa = track(await PlayerClient.signIn(ida, "Asad"));
    const code = await newRoom();
    let a = track(await RoomClient.join(code, "Asad", { friend: ida.code }));
    const b = track(await RoomClient.join(code, "Bina", { friend: idb.code }));
    pa.send({ t: "watch", room: code });
    b.send({ t: "ready", v: true });
    await a.waitRoom((r) => r.seats[2]!.ready && r.seats[0]!.friend === ida.code);
    a.send({ t: "start" });
    await a.waitRoom((r) => r.phase === "playing");
    // Asad plays until it's Bina's turn, then his room connection drops.
    const stopA = autoPlay(a);
    await a.waitRoom((r) => r.game!.turn === 2, 20_000, "Bina's turn");
    stopA();
    const secret = a.secret!;
    a.ws.terminate();
    await b.waitRoom((r) => !r.seats[0]!.online, 5000);
    const stopB = autoPlay(b);
    const turn = await pa.wait((m) => m.t === "turn", 20_000, "your turn");
    stopB();
    expect(turn).toEqual({ t: "turn", room: code });
    a = track(await RoomClient.join(code, "Asad", { secret }));
    expect(a.you).toBe(0);
  });
});

describe("limits and clean-up", () => {
  it("forgets idle rooms", async () => {
    const wait = idleCreated + 41_000 - Date.now();
    if (wait > 0) await sleep(wait);
    const c = track(new RoomClient(idleRoom));
    await c.open();
    c.send({ t: "join", name: "Late" });
    expect(await c.wait((m) => m.t === "error" || m.t === "welcome")).toMatchObject({ t: "error", code: "no-room" });
  });

  it("limits how fast one address can create players", async () => {
    let limited = false;
    for (let i = 0; i < 60 && !limited; i++) {
      const r = await post("/api/identity");
      if (r.status === 429) limited = true;
      else expect(r.status).toBe(200);
    }
    expect(limited).toBe(true);
  });

  it("closes connections that never join", async () => {
    const code = await newRoom();
    const c = track(new RoomClient(code));
    await c.open();
    expect(await c.wait((m) => m.t === "bye", 20_000)).toEqual({ t: "bye", reason: "join-timeout" });
    // The server sent its close frame (the local dev proxy keeps TCP open a while longer).
    for (let i = 0; i < 40 && c.ws.readyState === WebSocket.OPEN; i++) await sleep(50);
    expect(c.ws.readyState).toBeGreaterThanOrEqual(WebSocket.CLOSING);
  }, 30_000);
});

