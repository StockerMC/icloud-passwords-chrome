// Compiled into the host app by host/install.mjs. It only loads codes.js from
// next to the app, so the signed bundle never changes when the code does and
// the permissions granted to it survive updates.
ObjC.import("Foundation");
const dir = ObjC.unwrap($.NSBundle.mainBundle.bundlePath.stringByDeletingLastPathComponent);
eval(ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError(`${dir}/codes.js`, $.NSUTF8StringEncoding, null)));
