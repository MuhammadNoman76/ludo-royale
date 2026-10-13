// Helpers for testing the Windows app on a developer PC without touching anything else:
// the page inside the app is driven through WebView2's DevTools port (no keyboard or mouse input is
// sent anywhere), screenshots come from PrintWindow of the app's own windows, and every window step
// first checks that no full-screen app or presentation is running.
import { execFileSync, spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const here = dirname(fileURLToPath(import.meta.url));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ps(args) {
  return execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(here, "capture.ps1"), ...args], { encoding: "utf8" }).trim();
}

/** Throws if a full-screen app, game, presentation or quiet time is active. */
export function ensureNotBusy() {
  const state = ps(["-Busy"]);
  if (state.startsWith("busy")) throw new Error(`The user is busy (${state}); not opening windows now.`);
}

export function capture(pid, out, which = "main") {
  ensureNotBusy();
  return ps(["-ProcessId", String(pid), "-Out", out, "-Which", which]);
}

export function postClose(pid) {
  return ps(["-ProcessId", String(pid), "-PostClose"]);
}

export function listWindows(pid) {
  return ps(["-ProcessId", String(pid), "-List"]);
}

export function launchApp(exe, env, args = [], port = 9333) {
  ensureNotBusy();
  const child = spawn(exe, args, {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, ...env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` },
  });
  return child;
}

export async function connectApp(port = 9333, ms = 30000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}`, defaultViewport: null });
      for (let i = 0; i < 40; i++) {
        const pages = await browser.pages();
        const page = pages.find((p) => p.url().startsWith("https://app.ludoroyale.example/"));
        if (page) return { browser, page };
        await sleep(250);
      }
      browser.disconnect();
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  throw new Error("Couldn't reach the app's DevTools port");
}

export async function clickText(page, selector, text) {
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

/** Runs a PowerShell snippet that uses UI Automation on the app's own process only. */
export function uia(pid, script) {
  const code = `
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, ${Number(pid)})
$wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
${script}`;
  return execFileSync("powershell", ["-NoProfile", "-Command", code], { encoding: "utf8" }).trim();
}

const EDGE = process.env.EDGE_PATH ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

/** A headless Edge player on the web version (it never shows a window). */
export async function browserPlayer(base, name, theme = "light", size = [430, 900]) {
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ["--no-first-run", "--mute-audio"] });
  const page = await browser.newPage();
  await page.setViewport({ width: size[0], height: size[1], deviceScaleFactor: 2 });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: theme }]);
  await page.goto(base + "/", { waitUntil: "networkidle0" });
  await page.evaluate((n) => localStorage.setItem("ludo.prefs", JSON.stringify({ name: n })), name);
  await page.reload({ waitUntil: "networkidle0" });
  return { browser, page };
}

/** Plays whenever it's this page's turn, through the same buttons a person uses. */
export function autoplay(page) {
  let stop = false;
  (async () => {
    while (!stop) {
      try {
        await page.evaluate(() => {
          const dice = document.querySelector("button.dice.ready");
          if (dice) return dice.click();
          const tokens = [...document.querySelectorAll("g.token.movable")];
          if (tokens.length) tokens[Math.floor(Math.random() * tokens.length)].dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
      } catch {
        // navigating
      }
      await sleep(250);
    }
  })();
  return () => {
    stop = true;
  };
}

export function regQuery(key, value) {
  try {
    const args = ["query", key];
    if (value !== undefined) args.push(value === "" ? "/ve" : "/v", ...(value === "" ? [] : [value]));
    return execFileSync("reg", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}
