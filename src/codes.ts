// Codes from email are matched by text, since there is no structure to rely on.
export const CODE_WINDOW_MS = 10 * 60_000;
const HINTS = /\b(code|verif|passcode|one[- ]?time|otp|2fa|pin|sign[- ]?in|log[- ]?in|confirm)/i;

export function extractCode(text: string) {
  if (!HINTS.test(text)) return "";
  // "Your code is: BWBGCEEYEK" style codes can be letters, so take the
  // token that follows the word, as long as it isn't a plain word.
  for (const [, token] of text.matchAll(/\b[Cc]ode(?:\s+is)?\s*:?\s+([A-Z0-9]{3}[ -]?[A-Z0-9]{3,9}|[A-Z0-9]{4,12})(?![a-z])/g)) {
    if (!/^(19|20)\d\d$/.test(token)) return token.replace(/[ -]/, "");
  }
  const found = [...text.matchAll(/(?<![\d$€£.])\b(\d{3}[ -]\d{3}|\d{4,8})\b(?![ -]?\d|[%.]\d)/g)].map((m) => m[1].replace(/[ -]/, ""));
  return (
    found.find((c) => c.length === 6) ??
    found.find((c) => c.length >= 7) ??
    found.find((c) => c.length === 5) ??
    found.find((c) => c.length === 4 && !/^(19|20)\d\d$/.test(c)) ??
    ""
  );
}

