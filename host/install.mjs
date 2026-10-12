// Builds the host app from host/stub.js, puts host/codes.js next to it, and
// registers it as a native messaging host with the browsers found on this Mac.
// Being an app of its own means macOS grants permissions (Full Disk Access,
// Automation) to it alone.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const support = path.join(os.homedir(), "Library", "Application Support");
const appDir = path.join(support, "iCloud Passwords for Chrome");
const app = path.join(appDir, "iCloud Passwords Codes.app");
fs.mkdirSync(appDir, { recursive: true });

// osacompile rejects the shebang line, which is only there for running the script directly.
const source = fs.readFileSync(path.join(import.meta.dirname, "stub.js"), "utf8");
fs.copyFileSync(path.join(import.meta.dirname, "codes.js"), path.join(appDir, "codes.js"));
// macOS ties a Full Disk Access grant to the exact build, so only rebuild when the stub changed.
const stamp = path.join(appDir, "stub.sha256");
const hash = createHash("sha256").update(source).update(fs.readFileSync(new URL(import.meta.url))).digest("hex");
const rebuilt = !fs.existsSync(app) || !fs.existsSync(stamp) || fs.readFileSync(stamp, "utf8") !== hash;
if (rebuilt) {
  const tmp = path.join(os.tmpdir(), "icloud-passwords-codes.js");
  fs.writeFileSync(tmp, source);
  fs.rmSync(app, { recursive: true, force: true });
  execFileSync("osacompile", ["-l", "JavaScript", "-o", app, tmp]);
  fs.rmSync(tmp);
  const plist = path.join(app, "Contents", "Info.plist");
  // No Dock icon while the browser has it running, and a stable identity for
  // the permission grants. Editing the plist breaks the signature, so re-sign.
  execFileSync("defaults", ["write", plist, "LSUIElement", "-bool", "true"]);
  execFileSync("defaults", ["write", plist, "CFBundleIdentifier", "com.stockermc.icloud-passwords-codes"]);
  execFileSync("codesign", ["--force", "--sign", "-", app]);
  fs.writeFileSync(stamp, hash);
}

const manifest = {
  name: "com.stockermc.icloud_passwords_codes",
  description: "Recent Mail and Messages texts for iCloud Passwords for Chrome",
  path: path.join(app, "Contents", "MacOS", "applet"),
  type: "stdio",
  allowed_origins: ["chrome-extension://pejdijmoenmkgeppbflobdenhhabjlaj/"],
};

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
if (rebuilt) {
  console.log(`
The app was built. For codes from Messages, give "iCloud Passwords Codes"
Full Disk Access: drag it from the Finder window into the list in the System
Settings pane, both open now. macOS never prompts for this one, and a rebuilt
app needs granting again. Then turn on the sources you want in the extension's
Options.`);
  execFileSync("open", ["-R", app]);
  execFileSync("open", ["x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"]);
}
