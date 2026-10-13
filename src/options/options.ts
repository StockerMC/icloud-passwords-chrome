import { send } from "../messages";
import { getSettings, setSettings, type Settings } from "../settings";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const select = $<HTMLSelectElement>("remember");
const submit = $<HTMLInputElement>("submit");
const sources = {
  gmail: $<HTMLInputElement>("gmail"),
  mail: $<HTMLInputElement>("mail"),
  messages: $<HTMLInputElement>("messages"),
};
type Source = keyof typeof sources;

getSettings().then((s) => {
  select.value = String(s.rememberMinutes);
  submit.checked = s.autoSubmit;
  sources.gmail.checked = s.gmail;
  sources.mail.checked = s.mail;
  sources.messages.checked = s.messages;
  check((Object.keys(sources) as Source[]).filter((k) => sources[k].checked));
});

select.addEventListener("change", () => {
  setSettings({ rememberMinutes: Number(select.value) as Settings["rememberMinutes"] });
});
submit.addEventListener("change", () => setSettings({ autoSubmit: submit.checked }));
for (const [name, box] of Object.entries(sources) as [Source, HTMLInputElement][]) {
  box.addEventListener("change", () => {
    setSettings({ [name]: box.checked });
    if (box.checked) check([name]);
    else $(`${name}-status`).textContent = "";
  });
}

async function check(names: Source[]) {
  if (!names.length) return;
  for (const name of names) $(`${name}-status`).textContent = "Checking…";
  const res = await send({ type: "SOURCES" });
  for (const name of names) {
    $(`${name}-status`).textContent = res.ok ? res.sources[name] || "Working" : res.error;
  }
}
