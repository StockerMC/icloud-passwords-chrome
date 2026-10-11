// Apple-style xxxxxx-xxxxxx-xxxxxx with no ambiguous characters, plus one
// symbol, an upper-case letter and a digit for sites that insist on them.
const ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const SYMBOLS = "!@#$%^&*";

function random(limit: number) {
  for (;;) {
    const [byte] = crypto.getRandomValues(new Uint8Array(1));
    if (byte < 256 - (256 % limit)) return byte % limit;
  }
}

function chars(n: number) {
  let out = "";
  while (out.length < n) out += ALPHABET[random(ALPHABET.length)];
  return out;
}

export function generatePassword() {
  for (;;) {
    const p = [...`${chars(6)}-${chars(6)}-${chars(6)}`];
    const slots = p.flatMap((c, i) => (c === "-" ? [] : [i]));
    p[slots[random(slots.length)]] = SYMBOLS[random(SYMBOLS.length)];
    const s = p.join("");
    if (/[A-Z]/.test(s) && /\d/.test(s)) return s;
  }
}
