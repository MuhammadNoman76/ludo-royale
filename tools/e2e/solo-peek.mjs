import puppeteer from "puppeteer-core";
const [,, base, out, theme = "light", w = "420", h = "860", wait = "4000"] = process.argv;
const browser = await puppeteer.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true, args: ["--no-first-run", "--mute-audio"] });
const page = await browser.newPage();
await page.setViewport({ width: Number(w), height: Number(h), deviceScaleFactor: 2 });
await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: theme }]);
page.on("console", (m) => console.log("console:", m.type(), m.text()));
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.goto(base + "/", { waitUntil: "networkidle0" });
await page.evaluate(() => localStorage.setItem("ludo.prefs", JSON.stringify({ name: "Noman", soloBots: 3 })));
await page.goto(base + "/solo", { waitUntil: "networkidle0" });
const buttons = await page.$$("button.btn.primary.wide");
await buttons.at(-1).click();
// Play automatically as the human for a while.
const until = Date.now() + Number(wait);
while (Date.now() < until) {
  await page.evaluate(() => {
    const dice = document.querySelector("button.dice.ready");
    if (dice) { dice.click(); return; }
    const tok = document.querySelector("g.token.movable");
    if (tok) tok.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 300));
}
await page.screenshot({ path: out });
await browser.close();
console.log("ok", out);
