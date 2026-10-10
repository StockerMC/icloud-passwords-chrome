import { AppleClient, HelperError } from "./apple/client";
import type { Credential, LoginName } from "./apple/enums";
import type { Request, Response, State } from "./messages";
import type { FillRequest, FillResult } from "./content";
import { getSettings } from "./settings";

const CODE_TTL_MS = 2 * 60_000;

let client = new AppleClient();
let codeRequestedAt = 0;
const recent = new Map<string, { credential: Credential; at: number }>();

client.onDisconnect = () => {
  codeRequestedAt = 0;
  recent.clear();
};

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

function state(): State {
  if (client.paired) return "ready";
  if (client.connected && codeRequestedAt) return "pairing";
  return "disconnected";
}

async function handle(req: Request, sender: chrome.runtime.MessageSender): Promise<Response> {
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
      return { ok: true, logins: await client.loginNames(req.tabId, hostname(req.url)) };

    case "PASSWORD":
      return { ok: true, credential: await credential(req.tabId, req.url, req.login) };

    case "FILL": {
      const tab = await chrome.tabs.get(req.tabId);
      if (tab.url !== req.url) throw new Error("Tab navigated away");
      const { username, password } = await credential(req.tabId, req.url, req.login);
      const result = await chrome.tabs.sendMessage<FillRequest, FillResult | { error: string }>(
        req.tabId,
        { type: "FILL", username, password },
        { frameId: 0 },
      );
      if ("error" in result) throw new Error(result.error);
      return { ok: true, filled: result.filled };
    }

    case "LOCK":
      client.close();
      codeRequestedAt = 0;
      recent.clear();
      return { ok: true, state: "disconnected" };
  }
}

function hostname(url: string) {
  return new URL(url).hostname;
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
