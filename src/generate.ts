// Apple-style xxxxxx-xxxxxx-xxxxxx, no ambiguous characters, at least one
// upper-case letter and one digit.
const ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function chars(n: number) {
  let out = "";
  while (out.length < n) {
    for (const byte of crypto.getRandomValues(new Uint8Array(n))) {
      if (byte < 224 && out.length < n) out += ALPHABET[byte % ALPHABET.length];
    }
  }
  return out;
}

export function generatePassword() {
  for (;;) {
    const p = `${chars(6)}-${chars(6)}-${chars(6)}`;
    if (/[A-Z]/.test(p) && /\d/.test(p)) return p;
  }
}
