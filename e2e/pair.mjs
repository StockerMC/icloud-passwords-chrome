// Pairs the built extension with the helper, then exercises the inline menu,
// the generator, and the save bar on a local page. BROWSER picks the executable.
import { chromium } from "playwright";
import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";

const root = new URL("..", import.meta.url).pathname;
const dist = path.join(root, "dist");
const pinFile = path.join(root, "e2e", ".pin");
const exe = process.env.BROWSER ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const hosts = (process.env.HOSTS ?? "github.com,google.com").split(",");

const pages = {
  "/": `<form><input name="email" type="email" placeholder="Email"><input name="pw" type="password"><button>Sign in</button></form>`,
  "/signup": `<form><input name="email" type="email"><input name="pw" type="password" autocomplete="new-password"><input name="pw2" type="password" autocomplete="new-password"><button>Create</button></form>`,
};
const server = createServer((req, res) => {
  res.setHeader("content-type", "text/html");
  res.end(pages[new URL(req.url, "http://x").pathname] ?? pages["/"]);
}).listen(8787);

fs.rmSync(pinFile, { force: true });
fs.rmSync(path.join(root, "e2e", "profile"), { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(path.join(root, "e2e", "profile"), {
  executablePath: exe, headless: false,
  args: ["--enable-unsafe-extension-debugging", "--no-first-run"],
  ignoreDefaultArgs: ["--disable-extensions"],
});
// Chrome 137+ dropped --load-extension; this is the supported replacement.
const cdp = await ctx.browser().newBrowserCDPSession();
const { id } = await cdp.send("Extensions.loadUnpacked", { path: dist });
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

// A worker that died takes the session with it, so "ready" after idling means it survived.
if (process.env.IDLE_MIN) {
  console.log(`idling ${process.env.IDLE_MIN} min`);
  await new Promise((r) => setTimeout(r, Number(process.env.IDLE_MIN) * 60_000));
  const s = await popup.evaluate(() => chrome.runtime.sendMessage({ type: "STATUS" }));
  console.log("state after idle:", s.state);
}

const siteTabId = await popup.evaluate(async () => (await chrome.tabs.query({ url: "http://localhost:8787/*" }))[0].id);
for (const h of hosts) {
  const r = await popup.evaluate((m) => chrome.runtime.sendMessage(m), { type: "LOGINS", tabId: siteTabId, url: `https://${h}/` });
  console.log(h, r.ok ? `${r.logins.length} login(s): ${r.logins.map((l) => l.username.replace(/(?<=^.{2}).+(?=.{2}$)/, "…")).join(", ")}` : `error ${r.error}`);
}

const menu = '[data-icloud-passwords="menu"]';
await site.bringToFront();
await site.focus("input[name=pw]");
await site.waitForSelector(menu, { state: "attached", timeout: 5000 });
await site.keyboard.press("Escape");
console.log("inline menu: shows on focus, closes on Escape:", !(await site.$(menu)));

await site.goto("http://localhost:8787/signup");
await site.focus("input[name=pw]");
await site.waitForSelector(menu, { state: "attached", timeout: 5000 });
await site.keyboard.press("ArrowDown");
await site.keyboard.press("Enter");
const generated = await site.evaluate(() => [...document.querySelectorAll("input[type=password]")].map((i) => i.value));
console.log("generator:", generated[0] && generated[0] === generated[1] ? `filled both fields (${generated[0].length} chars)` : `unexpected ${JSON.stringify(generated)}`);

await site.goto("http://localhost:8787/");
await site.fill("input[name=email]", "e2e@example.com");
await site.fill("input[name=pw]", "hunter2-e2e");
await site.press("input[name=pw]", "Enter");
const barShown = await site.waitForSelector('[data-icloud-passwords="bar"]', { state: "attached", timeout: 10000 }).then(() => true, () => false);
console.log("save bar:", barShown ? "offered for an unknown login" : "NOT shown");
if (barShown) {
  await clickInClosedShadow(site, "BUTTON", "Save");
  console.log("clicked Save; accept the macOS sheet if one appears");
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const r = await popup.evaluate((m) => chrome.runtime.sendMessage(m), { type: "LOGINS", tabId: siteTabId, url: "http://localhost:8787/" });
    if (r.ok && r.logins.length) break;
  }
  const after = await popup.evaluate((m) => chrome.runtime.sendMessage(m), { type: "LOGINS", tabId: siteTabId, url: "http://localhost:8787/" });
  console.log("localhost logins now:", after.ok ? after.logins.map((l) => l.username).join(", ") || "(none)" : after.error);
}

await popup.screenshot({ path: path.join(root, "e2e", "popup.png") });
await ctx.close();
server.close();
fs.rmSync(pinFile, { force: true });
console.log("done");

// Playwright can't see into closed shadow roots, but the DOM domain can.
async function clickInClosedShadow(page, nodeName, text) {
  const cdp = await page.context().newCDPSession(page);
  const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    if (n.nodeName === nodeName && n.children?.some((c) => c.nodeValue === text)) {
      const { model } = await cdp.send("DOM.getBoxModel", { nodeId: n.nodeId });
      const [x1, y1, , , x3, y3] = model.content;
      await page.mouse.click((x1 + x3) / 2, (y1 + y3) / 2);
      return;
    }
    stack.push(...(n.children ?? []), ...(n.shadowRoots ?? []));
  }
  throw new Error(`no <${nodeName}> with text ${text}`);
}
