// One native-messaging connection to Apple's helper plus the SRP session on
// top of it. Pairing is tied to the connection: a new port means a new code.

import { fromUtf8, utf8 } from "./bytes";
import {
  Action,
  Capabilities,
  Command,
  Credential,
  LoginName,
  OneTimeCode,
  PakeMessage,
  Protocol,
  QueryStatus,
} from "./enums";
import { SrpSession } from "./srp";

const HOST = "com.apple.passwordmanager";
const BROWSER_NAME = "Chrome";
const VERSION = "1.0";
const AUTH_TIMEOUT = 90_000;

type Message = { cmd: number; [key: string]: unknown };
type Pending = { resolve: (m: Message) => void; reject: (e: Error) => void; timer?: number };

export class HelperError extends Error {}

export class AppleClient {
  private port?: chrome.runtime.Port;
  private session?: SrpSession;
  private pending = new Map<number, Pending>();
  // Replies carry no request id, so requests of one command run one at a time.
  private queues = new Map<number, Promise<unknown>>();
  private _capabilities?: Capabilities;
  onDisconnect?: (reason: string) => void;
  // The helper announces a new code; never seen in practice on macOS 15.
  onOneTimeCode?: () => void;

  get connected() {
    return this.port !== undefined;
  }

  get paired() {
    return this.session?.paired ?? false;
  }

  get capabilities() {
    return this._capabilities;
  }

  async connect() {
    if (this.port) return;
    const port = chrome.runtime.connectNative(HOST);
    this.port = port;
    port.onMessage.addListener((m: Message) => {
      const p = this.pending.get(m.cmd);
      if (!p) {
        if (m.cmd === Command.OneTimeCodeAvailable) this.onOneTimeCode?.();
        return;
      }
      this.pending.delete(m.cmd);
      clearTimeout(p.timer);
      p.resolve(m);
    });
    port.onDisconnect.addListener(() => {
      const reason = chrome.runtime.lastError?.message ?? "Helper disconnected";
      this.reset();
      for (const p of this.pending.values()) p.reject(new HelperError(reason));
      this.pending.clear();
      this.onDisconnect?.(reason);
    });

    const { capabilities } = (await this.send(Command.GetCapabilities, {}, 5000)) as unknown as { capabilities: Capabilities };
    if (
      capabilities.secretSessionVersion !== undefined &&
      capabilities.secretSessionVersion !== Protocol.SrpRfcVerification
    ) {
      throw new HelperError(`Unsupported session version ${capabilities.secretSessionVersion}`);
    }
    this._capabilities = capabilities;
    this.session = new SrpSession(capabilities.shouldUseBase64 ?? false);
  }

  // Sends the client key; the helper responds by showing a 6-digit code.
  async requestCode() {
    await this.connect();
    const session = this.session!;
    const reply = await this.handshake({
      QID: "m0",
      PAKE: pakeEncode({
        TID: session.tid,
        MSG: PakeMessage.ClientKeyExchange,
        A: session.clientPublicKey(),
        VER: VERSION,
        PROTO: [Protocol.SrpRfcVerification],
      }),
      HSTBRSR: BROWSER_NAME,
    });
    if (reply.TID !== session.tid) throw new HelperError("Handshake for another session");
    if (reply.ErrCode !== undefined) throw new HelperError(`Handshake error ${reply.ErrCode}`);
    if (Number(reply.MSG) !== PakeMessage.ServerKeyExchange) throw new HelperError("Unexpected handshake message");
    if (Number(reply.PROTO) !== Protocol.SrpRfcVerification) throw new HelperError("Helper refused RFC verification");
    session.setServer(reply.B as string, reply.s as string);
  }

  async submitCode(pin: string) {
    const session = this.session;
    if (!session) throw new HelperError("Not connected");
    const M = await session.prove(pin.replace(/\D/g, ""));
    const reply = await this.handshake({
      QID: "m2",
      PAKE: pakeEncode({ TID: session.tid, MSG: PakeMessage.ClientVerification, M }),
    });
    if (reply.TID !== session.tid) throw new HelperError("Handshake for another session");
    if (Number(reply.MSG) !== PakeMessage.ServerVerification) throw new HelperError("Unexpected handshake message");
    if (reply.ErrCode === 1) throw new HelperError("Incorrect code");
    if (reply.ErrCode !== 0) throw new HelperError(`Handshake error ${reply.ErrCode}`);
    await session.verifyServer(reply.HAMK as string);
  }

  async loginNames(tabId: number, hostname: string): Promise<LoginName[]> {
    const entries = await this.query(
      Command.GetLoginNamesForUrl,
      "CmdGetLoginNames4URL",
      { tabId, frameId: 0, url: hostname },
      { ACT: Action.GhostSearch, URL: hostname },
      10000,
    );
    return entries.map((e) => ({ username: e.USR as string, sites: (e.sites as string[]) ?? [] }));
  }

  // Blocks on Touch ID. A read that never replies would otherwise hold up
  // every later read, so it gets a generous limit.
  async password(tabId: number, hostname: string, login: LoginName): Promise<Credential> {
    const [entry] = await this.query(
      Command.GetPasswordForLoginName,
      "CmdGetPassword4LoginName",
      { tabId, frameId: 0, url: login.sites[0] ?? hostname },
      { ACT: Action.Search, URL: hostname, USR: login.username },
      AUTH_TIMEOUT,
    );
    if (!entry) throw new HelperError("No password returned");
    return { username: entry.USR as string, password: entry.PWD as string, sites: (entry.sites as string[]) ?? [] };
  }

  // Lists the authenticator entries for the frame, without values.
  async oneTimeCodes(tabId: number, frameId: number, frameURLs: string[], username?: string) {
    const body = { ACT: Action.GhostSearch, TYPE: "oneTimeCodes", frameURLs, ...(username && { username }) };
    const entries = await this.query(Command.GetOneTimeCodes, "CmdGetOneTimeCodes", { tabId, frameId }, body, 8000);
    return entries.map(oneTimeCode);
  }

  // Reads current values right before filling. Blocks on Touch ID.
  async readOneTimeCodes(tabId: number, frameId: number, frameURLs: string[], username?: string) {
    const body = { ACT: Action.Search, TYPE: "oneTimeCodes", frameURLs, ...(username && { username }) };
    const entries = await this.query(Command.DidFillOneTimeCode, "CmdDidFillOneTimeCode", { tabId, frameId }, body, AUTH_TIMEOUT);
    return entries.map(oneTimeCode);
  }

  // The helper decides whether this is new or changed and shows its own
  // save sheet, and only replies once that is dismissed.
  async save(tabId: number, hostname: string, username: string, password: string) {
    const body = { ACT: Action.MaybeAdd, URL: "", USR: "", PWD: "", NURL: hostname, NUSR: username, NPWD: password };
    try {
      await this.query(Command.SetPassword, "CmdNewAccount4URL", { tabId, frameId: 0 }, body, 20_000);
    } catch (e) {
      if (!(e instanceof HelperError && e.message === "Helper did not respond")) throw e;
    }
  }

  // Opens the Passwords app, searched for the site. The helper sends no reply.
  launchPasswordsApp(url?: string) {
    if (!this.port || !this.paired) throw new HelperError("Not paired");
    this.port.postMessage({ cmd: Command.LaunchPasswordsApp, ...(url && { searchQueryURL: url }) });
  }

  // Hands an otpauth URI to the Passwords app, which opens its setup sheet.
  // Apple's extension sends this as a variant of the launch command.
  setUpVerificationCode(hostname: string, uri: string) {
    if (!this.port || !this.paired) throw new HelperError("Not paired");
    if (!this._capabilities?.scanForOTPURI) throw new HelperError("Helper can't set up verification codes");
    this.port.postMessage({ cmd: Command.LaunchPasswordsApp, setUpTOTPPageURL: hostname, setUpTOTPURI: uri });
  }

  close() {
    if (!this.port) return;
    try {
      this.port.postMessage({ cmd: Command.End });
      this.port.disconnect();
    } catch {}
    this.reset();
  }

  private reset() {
    this.port = undefined;
    this.session = undefined;
    this._capabilities = undefined;
  }

  private async handshake(msg: object) {
    const reply = await this.send(Command.Handshake, { msg: JSON.stringify(msg) }, 15000);
    const payload = asObject(reply.payload);
    const pake = payload.PAKE;
    if (typeof pake !== "string") throw new HelperError("Handshake reply missing PAKE");
    return JSON.parse(fromUtf8(base64Bytes(pake))) as Record<string, unknown>;
  }

  private async query(
    cmd: Command,
    qid: string,
    fields: object,
    body: object,
    timeout?: number,
  ): Promise<Record<string, unknown>[]> {
    const session = this.session;
    if (!session?.paired) throw new HelperError("Not paired");
    const smsg = JSON.stringify({ TID: session.tid, SDATA: await session.encrypt(utf8(JSON.stringify(body))) });
    const reply = await this.send(cmd, { ...fields, payload: JSON.stringify({ QID: qid, SMSG: smsg }) }, timeout);
    if (reply.payload === undefined) return [];
    const inner = asObject(asObject(reply.payload).SMSG);
    if (inner.TID !== session.tid) throw new HelperError("Reply for another session");
    const data = JSON.parse(fromUtf8(await session.decrypt(inner.SDATA as string)));
    switch (data.STATUS) {
      case QueryStatus.Success:
        return data.Entries ?? [];
      case QueryStatus.NoResults:
        return [];
      case QueryStatus.InvalidSession:
        throw new HelperError("Session expired, pair again");
      default:
        throw new HelperError(`Helper returned status ${data.STATUS}`);
    }
  }

  private send(cmd: Command, body: object, timeout?: number) {
    const previous = this.queues.get(cmd) ?? Promise.resolve();
    const run = previous.then(() => this.sendNow(cmd, body, timeout), () => this.sendNow(cmd, body, timeout));
    this.queues.set(cmd, run.catch(() => {}));
    return run;
  }

  private sendNow(cmd: Command, body: object, timeout?: number) {
    const port = this.port;
    if (!port) return Promise.reject(new HelperError("Not connected"));
    return new Promise<Message>((resolve, reject) => {
      const p: Pending = { resolve, reject };
      if (timeout) {
        p.timer = setTimeout(() => {
          this.pending.delete(cmd);
          reject(new HelperError("Helper did not respond"));
        }, timeout);
      }
      this.pending.set(cmd, p);
      port.postMessage({ cmd, ...body });
    });
  }
}

function oneTimeCode(e: Record<string, unknown>): OneTimeCode {
  return { source: String(e.source ?? ""), username: String(e.username ?? ""), domain: String(e.domain ?? ""), code: e.code == null ? "" : String(e.code) };
}

function pakeEncode(obj: object) {
  return btoa(String.fromCharCode(...utf8(JSON.stringify(obj))));
}

function base64Bytes(s: string) {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

// macOS returns nested payloads as objects, iCloud for Windows as JSON strings.
function asObject(v: unknown): Record<string, unknown> {
  if (typeof v === "string") return JSON.parse(v);
  if (v && typeof v === "object") return v as Record<string, unknown>;
  throw new HelperError("Malformed reply");
}
