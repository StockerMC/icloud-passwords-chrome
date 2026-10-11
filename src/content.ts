import type { LoginName, OneTimeCode } from "./apple/enums";
import { generatePassword } from "./generate";
import { send, type Response, type State } from "./messages";

export type PageMessage =
  | { type: "FILL"; username: string; password: string }
  | { type: "OFFER_SAVE"; username: string; hostname: string }
  | { type: "CODE_ARRIVED" };

type Input = HTMLInputElement;
type Kind = "username" | "password" | "newPassword" | "otp";

const USERNAME_HINTS = ["email", "mail", "user", "login", "account", "identifier", "phone"];
const NEW_PASSWORD_HINTS = ["new", "confirm", "create", "signup", "sign-up", "register", "repeat", "verify"];
const OTP_HINTS = ["otp", "one-time", "onetime", "totp", "verification", "2fa", "mfa", "passcode", "security code"];
const ATTRS = ["autocomplete", "name", "id", "placeholder", "aria-label"];

function attrs(input: Input) {
  return ATTRS.map((a) => input.getAttribute(a)?.toLowerCase() ?? "");
}

function hinted(input: Input, hints: string[]) {
  return attrs(input).some((v) => hints.some((h) => v.includes(h)));
}

function visible(el: HTMLElement) {
  if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
  const r = el.getBoundingClientRect();
  return r.width >= 20 && r.height >= 10 && r.bottom > 0 && r.right > 0;
}

function scope(input: Input): ParentNode {
  return input.form ?? (input.getRootNode() as ParentNode);
}

function inputs(root: ParentNode) {
  return [...root.querySelectorAll<Input>("input")];
}

function passwordFields(root: ParentNode) {
  return inputs(root).filter((i) => i.type === "password" && visible(i));
}

function isNewPassword(input: Input) {
  if (input.autocomplete === "new-password") return true;
  if (input.autocomplete === "current-password") return false;
  return hinted(input, NEW_PASSWORD_HINTS) || passwordFields(scope(input)).length >= 2;
}

function isUsernameLike(input: Input) {
  if (!["text", "email", "tel", ""].includes(input.type)) return false;
  if (input.autocomplete === "username" || input.autocomplete === "email") return true;
  return hinted(input, USERNAME_HINTS);
}

function classify(el: EventTarget | null): Kind | null {
  if (!(el instanceof HTMLInputElement) || el.readOnly || el.disabled || !visible(el)) return null;
  if (isOtp(el)) return "otp";
  if (el.type === "password") return isNewPassword(el) ? "newPassword" : "password";
  if (el.type === "search" || el.getAttribute("role") === "searchbox") return null;
  if (!isUsernameLike(el)) return null;
  // A lone username field is a two-step login; one next to a password field is a login form.
  return passwordFields(scope(el)).length > 0 || el.autocomplete === "username" || el.autocomplete === "email" || hinted(el, ["email", "user", "login"])
    ? "username"
    : null;
}

function isOtp(input: Input) {
  if (input.type === "password") return false;
  if (input.autocomplete === "one-time-code" || hinted(input, OTP_HINTS)) return true;
  const short = input.maxLength > 0 && input.maxLength <= 8;
  return (short || input.inputMode === "numeric") && hinted(input, ["code", "pin"]);
}

// Sites that split the code into one box per digit.
function digitBoxes(input: Input) {
  const boxes = inputs(scope(input)).filter((i) => i.maxLength === 1 && visible(i) && !["password", "hidden"].includes(i.type));
  return boxes.length >= 4 && boxes.length <= 8 && boxes.includes(input) ? boxes : null;
}

function fillCode(input: Input, code: string) {
  const boxes = digitBoxes(input);
  if (!boxes) return setValue(input, code);
  [...code].forEach((ch, i) => boxes[i] && setValue(boxes[i], ch));
}

function usernameField(root: ParentNode, before?: Input) {
  const all = inputs(root);
  const end = before ? all.indexOf(before) : all.length;
  const candidates = all.slice(0, end).filter(visible);
  return candidates.reverse().find(isUsernameLike) ?? candidates.reverse().find((i) => ["text", "email", ""].includes(i.type)) ?? null;
}

// React, Vue and Angular all watch different things, so set the value through
// the native setter and dispatch the full event set.
function setValue(input: Input, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  input.focus();
  setter ? setter.call(input, value) : (input.value = value);
  input.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.blur();
}

function fill(anchor: Input | null, username: string, password: string) {
  const root = anchor ? scope(anchor) : document;
  const passwords = passwordFields(root);
  const pw = anchor?.type === "password" ? anchor : passwords[0] ?? null;
  const user = anchor && anchor.type !== "password" ? anchor : usernameField(root, pw ?? undefined);
  if (!pw && !user) return { error: "No login fields on this page" };
  if (user && username) setValue(user, username);
  if (pw) setValue(pw, password);
  return { filled: { username: !!user, password: !!pw } };
}

// --- in-page UI -------------------------------------------------------------

const CSS = `
:host { all: initial; }
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
let anchor: Input | null = null;
let dismissed: Input | null = null;
// Codes usually arrive after the field is focused, so keep looking for a while.
let codePoll: { input: Input; until: number; timer: number; last: string } | null = null;

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
  const items: HTMLElement[] = [];

  if (kind === "otp") {
    const res = await send<{ ok: true; codes: OneTimeCode[] } | { ok: false; error: string }>({ type: "PAGE_CODES" });
    if (anchor !== input) return;
    if (res.ok && !res.codes.some((c) => c.code)) pollCodes(input, res.codes);
    if (!res.ok) items.push(muted(res.error));
    else if (res.codes.length === 0) {
      closeMenu();
      return;
    } else {
      for (const entry of res.codes) {
        const from = entry.source === "totp" ? entry.username || entry.domain : entry.source ? `From ${entry.source}` : entry.domain;
        items.push(
          row(entry.code || "Verification code", from || undefined, async () => {
            const r = await send<{ ok: true; code: string } | { ok: false; error: string }>({ type: "PAGE_CODE", entry });
            if (!r.ok) return;
            stopCodePoll();
            closeMenu();
            fillCode(input, r.code);
          }),
        );
      }
    }
  } else if (kind === "newPassword") {
    items.push(
      row("Use strong password", undefined, () => {
        const password = generatePassword();
        for (const pw of passwordFields(scope(input))) setValue(pw, password);
        closeMenu();
      }),
    );
  } else {
    const res = await send<{ ok: true; logins: LoginName[]; state: State } | { ok: false; error: string }>({ type: "PAGE_LOGINS" });
    if (anchor !== input) return;
    if (!res.ok) items.push(muted(res.error));
    else if (res.state !== "ready") {
      items.push(row("Pair with iCloud Passwords…", undefined, () => (send({ type: "OPEN_POPUP" }), closeMenu())));
    } else if (res.logins.length === 0) items.push(muted(`No saved passwords for ${location.hostname}`));
    else {
      for (const login of res.logins) {
        const site = login.sites[0];
        items.push(
          row(login.username || "(no username)", site && site !== location.hostname ? site : undefined, async () => {
            // A username-only page needs no password, so no Touch ID.
            if (input.type !== "password" && login.username && passwordFields(scope(input)).length === 0) {
              closeMenu();
              setValue(input, login.username);
              return;
            }
            const r = await send<Response>({ type: "PAGE_CREDENTIAL", login });
            if (!r.ok) return;
            const { username, password } = (r as { credential: { username: string; password: string } }).credential;
            closeMenu();
            fill(input, username, password);
          }),
        );
      }
    }
  }

  menu.box.append(...items);
  positionMenu();
  menu.show();
}

function closeMenu() {
  menu.hide();
  anchor = null;
}

function pollCodes(input: Input, codes: OneTimeCode[]) {
  if (codePoll?.input === input) return;
  stopCodePoll();
  const timer = window.setInterval(async () => {
    if (document.activeElement !== input || Date.now() > codePoll!.until) return stopCodePoll();
    const res = await send<{ ok: true; codes: OneTimeCode[] } | { ok: false; error: string }>({ type: "PAGE_CODES" });
    if (!res.ok || !codePoll) return;
    const now = JSON.stringify(res.codes);
    if (now === codePoll.last) return;
    codePoll.last = now;
    openMenu(input, "otp");
  }, 4000);
  codePoll = { input, until: Date.now() + 2 * 60_000, timer, last: JSON.stringify(codes) };
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

// --- capturing submissions --------------------------------------------------

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

// --- save bar ---------------------------------------------------------------

const bar = new Panel("bar");

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
    const r = await send<Response>({ type: "SAVE_PENDING", accept: true });
    if (!r.ok) console.warn("iCloud Passwords: save failed:", r.error);
  });
  later.addEventListener("click", () => (send({ type: "SAVE_PENDING", accept: false }), bar.hide()));
  bar.box.replaceChildren(text, save, later);
  bar.show();
  setTimeout(() => bar.hide(), 30_000);
}

chrome.runtime.onMessage.addListener((msg: PageMessage, _sender, respond: (r: object) => void) => {
  if (msg.type === "FILL") respond(fill(document.activeElement instanceof HTMLInputElement ? document.activeElement : null, msg.username, msg.password));
  else if (msg.type === "OFFER_SAVE") (offerSave(msg.username, msg.hostname), respond({ ok: true }));
  else if (msg.type === "CODE_ARRIVED") {
    const active = document.activeElement;
    if (active instanceof HTMLInputElement && isOtp(active)) openMenu(active, "otp");
    respond({ ok: true });
  }
});
