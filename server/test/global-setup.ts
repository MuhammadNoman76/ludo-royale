// Starts `wrangler dev --env test` (short timers) on a private port for the integration tests and
// stops it (and its workerd child) afterwards.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const PORT = 8799;
const root = resolve(import.meta.dirname, "../..");

let child: ChildProcess | null = null;
let persist = "";

async function waitForServer(url: string, ms: number): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`wrangler dev didn't start within ${ms / 1000} s`);
}

export async function setup(): Promise<void> {
  const dist = join(root, "web", "dist");
  if (!existsSync(join(dist, "index.html"))) {
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(dist, "index.html"), "<!doctype html><title>Ludo Royale</title>");
  }
  persist = mkdtempSync(join(tmpdir(), "ludo-it-"));
  const wrangler = join(root, "node_modules", "wrangler", "bin", "wrangler.js");
  child = spawn(
    process.execPath,
    [wrangler, "dev", "-c", "server/wrangler.jsonc", "--env", "test", "--port", String(PORT), "--ip", "127.0.0.1", "--persist-to", persist, "--show-interactive-dev-session=false", "--log-level", "warn"],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" } },
  );
  child.stdout?.on("data", (b: Buffer) => process.env.LUDO_IT_VERBOSE && process.stdout.write(b));
  child.stderr?.on("data", (b: Buffer) => process.stderr.write(b));
  await waitForServer(`http://127.0.0.1:${PORT}/api/health`, 90_000);
}

export async function teardown(): Promise<void> {
  if (child?.pid) {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill("SIGTERM");
  }
  child = null;
  await new Promise((r) => setTimeout(r, 500));
  try {
    rmSync(persist, { recursive: true, force: true });
  } catch {
    // workerd may still hold a file for a moment
  }
}
