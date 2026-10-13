// End-to-end run with two headless Edge browsers against a running server (npm run dev):
// friend request + accept, room creation, invite (in-page notification), lobby with bots, a full
// game played through the real UI, victory. Saves screenshots.
//   node tools/e2e/play.mjs [server] [screenshot folder]
//   defaults: http://127.0.0.1:8787  tools/e2e/out
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import puppeteer from "puppeteer-core";

const base = process.argv[2] ?? "http://127.0.0.1:8787";
const out = resolve(process.argv[3] ?? "tools/e2e/out");
const mode = process.env.LUDO_MODE ?? "quick";
mkdirSync(out, { recursive: true });

const EDGE = process.env.EDGE_PATH ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function client(name, theme, size) {
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ["--no-first-run", "--mute-audio", "--disable-features=Translate"] });
  const page = await browser.newPage();
  await page.setViewport({ width: size[0], height: size[1], deviceScaleFactor: 2 });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: theme }]);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(base + "/", { waitUntil: "networkidle0" });
  await page.evaluate((n) => localStorage.setItem("ludo.prefs", JSON.stringify({ name: n, notifications: false })), name);
  await page.reload({ waitUntil: "networkidle0" });
  return { browser, page, errors, name };
}

async function shot(c, file) {
  await c.page.screenshot({ path: join(out, file) });
  log("screenshot", file);
}

async function clickText(page, selector, text) {
  const ok = await page.evaluate(
    (sel, t) => {
      const el = [...document.querySelectorAll(sel)].find((e) => e.textContent?.trim().includes(t) && !e.disabled);
      if (!el) return false;
      el.click();
      return true;
    },
    selector,
    text,
  );
  if (!ok) throw new Error(`no ${selector} with "${text}"`);
}

async function waitText(page, text, ms = 15000) {
  await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout: ms }, text);
}

async function friendCode(page) {
  await page.waitForFunction(() => document.querySelector(".status-dot.online"), { timeout: 20000 });
  await page.click('button[aria-label="Friends"]');
  await page.waitForSelector(".friend-code");
  const code = await page.$eval(".friend-code", (e) => e.textContent.trim());
  return code;
}

/** Plays whenever it's this client's turn, through the same buttons a person uses. */
function autoplay(c) {
  let stop = false;
  (async () => {
    while (!stop) {
      try {
        await c.page.evaluate(() => {
          const dice = document.querySelector("button.dice.ready");
          if (dice) return dice.click();
          const tokens = [...document.querySelectorAll("g.token.movable")];
          if (tokens.length) tokens[Math.floor(Math.random() * tokens.length)].dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
      } catch {
        // navigation in progress
      }
      await sleep(250);
    }
  })();
  return () => {
    stop = true;
  };
}

const a = await client("Noman", "light", [430, 900]);
const b = await client("Sara", "dark", [430, 900]);
try {
  // ---- friends: Sara adds Noman by code, Noman accepts from the toast
  const codeA = await friendCode(a.page);
  log("Noman's friend code", codeA);
  await b.page.waitForFunction(() => document.querySelector(".status-dot.online"), { timeout: 20000 });
  await b.page.click('button[aria-label="Friends"]');
  await b.page.waitForSelector("#friend-code");
  await b.page.type("#friend-code", codeA);
  await clickText(b.page, ".add-friend button", "Add");
  await waitText(a.page, "wants to be friends");
  await clickText(a.page, ".toast button", "Accept");
  await a.page.waitForFunction(() => document.querySelectorAll(".friend-row .dot.online").length > 0, { timeout: 15000 });
  await sleep(400);
  await shot(a, "friends-panel.png");
  await a.page.keyboard.press("Escape");
  await b.page.keyboard.press("Escape");

  // ---- Noman creates a room and invites Sara
  await clickText(a.page, "button", "Create a room");
  await a.page.waitForSelector(".room-code", { timeout: 15000 });
  const room = await a.page.$eval(".room-code", (e) => e.textContent.trim());
  log("room", room);
  await a.page.waitForSelector(".invite-row button");
  await clickText(a.page, ".invite-row button", "Invite");
  await waitText(b.page, "invited you to play");
  await sleep(300);
  await shot(b, "invite-notification.png");
  await clickText(b.page, ".toast button", "Join");
  await b.page.waitForSelector(".seats", { timeout: 15000 });

  // ---- lobby: two bots, mode, ready, start
  await a.page.waitForFunction(() => document.body.innerText.includes("Sara"), { timeout: 15000 });
  for (let i = 0; i < 2; i++) {
    await clickText(a.page, ".seat button", "Add bot");
    await sleep(400);
  }
  if (mode === "quick") await clickText(a.page, ".segmented button", "Quick");
  await sleep(300);
  await clickText(b.page, "button", "I'm ready");
  await a.page.waitForFunction(() => !document.querySelector(".lobby-actions .btn.primary")?.disabled, { timeout: 10000 });
  await shot(a, "lobby-share.png");
  await clickText(a.page, ".lobby-actions button", "Start game");
  await a.page.waitForSelector("svg.board", { timeout: 15000 });
  await b.page.waitForSelector("svg.board", { timeout: 15000 });
  log("game started");

  // ---- play
  const stopA = autoplay(a);
  const stopB = autoplay(b);
  let shotLight = false;
  let shotDark = false;
  const started = Date.now();
  while (Date.now() - started < 15 * 60_000) {
    await sleep(1000);
    const over = await a.page.evaluate(() => !!document.querySelector(".victory"));
    if (!shotLight && Date.now() - started > 25_000) {
      await shot(a, "board-light.png");
      shotLight = true;
    }
    if (!shotDark && Date.now() - started > 27_000) {
      await shot(b, "board-dark.png");
      shotDark = true;
    }
    if (over) break;
  }
  stopA();
  stopB();
  await a.page.waitForSelector(".victory", { timeout: 5000 });
  await sleep(900);
  await shot(a, "victory.png");
  await shot(b, "victory-dark.png");
  const winner = await a.page.$eval(".victory h2", (e) => e.textContent);
  log("result:", winner, `after ${Math.round((Date.now() - started) / 1000)} s`);
  if (a.errors.length || b.errors.length) log("page errors:", a.errors, b.errors);
  else log("no page errors");
} finally {
  await a.browser.close();
  await b.browser.close();
}
