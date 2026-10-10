// Wire constants of Apple's PasswordManagerBrowserExtensionHelper protocol.

export const enum Command {
  End = 0,
  Handshake = 2,
  GetLoginNamesForUrl = 4,
  GetPasswordForLoginName = 5,
  TabEvent = 8,
  LaunchPasswordsApp = 13,
  GetCapabilities = 14,
  OneTimeCodeAvailable = 15,
  GetOneTimeCodes = 16,
}

export const enum PakeMessage {
  ClientKeyExchange = 0,
  ServerKeyExchange = 1,
  ClientVerification = 2,
  ServerVerification = 3,
}

export const enum Protocol {
  SrpOldVerification = 0,
  SrpRfcVerification = 1,
}

export const enum Action {
  Search = 2,
  GhostSearch = 5,
}

export const enum QueryStatus {
  Success = 0,
  NoResults = 3,
  InvalidSession = 9,
}

export interface Capabilities {
  shouldUseBase64?: boolean;
  secretSessionVersion?: number;
  canFillOneTimeCodes?: boolean;
  operatingSystem?: { name: string; majorVersion: number; minorVersion: number };
}

export interface LoginName {
  username: string;
  sites: string[];
}

export interface Credential extends LoginName {
  password: string;
}
