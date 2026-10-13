import type { Credential, LoginName, OneTimeCode } from "./apple/enums";

export type State = "disconnected" | "pairing" | "ready";

export type Request =
  | { type: "STATUS" }
  | { type: "PAIR_START"; force?: boolean }
  | { type: "PAIR_FINISH"; pin: string }
  | { type: "LOGINS"; tabId: number; url: string }
  | { type: "FILL"; tabId: number; url: string; login: LoginName }
  | { type: "PASSWORD"; tabId: number; url: string; login: LoginName }
  | { type: "LOCK" }
  | { type: "PAGE_LOGINS" }
  | { type: "PAGE_CREDENTIAL"; login: LoginName }
  | { type: "SUBMITTED"; username: string; password: string; newPassword: boolean }
  | { type: "GENERATED"; username: string; password: string }
  | { type: "SAVE_PENDING"; accept: boolean }
  | { type: "OPEN_POPUP" }
  | { type: "PAGE_CODES" }
  | { type: "PAGE_CODE"; entry: OneTimeCode }
  | { type: "SOURCES" }
  | { type: "CODES"; tabId: number; url: string }
  | { type: "CODE"; tabId: number; url: string; entry: OneTimeCode }
  | { type: "OPEN_PASSWORDS_APP"; url?: string };

// What each request answers with, beyond ok. Requests not listed answer with ok alone.
export interface Replies {
  STATUS: { state: State };
  PAIR_START: { state: State };
  PAIR_FINISH: { state: State };
  LOGINS: { logins: LoginName[]; state: State };
  PASSWORD: { credential: Credential };
  PAGE_LOGINS: { logins: LoginName[]; state: State };
  PAGE_CREDENTIAL: { credential: Credential };
  PAGE_CODES: { codes: OneTimeCode[] };
  PAGE_CODE: { code: string };
  SOURCES: { sources: { gmail: string; mail: string; messages: string } };
  CODES: { codes: OneTimeCode[] };
  CODE: { code: string };
}

export type Data<K extends Request["type"]> = K extends keyof Replies ? Replies[K] : void;

export type Reply<K extends Request["type"]> = ({ ok: true } & (K extends keyof Replies ? Replies[K] : unknown)) | { ok: false; error: string };

export function send<R extends Request>(req: R): Promise<Reply<R["type"]>> {
  return chrome.runtime.sendMessage(req);
}
