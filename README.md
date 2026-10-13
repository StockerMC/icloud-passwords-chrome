# iCloud Passwords for Chrome

Fill iCloud Keychain passwords in Chrome, Brave and other Chromium browsers on macOS.

<img src="assets/demo.gif" width="720" alt="Filling a login, a verification code and a generated password from the menu">

## Install

```sh
npm install
npm run build
```

1. Open the browser's extensions page (e.g. `chrome://extensions`), enable Developer mode, Load unpacked, pick `dist/`.
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

Apple's extension re-asks for the pairing code every few hours, puts an
"Enable AutoFill" balloon on every field, and lags on busy pages.

This one pairs once per browser launch, only shows a menu on login and code fields,
and does nothing until you focus one. It can also fill verification codes that
arrive in Mail, Messages or Gmail, which Apple's extension can't.

## Codes from email and Messages

Apple's helper doesn't pass on codes that arrive in Mail or Messages, so they
are read directly. All three sources are off by default; turn them on in
Options (gear in the popup).

- Gmail: the inbox feed of the account the browser is signed in to.
- Mail app and Messages: a small app built on your Mac from the `host`
  folder by `npm run install-host`. Mail asks once to let it control Mail.
  Messages keeps its texts in a protected database, so the app needs Full
  Disk Access, granted to it alone; the installer opens the right System
  Settings pane and a Finder window to drag it from. It returns only recent
  messages that look like they carry a code, and only to this extension.
  `npm run uninstall-host` removes the app and its registrations.

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
