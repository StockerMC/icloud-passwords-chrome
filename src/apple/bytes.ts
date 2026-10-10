export type Bytes = Uint8Array<ArrayBuffer>;

export const utf8 = (s: string) => new TextEncoder().encode(s) as Bytes;
export const fromUtf8 = (b: Bytes) => new TextDecoder().decode(b);

export function concat(...parts: Bytes[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export function bytesToBigInt(b: Bytes) {
  let n = 0n;
  for (const byte of b) n = (n << 8n) | BigInt(byte);
  return n;
}

// Minimal big-endian encoding, no leading zero bytes.
export function bigIntToBytes(n: bigint) {
  if (n < 0n) throw new RangeError("negative bigint");
  let hex = n.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  return n === 0n ? new Uint8Array() : fromHex(hex);
}

export function padStart(b: Bytes, length: number) {
  if (b.length >= length) return b.subarray(b.length - length);
  const out = new Uint8Array(length);
  out.set(b, length - b.length);
  return out;
}

export function toHex(b: Bytes) {
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function fromHex(hex: string) {
  const clean = hex.replace(/^0x/, "");
  const out = new Uint8Array(clean.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

export function toBase64(b: Bytes) {
  let s = "";
  for (const byte of b) s += String.fromCharCode(byte);
  return btoa(s);
}

export function fromBase64(s: string) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomBytes(n: number): Bytes {
  return crypto.getRandomValues(new Uint8Array(n)) as Bytes;
}

export async function sha256(data: Bytes) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}

export function equal(a: Bytes, b: Bytes) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function mod(a: bigint, n: bigint) {
  const r = a % n;
  return r < 0n ? r + n : r;
}

export function powmod(base: bigint, exp: bigint, n: bigint) {
  if (exp < 0n) throw new RangeError("negative exponent");
  let result = 1n;
  base = mod(base, n);
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % n;
    exp >>= 1n;
    base = (base * base) % n;
  }
  return result;
}
