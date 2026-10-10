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
  | { type: "SAVE_PENDING"; accept: boolean }
  | { type: "OPEN_POPUP" }
  | { type: "PAGE_CODES" }
  | { type: "PAGE_CODE"; entry: OneTimeCode };

export type Response =
  | { ok: true; state: State }
  | { ok: true; logins: LoginName[]; state: State }
  | { ok: true; credential: Credential }
  | { ok: true; codes: OneTimeCode[] }
  | { ok: true; code: string }
  | { ok: true; filled: { username: boolean; password: boolean } }
  | { ok: false; error: string };

export function send<T extends Response>(req: Request) {
  return chrome.runtime.sendMessage<Request, T>(req);
}
