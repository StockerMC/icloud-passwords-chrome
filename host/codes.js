// Native messaging host that returns recent messages from Mail and Messages.
// Loaded by the host app (see host/install.mjs).
// Request: {"since": <ms since epoch>, "mail": bool, "messages": bool}.
// Reply: {"messages": [{source, sender, subject, text, received}]}.
ObjC.import("Foundation");

const stdin = $.NSFileHandle.fileHandleWithStandardInput;
const stdout = $.NSFileHandle.fileHandleWithStandardOutput;
const app = Application.currentApplication();
app.includeStandardAdditions = true;

// Only messages that look like they carry a code leave this process, trimmed.
const HINTS = /\b(code|verif|passcode|one[- ]?time|otp|2fa|pin|sign[- ]?in|log[- ]?in|confirm)/i;
const LIMIT = 300;

function bytesToString(data, encoding) {
  return ObjC.unwrap($.NSString.alloc.initWithDataEncoding(data, encoding));
}

function read() {
  const header = stdin.readDataOfLength(4);
  if (Number(header.length) < 4) return null;
  const b = bytesToString(header, $.NSISOLatin1StringEncoding);
  const length = b.charCodeAt(0) | (b.charCodeAt(1) << 8) | (b.charCodeAt(2) << 16) | (b.charCodeAt(3) << 24);
  return JSON.parse(bytesToString(stdin.readDataOfLength(length), $.NSUTF8StringEncoding));
}

function write(reply) {
  const body = $(JSON.stringify(reply)).dataUsingEncoding($.NSUTF8StringEncoding);
  const n = Number(body.length);
  const header = String.fromCharCode(n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255);
  stdout.writeData($(header).dataUsingEncoding($.NSISOLatin1StringEncoding));
  stdout.writeData(body);
}

function mail(since) {
  const Mail = Application("Mail");
  if (!Mail.running()) return [];
  return Mail.inbox.messages.whose({ dateReceived: { _greaterThan: new Date(since) } })().map((m) => ({
    source: "Mail",
    sender: m.sender(),
    subject: m.subject(),
    text: (m.content() || "").slice(0, LIMIT),
    received: m.dateReceived().getTime(),
  }));
}

// Messages keeps its texts in a SQLite database behind Full Disk Access. macOS
// charges file access by a process launched from the browser to the browser,
// so the query runs in a second copy of this app started through `open`, which
// is judged as itself and so covered by the grant made to this app.
function messages(since) {
  const dir = ObjC.unwrap($("~/Library/Application Support/iCloud Passwords for Chrome/tmp").stringByExpandingTildeInPath);
  $.NSFileManager.defaultManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(dir, true, $({ NSFilePosixPermissions: 0o700 }), null);
  const reply = `${dir}/${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
  const bundle = ObjC.unwrap($.NSBundle.mainBundle.bundlePath);
  try {
    app.doShellScript(`open -n -W -a ${quote(bundle)} --args --query ${Math.floor(Number(since))} ${quote(reply)}`);
    const data = $.NSString.stringWithContentsOfFileEncodingError(reply, $.NSUTF8StringEncoding, null);
    const out = JSON.parse(data.isNil() ? "{}" : ObjC.unwrap(data));
    if (out.error) throw new Error(out.error);
    return out.messages || [];
  } finally {
    $.NSFileManager.defaultManager.removeItemAtPathError(reply, null);
  }
}

function quote(s) {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

// Newer macOS stores the text only inside attributedBody, an archived
// NSAttributedString, where it follows an "NSString" marker and a length.
function queryMessages(since) {
  const db = "~/Library/Messages/chat.db";
  const appleSeconds = Math.floor(Number(since) / 1000) - 978307200;
  if (!Number.isFinite(appleSeconds)) return [];
  const sql = `select h.id as sender, m.text, hex(m.attributedBody) as body, m.date from message m left join handle h on h.ROWID = m.handle_id where m.is_from_me = 0 and m.date > ${appleSeconds} * 1000000000 order by m.date desc limit 20`;
  const rows = JSON.parse(app.doShellScript(`sqlite3 -readonly -json ${db} "${sql}"`) || "[]");
  return rows.map((r) => ({
    source: "Messages",
    sender: r.sender || "",
    subject: "",
    text: (r.text || archivedText(r.body || "")).slice(0, LIMIT),
    received: Math.floor(r.date / 1000000) + 978307200000,
  }));
}

function archivedText(hex) {
  const bytes = [];
  for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
  const marker = "NSString".split("").map((c) => c.charCodeAt(0));
  let at = -1;
  for (let i = 0; i + marker.length <= bytes.length && at < 0; i++) {
    if (marker.every((b, j) => bytes[i + j] === b)) at = i + marker.length;
  }
  if (at < 0) return "";
  let i = at;
  while (i < bytes.length && bytes[i] !== 0x2b) i++;
  i++;
  let length = bytes[i++];
  if (length === 0x81) {
    length = bytes[i] | (bytes[i + 1] << 8);
    i += 2;
  }
  return ObjC.unwrap($.NSString.alloc.initWithDataEncoding($.NSData.dataWithBytesLength(bytes.slice(i, i + length), length), $.NSUTF8StringEncoding)) || "";
}

function check(fn) {
  try {
    fn();
    return "";
  } catch (e) {
    if (!Application("Mail").running() && String(e).includes("Mail")) return "Mail isn't running";
    return /not authori[sz]ed|-1743/i.test(String(e)) ? "Allow the app to control Mail when macOS asks" : String(e);
  }
}

const argv = ObjC.deepUnwrap($.NSProcessInfo.processInfo.arguments);
const query = argv.indexOf("--query");
if (query >= 0) {
  const [since, reply] = argv.slice(query + 1);
  let out;
  try {
    out = { messages: queryMessages(Number(since)) };
  } catch (e) {
    out = { error: String(e) };
  }
  $(JSON.stringify(out)).writeToFileAtomicallyEncodingError(reply, true, $.NSUTF8StringEncoding, null);
} else for (let req; (req = read()); ) {
  try {
    if (req.status) {
      write({ mail: check(() => mail(Date.now() - 60000)), messages: check(() => messages(Date.now() - 60000)) });
      continue;
    }
    const out = [];
    if (req.mail) out.push(...mail(req.since));
    if (req.messages) out.push(...messages(req.since));
    write({ messages: out.filter((m) => HINTS.test(`${m.subject} ${m.text}`)) });
  } catch (e) {
    write({ error: String(e) });
  }
}
