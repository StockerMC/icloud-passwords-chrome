import { AppleClient, HelperError } from "./apple/client";
import type { Credential, LoginName } from "./apple/enums";
import type { Request, Response, State } from "./messages";
import type { PageMessage } from "./content";
import { getSettings } from "./settings";

const CODE_TTL_MS = 2 * 60_000;
const SAVE_WINDOW_MS = 60_000;

let client = new AppleClient();
let codeRequestedAt = 0;
const recent = new Map<string, { credential: Credential; at: number }>();

interface PendingSave {
  hostname: string;
  username: string;
  password: string;
  newPassword: boolean;
  at: number;
  offered: boolean;
  timer?: number;
}
const pendingSaves = new Map<number, PendingSave>();
// Username from a username-only page, for logins split across two pages.
const stageOne = new Map<string, { username: string; at: number }>();

client.onDisconnect = () => {
  codeRequestedAt = 0;
  recent.clear();
};

function state(): State {
  if (client.paired) return "ready";
  if (client.connected && codeRequestedAt) return "pairing";
  return "disconnected";
}

function hostname(url: string) {
  return new URL(url).hostname;
}

async function credential(tabId: number, url: string, login: LoginName) {
  const host = hostname(url);
  const key = `${host}\0${login.username}`;
  // Touch ID is asked per password read; remembering it spares the prompt on a retry.
  const ttl = (await getSettings()).rememberMinutes * 60_000;
  const hit = recent.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.credential;
  const fresh = await client.password(tabId, host, login);
  recent.set(key, { credential: fresh, at: Date.now() });
  return fresh;
}

async function logins(tabId: number, url: string) {
  return client.paired ? client.loginNames(tabId, hostname(url)) : [];
}

function recordSubmission(tabId: number, url: string, req: Extract<Request, { type: "SUBMITTED" }>) {
  const host = hostname(url);
  let username = req.username;
  if (!req.password) {
    if (username) stageOne.set(host, { username, at: Date.now() });
    return;
  }
  const earlier = stageOne.get(host);
  if (!username && earlier && Date.now() - earlier.at < 5 * 60_000) username = earlier.username;
  stageOne.delete(host);

  const existing = pendingSaves.get(tabId);
  clearTimeout(existing?.timer);
  const pending: PendingSave = { hostname: new URL(url).host, username, password: req.password, newPassword: req.newPassword, at: Date.now(), offered: false };
  // Logins that never navigate (single-page apps) get evaluated on a timer.
  pending.timer = setTimeout(() => offerSave(tabId), 2500);
  pendingSaves.set(tabId, pending);
}

async function offerSave(tabId: number) {
  const pending = pendingSaves.get(tabId);
  if (!pending || pending.offered || !client.paired) return;
  pending.offered = true;
  clearTimeout(pending.timer);
  const known = await client.loginNames(tabId, pending.hostname.replace(/:\d+$/, "")).catch(() => [] as LoginName[]);
  const unknown = !known.some((l) => l.username === pending.username);
  if (!unknown && !pending.newPassword) {
    pendingSaves.delete(tabId);
    return;
  }
  const msg: PageMessage = { type: "OFFER_SAVE", username: pending.username, hostname: pending.hostname };
  chrome.tabs.sendMessage(tabId, msg, { frameId: 0 }).catch(() => pendingSaves.delete(tabId));
}

chrome.tabs.onUpdated.addListener((tabId, info) => {
  const pending = pendingSaves.get(tabId);
  if (!pending || info.status !== "complete") return;
  if (Date.now() - pending.at > SAVE_WINDOW_MS) pendingSaves.delete(tabId);
  else offerSave(tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => pendingSaves.delete(tabId));

async function handle(req: Request, sender: chrome.runtime.MessageSender): Promise<Response> {
  const tabId = sender.tab?.id ?? -1;
  switch (req.type) {
    case "STATUS":
      return { ok: true, state: state() };

    case "PAIR_START": {
      if (client.paired) return { ok: true, state: "ready" };
      const fresh = Date.now() - codeRequestedAt < CODE_TTL_MS;
      if (!fresh || req.force) {
        await client.requestCode();
        codeRequestedAt = Date.now();
      }
      return { ok: true, state: "pairing" };
    }

    case "PAIR_FINISH":
      await client.submitCode(req.pin);
      codeRequestedAt = 0;
      return { ok: true, state: "ready" };

    case "LOGINS":
      return { ok: true, logins: await logins(req.tabId, req.url), state: state() };

    case "PASSWORD":
      return { ok: true, credential: await credential(req.tabId, req.url, req.login) };

    case "FILL": {
      const tab = await chrome.tabs.get(req.tabId);
      if (tab.url !== req.url) throw new Error("Tab navigated away");
      const { username, password } = await credential(req.tabId, req.url, req.login);
      const msg: PageMessage = { type: "FILL", username, password };
      const result = await chrome.tabs.sendMessage<PageMessage, { filled?: object; error?: string }>(req.tabId, msg, { frameId: 0 });
      if (result?.error) throw new Error(result.error);
      return { ok: true, state: state() };
    }

    case "LOCK":
      client.close();
      codeRequestedAt = 0;
      recent.clear();
      return { ok: true, state: "disconnected" };

    // From content scripts: the frame's own URL decides which site is asked about.
    case "PAGE_LOGINS":
      return { ok: true, logins: await logins(tabId, sender.url!), state: state() };

    case "PAGE_CREDENTIAL":
      return { ok: true, credential: await credential(tabId, sender.url!, req.login) };

    case "SUBMITTED":
      recordSubmission(tabId, sender.url!, req);
      return { ok: true, state: state() };

    case "SAVE_PENDING": {
      const pending = pendingSaves.get(tabId);
      pendingSaves.delete(tabId);
      if (req.accept && pending) await client.save(tabId, pending.hostname, pending.username, pending.password);
      return { ok: true, state: state() };
    }

    case "OPEN_POPUP":
      await chrome.action.openPopup().catch(() => {});
      return { ok: true, state: state() };
  }
}

chrome.runtime.onMessage.addListener((req: Request, sender, respond: (r: Response) => void) => {
  handle(req, sender)
    .catch((e: unknown) => {
      const message = e instanceof Error ? e.message : String(e);
      if (!(e instanceof HelperError)) console.error(e);
      return { ok: false, error: message } as Response;
    })
    .then(respond);
  return true;
});

// The open native port keeps this worker alive (Chrome 105+), so the session
// survives idle time without any keep-alive tricks.
