import type { OneTimeCode } from "./apple/enums";

// Gmail's inbox feed lists unread messages for the account the browser is
// signed in to, so no OAuth is needed.
const FEED = "https://mail.google.com/mail/u/0/feed/atom";
const WINDOW_MS = 10 * 60_000;
const HINTS = /\b(code|verif|passcode|one[- ]?time|otp|2fa|pin|sign[- ]?in|log[- ]?in|confirm)/i;

export async function gmailCodes(): Promise<OneTimeCode[]> {
  let xml: string;
  try {
    const res = await fetch(FEED, { credentials: "include" });
    if (!res.ok) return [];
    xml = await res.text();
  } catch {
    return [];
  }
  const codes: OneTimeCode[] = [];
  for (const [, entry] of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    if (!(Date.now() - Date.parse(tag(entry, "issued")) < WINDOW_MS)) continue;
    const code = extractCode(`${tag(entry, "title")} ${tag(entry, "summary")}`);
    if (code) codes.push({ source: "Gmail", username: tag(entry, "name"), domain: "", code });
  }
  return codes;
}

export function extractCode(text: string) {
  if (!HINTS.test(text)) return "";
  const found = [...text.matchAll(/(?<![\d$€£.])\b(\d{3}[ -]\d{3}|\d{4,8})\b(?![ -]?\d|[%.]\d)/g)].map((m) => m[1].replace(/[ -]/, ""));
  return (
    found.find((c) => c.length === 6) ??
    found.find((c) => c.length >= 7) ??
    found.find((c) => c.length === 5) ??
    found.find((c) => c.length === 4 && !/^(19|20)\d\d$/.test(c)) ??
    ""
  );
}

function tag(xml: string, name: string) {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1]) : "";
}

function decode(s: string) {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (all, e: string) => {
    if (e[0] !== "#") return named[e.toLowerCase()] ?? all;
    return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
  });
}
