import { getSettings, setSettings, type Settings } from "../settings";

const select = document.getElementById("remember") as HTMLSelectElement;
getSettings().then((s) => (select.value = String(s.rememberMinutes)));
select.addEventListener("change", () => {
  setSettings({ rememberMinutes: Number(select.value) as Settings["rememberMinutes"] });
});
