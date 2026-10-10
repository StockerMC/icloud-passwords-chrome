// Pairs the built extension with the helper, lists logins, fills a local form.
// BROWSER picks the executable; it must be signed and honor --load-extension.
import { chromium } from "playwright";
import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";

const root = new URL("..", import.meta.url).pathname;
const dist = path.join(root, "dist");
const pinFile = path.join(root, "e2e", ".pin");
const exe = process.env.BROWSER ?? "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const hosts = (process.env.HOSTS ?? "github.com,google.com").split(",");

const server = createServer((_req, res) => {
  res.setHeader("content-type", "text/html");
  res.end(`<form><input name="email" type="email" placeholder="Email"><input name="pw" type="password"><button>Sign in</button></form>`);
}).listen(8787);

fs.rmSync(pinFile, { force: true });
fs.rmSync(path.join(root, "e2e", "profile"), { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(path.join(root, "e2e", "profile"), {
  executablePath: exe, headless: false,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, "--no-first-run"],
});
const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
const id = sw.url().split("/")[2];
sw.on("console", (m) => console.log("[sw]", m.text()));
console.log("extension id", id);

const site = await ctx.newPage();
await site.goto("http://localhost:8787/");
const popup = await ctx.newPage();
popup.on("console", (m) => console.log("[popup]", m.text()));
await popup.goto(`chrome-extension://${id}/popup.html`);
await popup.waitForSelector("#view-pair:not([hidden])", { timeout: 20000 });
console.log("PAIRING: type the code macOS shows into the popup tab and press Pair (or write it to e2e/.pin)");

const deadline = Date.now() + 15 * 60_000;
let pin;
while (!pin && Date.now() < deadline) {
  if (await popup.$("#view-logins:not([hidden])")) break;
  if (fs.existsSync(pinFile)) pin = fs.readFileSync(pinFile, "utf8").trim();
  else await new Promise((r) => setTimeout(r, 1000));
}
if (pin) {
  await popup.fill("#pin", pin);
  await popup.press("#pin", "Enter");
}
await popup.waitForSelector("#view-logins:not([hidden]), #view-error:not([hidden])", { timeout: 30000 });
console.log("after pair:", (await popup.textContent("#view-logins")).trim() || (await popup.textContent("#view-error")).trim());

const instance = await sw.evaluate(() => (globalThis.__instance ??= Math.random().toString(36).slice(2)));
if (process.env.IDLE_MIN) {
  console.log(`idling ${process.env.IDLE_MIN} min`);
  await new Promise((r) => setTimeout(r, Number(process.env.IDLE_MIN) * 60_000));
  const same = ctx.serviceWorkers()[0] === sw && (await sw.evaluate(() => globalThis.__instance)) === instance;
  console.log("worker survived idle:", same);
}

const siteTabId = await popup.evaluate(async () => (await chrome.tabs.query({ url: "http://localhost:8787/*" }))[0].id);
for (const h of hosts) {
  const r = await popup.evaluate((m) => chrome.runtime.sendMessage(m), { type: "LOGINS", tabId: siteTabId, url: `https://${h}/` });
  console.log(h, r.ok ? `${r.logins.length} login(s): ${r.logins.map((l) => l.username.replace(/(?<=^.{2}).+(?=.{2}$)/, "…")).join(", ")}` : `error ${r.error}`);
}

const fill = await popup.evaluate((m) => chrome.tabs.sendMessage(m.tabId, m.msg), { tabId: siteTabId, msg: { type: "FILL", username: "someone@example.com", password: "hunter2" } });
const values = await site.evaluate(() => [...document.querySelectorAll("input")].map((i) => i.value));
console.log("content fill:", JSON.stringify(fill), "values:", JSON.stringify(values));

if (process.env.FILL_HOST) {
  await site.goto(`https://${process.env.FILL_HOST}/`);
  const url = site.url();
  const r = await popup.evaluate((m) => chrome.runtime.sendMessage(m), { type: "LOGINS", tabId: siteTabId, url });
  if (r.ok && r.logins[0]) {
    const f = await popup.evaluate((m) => chrome.runtime.sendMessage(m), { type: "FILL", tabId: siteTabId, url, login: r.logins[0] });
    console.log("real fill:", JSON.stringify(f));
  }
}

await popup.screenshot({ path: path.join(root, "e2e", "popup.png") });
await ctx.close();
server.close();
fs.rmSync(pinFile, { force: true });
console.log("done");
