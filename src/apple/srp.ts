// SRP-6a client matching Apple's helper: RFC 5054 3072-bit group, g = 5,
// SHA-256 everywhere, AES-128-GCM session keyed by the first 16 bytes of
// H(S). Values on the wire are base64 (or 0x-hex on older helpers) of the
// minimal big-endian byte form.

import {
  type Bytes,
  bigIntToBytes,
  bytesToBigInt,
  concat,
  equal,
  fromBase64,
  fromHex,
  mod,
  padStart,
  powmod,
  randomBytes,
  sha256,
  toBase64,
  toHex,
  utf8,
} from "./bytes";

const N = BigInt(
  "0x" +
    [
      "FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74",
      "020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B302B0A6DF25F1437",
      "4FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED",
      "EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF05",
      "98DA48361C55D39A69163FA8FD24CF5F83655D23DCA3AD961C62F356208552BB",
      "9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B",
      "E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF695581718",
      "3995497CEA956AE515D2261898FA051015728E5A8AAAC42DAD33170D04507A33",
      "A85521ABDF1CBA64ECFB850458DBEF0A8AEA71575D060C7DB3970F85A6E1E4C7",
      "ABF5AE8CDB0933D71E8C94E04A25619DCEE3D2261AD2EE6BF12FFA06D98A0864",
      "D87602733EC86A64521F2B18177B200CBBE117577A615D6C770988C0BAD946E2",
      "08E24FA074E5AB3143DB5BFCE0FD108E4B82D120A93AD2CAFFFFFFFFFFFFFFFF",
    ].join(""),
);
const N_BYTES = 384;
const G = 5n;

export class SrpSession {
  readonly tid: string;
  private readonly a: bigint;
  private readonly A: bigint;
  private B?: bigint;
  private salt?: Bytes;
  private K?: Bytes;
  private M?: Bytes;
  private hamk?: Bytes;
  private aesKey?: CryptoKey;

  constructor(private readonly base64: boolean) {
    this.tid = this.encode(randomBytes(16));
    this.a = bytesToBigInt(randomBytes(32));
    this.A = powmod(G, this.a, N);
  }

  get paired() {
    return this.aesKey !== undefined;
  }

  encode(bytes: Bytes, prefix = true) {
    return this.base64 ? toBase64(bytes) : (prefix ? "0x" : "") + toHex(bytes);
  }

  decode(s: string) {
    return this.base64 ? fromBase64(s) : fromHex(s);
  }

  clientPublicKey() {
    return this.encode(bigIntToBytes(this.A));
  }

  setServer(B: string, salt: string) {
    const b = bytesToBigInt(this.decode(B));
    if (mod(b, N) === 0n) throw new Error("Invalid server public key");
    this.B = b;
    this.salt = this.decode(salt);
    this.aesKey = undefined;
  }

  // Derives K, M and HAMK from the pairing code. Returns M to send.
  async prove(pin: string) {
    if (this.B === undefined || this.salt === undefined) throw new Error("Server key not set");
    const aBytes = bigIntToBytes(this.A);
    const bBytes = bigIntToBytes(this.B);
    const nBytes = bigIntToBytes(N);
    const gPadded = padStart(bigIntToBytes(G), N_BYTES);

    const x = bytesToBigInt(await sha256(concat(this.salt, await sha256(utf8(`${this.tid}:${pin}`)))));
    const u = bytesToBigInt(await sha256(concat(padStart(aBytes, N_BYTES), padStart(bBytes, N_BYTES))));
    const k = bytesToBigInt(await sha256(concat(nBytes, gPadded)));

    const v = powmod(G, x, N);
    const S = powmod(this.B - mod(k * v, N), this.a + u * x, N);
    this.K = await sha256(bigIntToBytes(S));

    const hN = await sha256(nBytes);
    const hG = await sha256(gPadded);
    const hI = await sha256(utf8(this.tid));
    this.M = await sha256(concat(hN.map((b, i) => b ^ hG[i]), hI, this.salt, aBytes, bBytes, this.K));
    this.hamk = await sha256(concat(aBytes, this.M, this.K));
    return this.encode(this.M, false);
  }

  async verifyServer(hamk: string) {
    if (!this.hamk || !this.K) throw new Error("Proof not computed");
    if (!equal(this.decode(hamk), this.hamk)) throw new Error("Server proof mismatch");
    this.aesKey = await crypto.subtle.importKey("raw", this.K.subarray(0, 16), "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]);
  }

  // Client -> helper: ciphertext||tag followed by the 16-byte IV.
  async encrypt(plaintext: Bytes) {
    if (!this.aesKey) throw new Error("Session not paired");
    const iv = randomBytes(16);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, this.aesKey, plaintext));
    return this.encode(concat(ct, iv), false);
  }

  // Helper -> client: 16-byte IV first, then ciphertext||tag.
  async decrypt(data: string) {
    if (!this.aesKey) throw new Error("Session not paired");
    const bytes = this.decode(data);
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.subarray(0, 16) },
      this.aesKey,
      bytes.subarray(16),
    );
    return new Uint8Array(pt);
  }
}
