# iCloud Passwords for Chrome

Fill iCloud Keychain passwords in Chrome, Brave and other Chromium browsers on macOS.

## Install

```sh
npm install
npm run build
```

1. Open the browser's extensions page (`chrome://extensions`, `brave://extensions`),
   enable Developer mode, Load unpacked, pick `dist/`.
2. Click the toolbar icon (⌘⇧L) and type the code macOS shows. This repeats
   once per browser launch.

## Features

- Login fields get a menu of saved logins.
- Sign-up forms offer a strong password.
- Verification-code fields offer codes from the Passwords app and Messages,
  and from Gmail or Mail.app if turned on in Options.
- After a login with a new password, a bar offers to save it.
- The popup lists logins, copies passwords and generates new ones.

Touch ID prompts come from macOS; turn them off under System Settings →
Touch ID & Password → Password AutoFill.

## Email codes

Apple's helper only passes on codes from Messages, so email is read directly.
Both sources are off by default; turn them on in Options (gear in the popup).

- Gmail: the inbox feed of the account the browser is signed in to.
- Mail.app: a script that asks Mail for the last ten minutes of messages.
  Register it once with `npm run install-host`; macOS then asks once to let
  osascript control Mail.

## Browsers

Chrome and Brave work as is. Edge, Vivaldi, Arc and Opera need the helper's
manifest linked into their own directory:

```sh
ln -s /Library/Google/Chrome/NativeMessagingHosts/com.apple.passwordmanager.json \
  "/Library/Application Support/Chromium/NativeMessagingHosts/"
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
