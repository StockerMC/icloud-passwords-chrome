import type { LoginName, OneTimeCode } from "./apple/enums";
import { classify, fill, fillCode, isNewPassword, isOtp, passwordFields, scope, setValue, usernameField, type Input, type Kind } from "./fields";
import { generatePassword } from "./generate";
import { send } from "./messages";

export type PageMessage =
  | { type: "FILL"; username: string; password: string }
  | { type: "OFFER_SAVE"; username: string; hostname: string }
  | { type: "CODE_ARRIVED" }
  | { type: "OPEN_MENU" };

const CSS = `
:host { all: initial; color-scheme: light dark; }
.box {
  position: fixed; z-index: 2147483647; box-sizing: border-box;
  font: 13px/1.4 -apple-system, system-ui, sans-serif; color: CanvasText; background: Canvas;
  border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 8px;
  box-shadow: 0 6px 24px rgba(0,0,0,.18); overflow: hidden;
}
.row { display: flex; align-items: center; gap: 8px; padding: 8px 10px; cursor: pointer; }
.row:hover, .row.active { background: color-mix(in srgb, CanvasText 7%, transparent); }
.row .main { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.row .sub { color: GrayText; font-size: 11px; }
.muted { padding: 8px 10px; color: GrayText; cursor: default; }
.bar { display: flex; align-items: center; gap: 10px; padding: 10px 14px; left: 50%; transform: translateX(-50%); top: 12px; max-width: 520px; }
.bar .text { flex: 1; }
button { font: inherit; padding: 5px 12px; border: 0; border-radius: 6px; cursor: pointer; background: #0a84ff; color: #fff; }
button.quiet { background: transparent; color: GrayText; }
`;

class Panel {
  host = document.createElement("div");
  root = this.host.attachShadow({ mode: "closed" });
  box = document.createElement("div");

  constructor(cls: string) {
    const style = document.createElement("style");
    style.textContent = CSS;
    this.box.className = `box ${cls}`;
    this.host.dataset.icloudPasswords = cls;
    this.root.append(style, this.box);
    // Keep focus in the page's input while clicking inside the panel.
    this.host.addEventListener("mousedown", (e) => e.preventDefault());
  }

  show() {
    if (!this.host.isConnected) document.documentElement.append(this.host);
  }

  hide() {
    this.host.remove();
  }

  get open() {
    return this.host.isConnected;
  }
}

const menu = new Panel("menu");
const bar = new Panel("bar");
let anchor: Input | null = null;
let dismissed: Input | null = null;

function positionMenu() {
  if (!anchor) return;
  const r = anchor.getBoundingClientRect();
  const width = Math.max(r.width, 240);
  const below = window.innerHeight - r.bottom > 200;
  Object.assign(menu.box.style, {
    left: `${Math.min(r.left, window.innerWidth - width - 8)}px`,
    width: `${width}px`,
    top: below ? `${r.bottom + 4}px` : "",
    bottom: below ? "" : `${window.innerHeight - r.top + 4}px`,
  });
}

function row(main: string, sub: string | undefined, onClick: () => void) {
  const el = document.createElement("div");
  el.className = "row";
  const m = document.createElement("span");
  m.className = "main";
  m.textContent = main;
  el.append(m);
  if (sub) {
    const s = document.createElement("span");
    s.className = "sub";
    s.textContent = sub;
    el.append(s);
  }
  el.addEventListener("click", onClick);
  return el;
}

function muted(text: string) {
  const el = document.createElement("div");
  el.className = "muted";
  el.textContent = text;
  return el;
}

async function openMenu(input: Input, kind: Kind) {
  anchor = input;
  menu.box.replaceChildren();
  const items = await (kind === "otp" ? codeItems(input) : kind === "newPassword" ? [generateItem(input)] : loginItems(input));
  if (anchor !== input) return;
  if (!items) {
    closeMenu();
    return;
  }
  menu.box.append(...items);
  positionMenu();
  menu.show();
}

function closeMenu() {
  menu.hide();
  anchor = null;
}

// Null means there is nothing to show, so the menu stays closed.
async function codeItems(input: Input): Promise<HTMLElement[] | null> {
  const res = await send({ type: "PAGE_CODES" });
  if (!res.ok) return [muted(res.error)];
  if (!res.codes.some((c) => c.code)) pollCodes(input, res.codes);
  if (res.codes.length === 0) return null;
  return res.codes.map((entry) => row(entry.code || "Verification code", codeSource(entry), () => useCode(input, entry)));
}

function codeSource(entry: OneTimeCode) {
  if (entry.source === "totp") return entry.username || entry.domain;
  return entry.source ? `From ${entry.source}` : entry.domain;
}

async function useCode(input: Input, entry: OneTimeCode) {
  const res = await send({ type: "PAGE_CODE", entry });
  if (!res.ok) return;
  stopCodePoll();
  closeMenu();
  fillCode(input, res.code);
}

// Saved as soon as it's picked, like Safari, so a failed sign-up doesn't lose it.
function generateItem(input: Input) {
  return row("Use strong password", undefined, () => {
    const password = generatePassword();
    const fields = passwordFields(scope(input));
    for (const pw of fields) setValue(pw, password);
    closeMenu();
    send({ type: "GENERATED", username: usernameField(scope(input), fields[0])?.value.trim() ?? "", password });
  });
}

async function loginItems(input: Input) {
  const res = await send({ type: "PAGE_LOGINS" });
  if (!res.ok) return [muted(res.error)];
  if (res.state !== "ready") {
    return [row("Pair with iCloud Passwords…", undefined, () => {
      send({ type: "OPEN_POPUP" });
      closeMenu();
    })];
  }
  if (res.logins.length === 0) return [muted(`No saved passwords for ${location.hostname}`)];
  return res.logins.map((login) => {
    const site = login.sites[0];
    return row(login.username || "(no username)", site && site !== location.hostname ? site : undefined, () => useLogin(input, login));
  });
}

async function useLogin(input: Input, login: LoginName) {
  // A username-only page needs no password, so no Touch ID.
  if (input.type !== "password" && login.username && passwordFields(scope(input)).length === 0) {
    closeMenu();
    setValue(input, login.username);
    return;
  }
  const res = await send({ type: "PAGE_CREDENTIAL", login });
  if (!res.ok) return;
  closeMenu();
  fill(input, res.credential.username, res.credential.password);
}

// Codes usually arrive after the field is focused, so keep looking for a while.
let codePoll: { input: Input; until: number; timer: number; last: string } | null = null;

function pollCodes(input: Input, codes: OneTimeCode[]) {
  if (codePoll?.input === input) return;
  stopCodePoll();
  const poll = { input, until: Date.now() + 2 * 60_000, timer: 0, last: JSON.stringify(codes) };
  poll.timer = window.setInterval(async () => {
    if (document.activeElement !== input || Date.now() > poll.until) return stopCodePoll();
    const res = await send({ type: "PAGE_CODES" });
    if (!res.ok || codePoll !== poll) return;
    const now = JSON.stringify(res.codes);
    if (now === poll.last) return;
    poll.last = now;
    openMenu(input, "otp");
  }, 4000);
  codePoll = poll;
}

function stopCodePoll() {
  if (codePoll) clearInterval(codePoll.timer);
  codePoll = null;
}

document.addEventListener("focusin", (e) => {
  const input = e.target as Input;
  if (input === dismissed) return;
  dismissed = null;
  const kind = classify(input);
  if (kind) openMenu(input, kind);
  else if (menu.open) closeMenu();
});

document.addEventListener("focusout", (e) => {
  if (e.target === anchor) setTimeout(() => document.activeElement !== anchor && closeMenu(), 150);
});

document.addEventListener("mousedown", (e) => {
  if (menu.open && e.target !== anchor && e.target !== menu.host) closeMenu();
}, true);

document.addEventListener("keydown", (e) => {
  if (!menu.open) return;
  if (e.key === "Escape") {
    dismissed = anchor;
    stopCodePoll();
    closeMenu();
    return;
  }
  const rows = [...menu.box.querySelectorAll<HTMLElement>(".row")];
  if (!rows.length) return;
  const i = rows.findIndex((r) => r.classList.contains("active"));
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    rows[i]?.classList.remove("active");
    rows[(i + (e.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length].classList.add("active");
  } else if (e.key === "Enter" && i >= 0) {
    e.preventDefault();
    rows[i].click();
  }
}, true);

window.addEventListener("scroll", positionMenu, true);
window.addEventListener("resize", positionMenu);

// Submitted logins go to the background, which decides whether to offer saving.
let lastSubmission = { key: "", at: 0 };

function reportSubmission(root: ParentNode) {
  const passwords = passwordFields(root).filter((p) => p.value);
  const pw = passwords.find(isNewPassword) ?? passwords[0];
  const user = usernameField(root, pw);
  const username = user?.value.trim() ?? "";
  const password = pw?.value ?? "";
  if (!password && !username) return;
  const key = `${username}\0${password}`;
  if (key === lastSubmission.key && Date.now() - lastSubmission.at < 2000) return;
  lastSubmission = { key, at: Date.now() };
  send({ type: "SUBMITTED", username, password, newPassword: !!pw && isNewPassword(pw) });
}

document.addEventListener("submit", (e) => {
  if (e.target instanceof HTMLFormElement) reportSubmission(e.target);
}, true);

document.addEventListener("click", (e) => {
  const el = (e.target as Element | null)?.closest?.("button, input[type=submit], input[type=image], [role=button]");
  if (!(el instanceof HTMLElement) || el === menu.host || el === bar.host) return;
  const form = el.closest("form");
  if (form) reportSubmission(form);
  else if (passwordFields(document).some((p) => p.value)) reportSubmission(document);
}, true);

document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || !(e.target instanceof HTMLInputElement)) return;
  if (classify(e.target) || e.target.type === "password") reportSubmission(scope(e.target));
}, true);

window.addEventListener("pagehide", () => {
  if (passwordFields(document).some((p) => p.value)) reportSubmission(document);
});

function offerSave(username: string, hostname: string) {
  const text = document.createElement("span");
  text.className = "text";
  text.textContent = username
    ? `Save password for ${username} on ${hostname} to iCloud Passwords?`
    : `Save password for ${hostname} to iCloud Passwords?`;
  const save = document.createElement("button");
  save.textContent = "Save";
  const later = document.createElement("button");
  later.className = "quiet";
  later.textContent = "Not now";
  save.addEventListener("click", async () => {
    bar.hide();
    const res = await send({ type: "SAVE_PENDING", accept: true });
    if (!res.ok) console.warn("iCloud Passwords: save failed:", res.error);
  });
  later.addEventListener("click", () => {
    send({ type: "SAVE_PENDING", accept: false });
    bar.hide();
  });
  bar.box.replaceChildren(text, save, later);
  bar.show();
  setTimeout(() => bar.hide(), 30_000);
}

chrome.runtime.onMessage.addListener((msg: PageMessage, _sender, respond: (r: object) => void) => {
  switch (msg.type) {
    case "FILL": {
      const active = document.activeElement;
      respond(fill(active instanceof HTMLInputElement ? active : null, msg.username, msg.password));
      break;
    }
    case "OFFER_SAVE":
      offerSave(msg.username, msg.hostname);
      respond({ ok: true });
      break;
    case "CODE_ARRIVED": {
      const active = document.activeElement;
      if (active instanceof HTMLInputElement && isOtp(active)) openMenu(active, "otp");
      respond({ ok: true });
      break;
    }
    case "OPEN_MENU": {
      if (!document.hasFocus()) break;
      dismissed = null;
      const active = document.activeElement;
      const input = active instanceof HTMLInputElement ? active : usernameField(document) ?? passwordFields(document)[0];
      const kind = input && classify(input);
      if (input && kind) {
        input.focus();
        openMenu(input, kind);
      }
      respond({ ok: true });
      break;
    }
  }
});
