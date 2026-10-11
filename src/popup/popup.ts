import type { LoginName } from "../apple/enums";
import { generatePassword } from "../generate";
import { send, type Response, type State } from "../messages";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const views = ["loading", "pair", "logins", "error"] as const;

function show(view: (typeof views)[number]) {
  for (const v of views) $(`view-${v}`).hidden = v !== view;
  $("lock").hidden = view !== "logins";
  if (view === "pair") $("pin").focus();
}

function fail(message: string) {
  $("error-text").textContent = message;
  show("error");
}

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) return null;
  return { id: tab.id, url: tab.url };
}

async function start() {
  show("loading");
  const res = await send<{ ok: true; state: State } | { ok: false; error: string }>({ type: "STATUS" });
  if (!res.ok) return fail(res.error);
  if (res.state === "ready") return loadLogins();
  const pair = await send<Response>({ type: "PAIR_START" });
  if (!pair.ok) return fail(pair.error);
  $<HTMLInputElement>("pin").value = "";
  show("pair");
}

async function loadLogins() {
  const tab = await currentTab();
  if (!tab) {
    $("site").textContent = "";
    $("logins").replaceChildren();
    $("empty").textContent = "Open a website to see its passwords.";
    $("empty").hidden = false;
    return show("logins");
  }
  const host = new URL(tab.url).hostname;
  $("site").textContent = host;
  const res = await send<Response>({ type: "LOGINS", tabId: tab.id, url: tab.url });
  if (!res.ok) return fail(res.error);
  const logins = (res as { logins: LoginName[] }).logins;
  $("logins").replaceChildren(...logins.map((login) => row(login, tab)));
  $("empty").textContent = "No saved passwords for this site.";
  $("empty").hidden = logins.length > 0;
  show("logins");
}

function row(login: LoginName, tab: { id: number; url: string }) {
  const li = document.createElement("li");
  const user = document.createElement("span");
  user.className = "user";
  user.textContent = login.username || "(no username)";
  user.title = login.sites.join(", ");
  const copy = document.createElement("button");
  copy.className = "copy";
  copy.textContent = "Copy";
  copy.title = "Copy password";
  li.append(user, copy);

  li.addEventListener("click", async () => {
    li.classList.add("busy");
    const res = await send<Response>({ type: "FILL", tabId: tab.id, url: tab.url, login });
    li.classList.remove("busy");
    if (!res.ok) return fail(res.error);
    window.close();
  });
  copy.addEventListener("click", async (e) => {
    e.stopPropagation();
    li.classList.add("busy");
    const res = await send<Response>({ type: "PASSWORD", tabId: tab.id, url: tab.url, login });
    li.classList.remove("busy");
    if (!res.ok) return fail(res.error);
    await navigator.clipboard.writeText((res as { credential: { password: string } }).credential.password);
    copy.textContent = "Copied";
    setTimeout(() => (copy.textContent = "Copy"), 1200);
  });
  return li;
}

$("pair-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pin = $<HTMLInputElement>("pin").value.replace(/\D/g, "");
  if (pin.length !== 6) return;
  show("loading");
  const res = await send<Response>({ type: "PAIR_FINISH", pin });
  if (!res.ok) {
    $<HTMLInputElement>("pin").value = "";
    $("error-text").textContent = res.error;
    return fail(res.error === "Incorrect code" ? "Incorrect code. Request a new one and try again." : res.error);
  }
  loadLogins();
});

$("pin").addEventListener("input", () => {
  if ($<HTMLInputElement>("pin").value.replace(/\D/g, "").length === 6) $<HTMLFormElement>("pair-form").requestSubmit();
});

$("new-code").addEventListener("click", async () => {
  show("loading");
  const res = await send<Response>({ type: "PAIR_START", force: true });
  if (!res.ok) return fail(res.error);
  $<HTMLInputElement>("pin").value = "";
  show("pair");
});

$("generate").addEventListener("click", async () => {
  await navigator.clipboard.writeText(generatePassword());
  $("generate").textContent = "Copied to clipboard";
  setTimeout(() => ($("generate").textContent = "Generate password"), 1500);
});

$("retry").addEventListener("click", start);
$("options").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("lock").addEventListener("click", async () => {
  await send({ type: "LOCK" });
  window.close();
});

start();
