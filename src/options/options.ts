import { getSettings, setSettings, type Settings } from "../settings";

const select = document.getElementById("remember") as HTMLSelectElement;
const gmail = document.getElementById("gmail") as HTMLInputElement;
getSettings().then((s) => {
  select.value = String(s.rememberMinutes);
  gmail.checked = s.gmail;
});
select.addEventListener("change", () => {
  setSettings({ rememberMinutes: Number(select.value) as Settings["rememberMinutes"] });
});
gmail.addEventListener("change", () => setSettings({ gmail: gmail.checked }));
