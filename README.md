# iCloud Passwords for Chrome

Fill iCloud Keychain passwords in Chrome, Brave and other Chromium browsers on macOS.

<img src="assets/demo.gif" width="720" alt="Filling a login, a verification code and a generated password from the menu">

## Install

Download the zip from the [latest release](https://github.com/StockerMC/icloud-passwords-chrome/releases/latest) and unzip it, or build it yourself:

```sh
npm install
npm run build
```

1. Open the browser's extensions page (e.g. `chrome://extensions`), enable Developer mode, Load unpacked, pick the unzipped folder (or `dist/`).
2. Click the toolbar icon and type the code macOS shows. This repeats once per browser launch.

## Features

- Saved logins in a menu on login fields, with optional sign-in after filling
- Password generation
- Verification codes from the Passwords app, plus Gmail, the Mail app or Messages if you turn them on
- Adds a site's verification code to the Passwords app from its 2FA setup page
- Offers to save new logins

Touch ID prompts come from macOS; turn them off under System Settings →
Touch ID & Password → Password AutoFill.

## Compared with Apple's extension

Pairs once per browser launch instead of every few hours, shows a menu only
on login and code fields, and fills codes from Mail, Messages and Gmail.

## Codes from email and Messages

Off by default; turn them on in Options (gear in the popup).

- Gmail: reads the inbox feed of the account the browser is signed in to.
- Mail and Messages: `npm run install-host` builds a small helper app. Mail
  asks once to let it control Mail; Messages needs Full Disk Access for that
  app, which the installer walks you through. `npm run uninstall-host`
  removes it.

## Browsers

Chrome and Brave work as is. Other Chromium browsers look for the helper's
manifest in their own folder under `~/Library/Application Support`, so link
it there once, e.g. for Edge:

```sh
ln -s /Library/Google/Chrome/NativeMessagingHosts/com.apple.passwordmanager.json \
  ~/Library/Application\ Support/Microsoft\ Edge/NativeMessagingHosts/
```

Unsigned Chromium builds don't work; Apple's helper only runs under browsers it
allowlists.

## Limitations

- Windows isn't currently supported.
- It's not on the Chrome Web Store because the helper only talks to Apple's
  extension ID, so the manifest reuses Apple's key and can't be published.

---

Protocol worked out from Apple's extension and
[au2001/icloud-passwords-firefox](https://github.com/au2001/icloud-passwords-firefox).
Apache-2.0.
