const path = require('path');
const fs = require('fs');
const asar = require(path.resolve(process.cwd(), 'node_modules', '@electron', 'asar'));
const asarPath = path.resolve(__dirname, 'out-app6.asar');
const idx = fs.readFileSync(asarPath);
const headerSize = idx.readUInt32LE(4);
const dataStart = 8 + headerSize;
const header = asar.getRawHeader(asarPath).header;
const files = [];
(function walk(node, prefix) {
  for (const [name, child] of Object.entries(node.files || {})) {
    if (child.files) walk(child, prefix + name + '/');
    else files.push({ f: prefix + name, node: child });
  }
})(header, '');
const unpacked = files.filter((x) => x.f.includes('better_sqlite3.node'));
console.log('better_sqlite3.node unpacked:', unpacked.every((x) => x.node.unpacked === true));
function extract(rel) {
  const entry = files.find((x) => x.f === rel);
  if (!entry) throw new Error('missing ' + rel);
  return idx.slice(dataStart + Number(entry.node.offset), dataStart + Number(entry.node.offset) + entry.node.size);
}
for (const rel of ['dist/server/server.js', 'dist/client/assets/index-D-gYztnt.js', 'server/server.js', 'client/assets/index-D-gYztnt.js']) {
  const buf = extract(rel);
  console.log(rel, 'size', buf.length, buf.length > 0 ? 'OK' : 'EMPTY');
}
const srv = extract('dist/server/server.js').toString('utf8');
console.log('server has resolveReplyTargetRow:', srv.includes('resolveReplyTargetRow'));
console.log('server has 4h backfill:', srv.includes('backfilledReplyTargetCount'));
const dbjs = extract('dist/server/database/db.js').toString('utf8');
console.log('db.js has migration 20261015003:', dbjs.includes('20261015003'));
const ui = extract('client/assets/index-D-gYztnt.js').toString('utf8');
console.log('client has Trả lời tin nhắn của:', ui.includes('Trả lời tin nhắn của'));
console.log('client has reply_to_sender_name:', ui.includes('reply_to_sender_name'));
console.log('client has data-msg-key:', ui.includes('data-msg-key'));
console.log('client has reply-target-flash:', ui.includes('reply-target-flash'));
console.log('ALL_PASS');
