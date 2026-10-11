// Registers host/mail.js as a native messaging host for the browsers found on this Mac.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const script = path.join(import.meta.dirname, "mail.js");
fs.chmodSync(script, 0o755);

const manifest = {
  name: "com.stockermc.icloud_passwords_mail",
  description: "Recent Mail.app messages for iCloud Passwords for Chrome",
  path: script,
  type: "stdio",
  allowed_origins: ["chrome-extension://pejdijmoenmkgeppbflobdenhhabjlaj/"],
};

const support = path.join(os.homedir(), "Library", "Application Support");
const browsers = {
  Chrome: "Google/Chrome",
  Brave: "BraveSoftware/Brave-Browser",
  Edge: "Microsoft Edge",
  Chromium: "Chromium",
  Vivaldi: "Vivaldi",
  Arc: "Arc/User Data",
};
for (const [name, dir] of Object.entries(browsers)) {
  if (!fs.existsSync(path.join(support, dir))) continue;
  const hosts = path.join(support, dir, "NativeMessagingHosts");
  fs.mkdirSync(hosts, { recursive: true });
  fs.writeFileSync(path.join(hosts, `${manifest.name}.json`), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`${name}: installed`);
}
