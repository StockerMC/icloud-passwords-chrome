import { AppleClient, HelperError } from "./apple/client";
import type { Credential, LoginName } from "./apple/enums";
import type { PageMessage } from "./content";
import { gmailCodes } from "./gmail";
import { mailCodes } from "./mail";
import type { Data, Request, State } from "./messages";
import { getSettings } from "./settings";

const CODE_TTL_MS = 2 * 60_000;
const SAVE_WINDOW_MS = 60_000;

// The open native port keeps this worker alive (Chrome 105+), so the session
// survives idle time without any keep-alive tricks.
const client = new AppleClient();
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

client.onOneTimeCode = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: "CODE_ARRIVED" } satisfies PageMessage).catch(() => {});
};

// The frame's URL and those of its ancestors, which the helper matches codes against.
function frameURLs(sender: chrome.runtime.MessageSender) {
  const urls = [sender.url!];
  if (sender.tab?.url && sender.tab.url !== sender.url) urls.push(sender.tab.url);
  return urls;
}

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

  clearTimeout(pendingSaves.get(tabId)?.timer);
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
  // The page may still be navigating; the next load completing tries again.
  chrome.tabs.sendMessage(tabId, msg, { frameId: 0 }).catch(() => (pending.offered = false));
}

// Tabs open before the install have no content script yet.
chrome.runtime.onInstalled.addListener(async () => {
  for (const tab of await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] })) {
    chrome.scripting.executeScript({ target: { tabId: tab.id!, allFrames: true }, files: ["content.js"] }).catch(() => {});
  }
});

chrome.tabs.onUpdated.addListener((tabId, info) => {
  const pending = pendingSaves.get(tabId);
  if (!pending || info.status !== "complete") return;
  if (Date.now() - pending.at > SAVE_WINDOW_MS) pendingSaves.delete(tabId);
  else offerSave(tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => pendingSaves.delete(tabId));

type Sender = chrome.runtime.MessageSender;
type Handlers = { [K in Request["type"]]: (req: Extract<Request, { type: K }>, sender: Sender) => Promise<Data<K>> };

// Requests from content scripts carry the frame's own URL, which decides the site asked about.
const handlers: Handlers = {
  async STATUS() {
    return { state: state() };
  },

  async PAIR_START(req) {
    if (client.paired) return { state: "ready" };
    const fresh = Date.now() - codeRequestedAt < CODE_TTL_MS;
    if (!fresh || req.force) {
      await client.requestCode();
      codeRequestedAt = Date.now();
    }
    return { state: "pairing" };
  },

  async PAIR_FINISH(req) {
    await client.submitCode(req.pin);
    codeRequestedAt = 0;
    return { state: "ready" };
  },

  async LOGINS(req) {
    return { logins: await logins(req.tabId, req.url), state: state() };
  },

  async PASSWORD(req) {
    return { credential: await credential(req.tabId, req.url, req.login) };
  },

  async FILL(req) {
    const tab = await chrome.tabs.get(req.tabId);
    if (tab.url !== req.url) throw new Error("Tab navigated away");
    const { username, password } = await credential(req.tabId, req.url, req.login);
    const msg: PageMessage = { type: "FILL", username, password };
    const result = await chrome.tabs.sendMessage<PageMessage, { error?: string }>(req.tabId, msg, { frameId: 0 });
    if (result?.error) throw new Error(result.error);
  },

  async LOCK() {
    client.close();
    codeRequestedAt = 0;
    recent.clear();
  },

  async PAGE_LOGINS(_req, sender) {
    return { logins: await logins(sender.tab!.id!, sender.url!), state: state() };
  },

  async PAGE_CREDENTIAL(req, sender) {
    return { credential: await credential(sender.tab!.id!, sender.url!, req.login) };
  },

  async SUBMITTED(req, sender) {
    recordSubmission(sender.tab!.id!, sender.url!, req);
  },

  async SAVE_PENDING(req, sender) {
    const tabId = sender.tab!.id!;
    const pending = pendingSaves.get(tabId);
    pendingSaves.delete(tabId);
    if (req.accept && pending) await client.save(tabId, pending.hostname, pending.username, pending.password);
  },

  async OPEN_POPUP() {
    await chrome.action.openPopup().catch(() => {});
  },

  async PAGE_CODES(_req, sender) {
    const settings = await getSettings();
    const helper = client.paired && client.capabilities?.canFillOneTimeCodes
      ? client.oneTimeCodes(sender.tab!.id!, sender.frameId ?? 0, frameURLs(sender))
      : [];
    const gmail = settings.gmail ? gmailCodes() : [];
    const mail = settings.mail ? mailCodes() : [];
    return { codes: (await Promise.all([helper, gmail, mail])).flat() };
  },

  async PAGE_CODE(req, sender) {
    if (req.entry.code) return { code: req.entry.code };
    const codes = await client.readOneTimeCodes(sender.tab!.id!, sender.frameId ?? 0, frameURLs(sender), req.entry.username || undefined);
    const match = codes.find((c) => c.username === req.entry.username && c.code) ?? codes.find((c) => c.code);
    if (!match) throw new Error("No code available");
    return { code: match.code };
  },
};

chrome.runtime.onMessage.addListener((req: Request, sender, respond: (r: object) => void) => {
  const handle = handlers[req.type] as (req: Request, sender: Sender) => Promise<object | void>;
  handle(req, sender)
    .then((data) => respond({ ok: true, ...data }))
    .catch((e: unknown) => {
      if (!(e instanceof HelperError)) console.error(e);
      respond({ ok: false, error: e instanceof Error ? e.message : String(e) });
    });
  return true;
});
