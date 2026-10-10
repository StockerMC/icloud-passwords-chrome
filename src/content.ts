const USERNAME_HINTS = ["email", "mail", "user", "login", "account", "identifier"];
const USERNAME_ATTRS = ["autocomplete", "name", "id", "placeholder", "aria-label"];

function visible(el: HTMLElement) {
  return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
}

function looksLikeUsername(input: HTMLInputElement) {
  if (!["text", "email", "tel", ""].includes(input.type)) return false;
  if (!visible(input)) return false;
  return USERNAME_ATTRS.some((attr) => {
    const v = input.getAttribute(attr)?.toLowerCase();
    return v !== undefined && USERNAME_HINTS.some((h) => v.includes(h));
  });
}

function passwordFields() {
  const all = [...document.querySelectorAll<HTMLInputElement>("input[type=password]")].filter(visible);
  const current = all.filter((i) => i.autocomplete === "current-password");
  return current.length ? current : all;
}

function pickPasswordField() {
  const fields = passwordFields();
  const active = document.activeElement;
  if (active instanceof HTMLInputElement) {
    if (fields.includes(active)) return active;
    const form = active.form;
    const inForm = fields.find((f) => form && f.form === form);
    if (inForm) return inForm;
  }
  return fields[0] ?? null;
}

// Walk backwards through the document from the password field to the closest
// preceding text input that looks like a username. Two-step logins where the
// username field is already gone just leave this null.
function findUsernameField(password: HTMLInputElement) {
  const form = password.form ?? document;
  const inputs = [...form.querySelectorAll<HTMLInputElement>("input")];
  const idx = inputs.indexOf(password);
  for (let i = idx - 1; i >= 0; i--) {
    if (looksLikeUsername(inputs[i])) return inputs[i];
  }
  for (let i = idx - 1; i >= 0; i--) {
    const input = inputs[i];
    if (["text", "email", ""].includes(input.type) && visible(input)) return input;
  }
  return null;
}

// React, Vue and Angular all watch different things, so set the value through
// the native setter and dispatch the full event set.
function setValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  input.focus();
  setter ? setter.call(input, value) : (input.value = value);
  input.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.blur();
}

export type FillRequest = { type: "FILL"; username: string; password: string };
export type FillResult = { filled: { username: boolean; password: boolean } };

chrome.runtime.onMessage.addListener((msg: FillRequest, _sender, respond: (r: FillResult | { error: string }) => void) => {
  if (msg?.type !== "FILL") return;
  const password = pickPasswordField();
  if (!password) {
    respond({ error: "No password field on this page" });
    return;
  }
  const username = findUsernameField(password);
  if (username && msg.username) setValue(username, msg.username);
  setValue(password, msg.password);
  respond({ filled: { username: !!username, password: true } });
});
