import { AppleClient, HelperError } from "./apple/client";
import type { Request, Response, State } from "./messages";
import type { FillRequest, FillResult } from "./content";

const CODE_TTL_MS = 2 * 60_000;
const KEEPALIVE = "keepalive";

let client = new AppleClient();
let codeRequestedAt = 0;

client.onDisconnect = () => {
  codeRequestedAt = 0;
  chrome.action.setBadgeText({ text: "" });
};

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
      chrome.alarms.create(KEEPALIVE, { periodInMinutes: 0.5 });
      return { ok: true, state: "ready" };

    case "LOGINS":
      return { ok: true, logins: await client.loginNames(req.tabId, hostname(req.url)) };

    case "PASSWORD":
      return { ok: true, credential: await client.password(req.tabId, hostname(req.url), req.login) };

    case "FILL": {
      const tab = await chrome.tabs.get(req.tabId);
      if (tab.url !== req.url) throw new Error("Tab navigated away");
      const { username, password } = await client.password(req.tabId, hostname(req.url), req.login);
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
      chrome.alarms.clear(KEEPALIVE);
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

// An open native port already keeps the worker alive, the alarm is a backstop
// so an idle worker doesn't drop the session and force a re-pair.
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE && !client.paired) chrome.alarms.clear(KEEPALIVE);
});
