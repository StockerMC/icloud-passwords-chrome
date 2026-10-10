# iCloud Passwords for Chrome

Fill iCloud Keychain passwords in Chrome, Brave and other Chromium browsers on macOS.

Uses the same macOS helper as Apple's extension, so nothing leaves your Mac.

## Install

```sh
npm install
npm run build
```

1. Open `chrome://extensions`, enable Developer mode, Load unpacked, pick `dist/`.
2. Disable Apple's iCloud Passwords extension if it's installed.
3. Click the toolbar icon (⌘⇧L) and type the code macOS shows.

Focus a login field to get a menu of saved logins. Sign-up forms offer a strong
password. Verification-code fields offer codes from the Passwords app and codes
that just arrived in Messages or Mail. After logging in with a new login, a bar
offers to save it through Apple's own save sheet. The popup lists logins, copies
passwords and generates new ones.

Pairing repeats once per browser launch. Touch ID prompts come from macOS; turn
them off under System Settings → Touch ID & Password → Password AutoFill, or
let the extension remember a read password for a few minutes (see Options).

## Browsers

Chrome, Brave, Edge, Vivaldi, Arc, Opera. Unsigned Chromium builds don't work:
Apple's helper only runs under browsers it allowlists. Browsers other than
Chrome and Brave need the host manifest linked into their own directory, e.g.

```sh
ln -s /Library/Google/Chrome/NativeMessagingHosts/com.apple.passwordmanager.json \
  "/Library/Application Support/Chromium/NativeMessagingHosts/"
```

## Why the ID is fixed

The helper only accepts Apple's extension ID, so the manifest reuses Apple's
public key. That's why this can't be on the Chrome Web Store.

## Test

```sh
npm run test:e2e
```

Opens Chrome with a fresh profile, waits for you to type the pairing code,
then lists logins and runs the menu, generator and code field against a local
page, and the save bar against a public test login page (the keychain won't
store logins for localhost). Delete the test entry afterwards.
`BROWSER=/path/to/Brave` to use another browser.

## Not yet

Windows.

Protocol worked out from Apple's extension and
[au2001/icloud-passwords-firefox](https://github.com/au2001/icloud-passwords-firefox).
Apache-2.0.
