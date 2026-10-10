# iCloud Passwords for Chrome

Fill passwords from Apple Passwords (iCloud Keychain) in Chrome, Brave and other Chromium browsers on macOS.
An open replacement for Apple's iCloud Passwords extension.

It talks to the same helper Apple's extension uses
(`PasswordManagerBrowserExtensionHelper`, part of macOS 14+) over native
messaging. Pairing is SRP-6a with the 6-digit code macOS shows, then AES-GCM.
Nothing leaves your machine and the vault stays in iCloud.

## Install

Needs macOS 14+, iCloud Passwords turned on, and Node 20+.

```sh
npm install
npm run build
```

In `chrome://extensions` (or `brave://extensions`) enable Developer mode, click
Load unpacked, and pick `dist/`. The extension ID must be
`pejdijmoenmkgeppbflobdenhhabjlaj`. Disable Apple's extension if it is in the
same profile; two extensions cannot share an ID.

Click the toolbar icon or press ⌘⇧L. Type the code macOS shows, once per
browser launch. Click a login to fill it, or Copy for the password. macOS may
ask for Touch ID.

## Browsers

Works in Chrome, Brave, Edge, Vivaldi, Arc, Opera and ungoogled-chromium.
Unsigned Chromium builds don't work: the helper refuses to start under a
browser that isn't signed and on Apple's allowlist. Browsers other than
Chrome and Brave need Apple's host manifest linked into their own directory:

```sh
ln -s "/Library/Google/Chrome/NativeMessagingHosts/com.apple.passwordmanager.json" \
  "/Library/Application Support/Chromium/NativeMessagingHosts/"
```

## Why the fixed ID

Apple's helper only talks to Apple's extension IDs, and since macOS 15.4 only
to browsers on Apple's allowlist (Chrome, Brave, Edge, Vivaldi, Arc, Firefox and
others). The manifest carries Apple's public `key`, so Chrome gives an unpacked
copy the same ID. This also means it can't go on the Chrome Web Store.

## Layout

- `src/apple/srp.ts` SRP-6a session and AES-GCM framing
- `src/apple/client.ts` native messaging client
- `src/background.ts` service worker that owns the connection
- `src/popup/` popup UI
- `src/content.ts` form filling
- `e2e/pair.mjs` Playwright run against Brave

## Not yet

Saving passwords, one-time codes, password generation, inline field menus, Windows.

## Credits

Protocol details come from Apple's extension and
[au2001/icloud-passwords-firefox](https://github.com/au2001/icloud-passwords-firefox).

Apache-2.0. Apple, iCloud and Passwords are trademarks of Apple Inc.
