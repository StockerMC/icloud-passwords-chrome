// Which inputs on a page are logins, passwords and codes, and how to fill them.

export type Input = HTMLInputElement;
export type Kind = "username" | "password" | "newPassword" | "otp";

const USERNAME_HINTS = ["email", "mail", "user", "login", "account", "identifier", "phone"];
const NEW_PASSWORD_HINTS = ["new", "confirm", "create", "signup", "sign-up", "register", "repeat", "verify"];
const OTP_HINTS = ["otp", "one-time", "onetime", "totp", "verification", "2fa", "mfa", "passcode", "security code"];
const OTHER_CODE_HINTS = ["zip", "postal", "promo", "discount", "coupon", "voucher", "gift", "referral", "invite", "country", "area", "dial", "product", "barcode", "qr"];
const ATTRS = ["autocomplete", "name", "id", "placeholder", "aria-label"];

function hinted(input: Input, hints: string[]) {
  return ATTRS.some((a) => {
    const value = input.getAttribute(a)?.toLowerCase() ?? "";
    return hints.some((h) => value.includes(h));
  });
}

export function visible(el: HTMLElement) {
  if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
  const r = el.getBoundingClientRect();
  return r.width >= 20 && r.height >= 10 && r.bottom > 0 && r.right > 0;
}

export function scope(input: Input): ParentNode {
  return input.form ?? (input.getRootNode() as ParentNode);
}

function inputs(root: ParentNode) {
  return [...root.querySelectorAll<Input>("input")];
}

export function passwordFields(root: ParentNode) {
  return inputs(root).filter((i) => i.type === "password" && visible(i));
}

export function isNewPassword(input: Input) {
  if (input.autocomplete === "new-password") return true;
  if (input.autocomplete === "current-password") return false;
  return hinted(input, NEW_PASSWORD_HINTS) || passwordFields(scope(input)).length >= 2;
}

function isUsernameLike(input: Input) {
  if (!["text", "email", "tel", ""].includes(input.type)) return false;
  if (input.autocomplete === "username" || input.autocomplete === "email") return true;
  return hinted(input, USERNAME_HINTS);
}

export function isOtp(input: Input) {
  if (input.type === "password") return false;
  if (input.autocomplete === "one-time-code" || hinted(input, OTP_HINTS)) return true;
  if (hinted(input, ["code"])) return !hinted(input, OTHER_CODE_HINTS);
  const short = input.maxLength > 0 && input.maxLength <= 8;
  return (short || input.inputMode === "numeric") && hinted(input, ["pin"]);
}

export function classify(el: EventTarget | null): Kind | null {
  if (!(el instanceof HTMLInputElement) || el.readOnly || el.disabled || !visible(el)) return null;
  if (isOtp(el)) return "otp";
  if (el.type === "password") return isNewPassword(el) ? "newPassword" : "password";
  if (el.type === "search" || el.getAttribute("role") === "searchbox" || hinted(el, ["search", "filter", "query"])) return null;
  if (!isUsernameLike(el)) return null;
  // A lone username field is a two-step login; one next to a password field is a login form.
  const login = passwordFields(scope(el)).length > 0 || el.autocomplete === "username" || el.autocomplete === "email" || hinted(el, ["email", "user", "login"]);
  return login ? "username" : null;
}

// Sites that split the code into one box per digit.
function digitBoxes(input: Input) {
  const boxes = inputs(scope(input)).filter((i) => i.maxLength === 1 && visible(i) && !["password", "hidden"].includes(i.type));
  return boxes.length >= 4 && boxes.length <= 8 && boxes.includes(input) ? boxes : null;
}

export function fillCode(input: Input, code: string) {
  const boxes = digitBoxes(input);
  if (!boxes) return setValue(input, code);
  [...code].forEach((ch, i) => boxes[i] && setValue(boxes[i], ch));
}

export function usernameField(root: ParentNode, before?: Input) {
  const all = inputs(root);
  const end = before ? all.indexOf(before) : all.length;
  const candidates = all.slice(0, end).filter(visible).reverse();
  return candidates.find(isUsernameLike) ?? candidates.find((i) => ["text", "email", ""].includes(i.type)) ?? null;
}

// React, Vue and Angular all watch different things, so set the value through
// the native setter and dispatch the full event set.
export function setValue(input: Input, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  input.focus();
  setter ? setter.call(input, value) : (input.value = value);
  input.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.blur();
}

// Sites wire sign-in to a button click, a form submit or Enter, so try in that order.
export function submitLogin(input: Input) {
  const root = scope(input);
  const button = [...root.querySelectorAll<HTMLElement>("button:not([type=button]), input[type=submit]")].find(visible);
  if (button) return button.click();
  if (input.form) return input.form.requestSubmit();
  const target = passwordFields(root)[0] ?? input;
  target.focus();
  for (const type of ["keydown", "keypress", "keyup"]) {
    target.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
  }
}

// A 2FA setup page's otpauth link, or failing that its visible setup key:
// base32 with optional spacing, in a section that talks about keys or scanning.
// Base32 covers every letter, so a digit is required to rule out shouted prose.
export function otpSetup() {
  const link = document.querySelector<HTMLAnchorElement>('a[href^="otpauth://"]');
  if (link) return link.href;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    if (!el || ["SCRIPT", "STYLE"].includes(el.tagName) || !visible(el)) continue;
    const match = node.nodeValue?.match(/(?<![A-Za-z0-9])[A-Z2-7](?:[ -]?[A-Z2-7]){15,63}(?![A-Za-z0-9])/);
    if (!match) continue;
    const key = match[0].replace(/[ -]/g, "");
    if (!/[2-7]/.test(key)) continue;
    const context = (el.closest("li, td, form, section, article, main") ?? document.body).textContent?.toLowerCase() ?? "";
    if (/key|secret|manual|scan/.test(context)) return key;
  }
  return "";
}

export function fill(anchor: Input | null, username: string, password: string) {
  const root = anchor ? scope(anchor) : document;
  const pw = anchor?.type === "password" ? anchor : passwordFields(root)[0] ?? null;
  const user = anchor && anchor.type !== "password" ? anchor : usernameField(root, pw ?? undefined);
  if (!pw && !user) return { error: "No login fields on this page" };
  if (user && username) setValue(user, username);
  if (pw) setValue(pw, password);
  return { filled: { username: !!user, password: !!pw } };
}
