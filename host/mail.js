#!/usr/bin/osascript -l JavaScript
// Native messaging host that returns recent inbox messages from Mail.app.
// Request: {"since": <ms since epoch>}. Reply: {"messages": [...]}.
ObjC.import("Foundation");

const stdin = $.NSFileHandle.fileHandleWithStandardInput;
const stdout = $.NSFileHandle.fileHandleWithStandardOutput;

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

function messages(since) {
  const Mail = Application("Mail");
  if (!Mail.running()) return [];
  return Mail.inbox.messages.whose({ dateReceived: { _greaterThan: new Date(since) } })().map((m) => ({
    sender: m.sender(),
    subject: m.subject(),
    text: (m.content() || "").slice(0, 400),
    received: m.dateReceived().getTime(),
  }));
}

for (let req; (req = read()); ) {
  try {
    write({ messages: messages(req.since) });
  } catch (e) {
    write({ error: String(e) });
  }
}
