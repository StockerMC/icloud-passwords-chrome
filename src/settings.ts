export interface Settings {
  rememberMinutes: 0 | 1 | 5 | 15;
  gmail: boolean;
}

export const defaults: Settings = { rememberMinutes: 5, gmail: false };

export async function getSettings(): Promise<Settings> {
  return { ...defaults, ...(await chrome.storage.sync.get(defaults)) };
}

export function setSettings(patch: Partial<Settings>) {
  return chrome.storage.sync.set(patch);
}
