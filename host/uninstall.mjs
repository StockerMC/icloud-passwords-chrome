// Removes the host app and its native messaging registrations.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const support = path.join(os.homedir(), "Library", "Application Support");
const appDir = path.join(support, "iCloud Passwords for Chrome");
const manifest = "com.stockermc.icloud_passwords_codes.json";

const browsers = {
  Chrome: "Google/Chrome",
  Brave: "BraveSoftware/Brave-Browser",
  Edge: "Microsoft Edge",
  Chromium: "Chromium",
  Vivaldi: "Vivaldi",
  Arc: "Arc/User Data",
};
for (const [name, dir] of Object.entries(browsers)) {
  const file = path.join(support, dir, "NativeMessagingHosts", manifest);
  if (!fs.existsSync(file)) continue;
  fs.rmSync(file);
  console.log(`${name}: removed`);
}
fs.rmSync(appDir, { recursive: true, force: true });
console.log(`Removed ${appDir}.
The "iCloud Passwords Codes" entry under System Settings → Privacy & Security →
Full Disk Access can be removed too.`);
