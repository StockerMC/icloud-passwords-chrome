import { getSettings, setSettings, type Settings } from "../settings";

const select = document.getElementById("remember") as HTMLSelectElement;
const gmail = document.getElementById("gmail") as HTMLInputElement;
const mail = document.getElementById("mail") as HTMLInputElement;
const messages = document.getElementById("messages") as HTMLInputElement;
const submit = document.getElementById("submit") as HTMLInputElement;
getSettings().then((s) => {
  select.value = String(s.rememberMinutes);
  gmail.checked = s.gmail;
  mail.checked = s.mail;
  messages.checked = s.messages;
  submit.checked = s.autoSubmit;
});
select.addEventListener("change", () => {
  setSettings({ rememberMinutes: Number(select.value) as Settings["rememberMinutes"] });
});
gmail.addEventListener("change", () => setSettings({ gmail: gmail.checked }));
mail.addEventListener("change", () => setSettings({ mail: mail.checked }));
messages.addEventListener("change", () => setSettings({ messages: messages.checked }));
submit.addEventListener("change", () => setSettings({ autoSubmit: submit.checked }));
