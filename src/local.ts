import type { OneTimeCode } from "./apple/enums";
import { CODE_WINDOW_MS, extractCode } from "./codes";

// Served by host/codes.js, registered with `npm run install-host`.
const HOST = "com.stockermc.icloud_passwords_codes";

interface Message {
  source: string;
  sender: string;
  subject: string;
  text: string;
  received: number;
}

export async function localCodes(sources: { mail: boolean; messages: boolean }): Promise<OneTimeCode[]> {
  let reply: { messages?: Message[] };
  try {
    reply = await chrome.runtime.sendNativeMessage(HOST, { since: Date.now() - CODE_WINDOW_MS, ...sources });
  } catch {
    return [];
  }
  const codes: OneTimeCode[] = [];
  for (const m of reply.messages ?? []) {
    const code = extractCode(`${m.subject} ${m.text}`);
    if (code) codes.push({ source: m.source, username: m.sender.replace(/\s*<.*>$/, ""), domain: "", code });
  }
  return codes;
}
