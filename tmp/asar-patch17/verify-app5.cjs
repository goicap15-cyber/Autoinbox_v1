const path = require('path');
const fs = require('fs');
const asar = require(path.resolve(process.cwd(), 'node_modules', '@electron', 'asar'));
const asarPath = path.resolve(__dirname, 'out-app5.asar');
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
const srv = extract('dist/server/server.js').toString('utf8');
console.log('server has reply_to_text:', srv.includes('reply_to_text'));
console.log('server has WS_SKIP_BUBBLE_INDEX_DRIFT_GHOST:', srv.includes('WS_SKIP_BUBBLE_INDEX_DRIFT_GHOST'));
console.log('server has drift quote backfill:', srv.includes('Backfill quote qua drift guard'));
const cls = extract('dist/server/database/db.js').toString('utf8');
console.log('server has 4f sweeper:', srv.includes('deletedHeaderGhostCount'));
console.log('db.js has delete_reply_header_ghost_rows:', cls.includes('delete_reply_header_ghost_rows'));
const clsRoot = extract('server/database/db.js').toString('utf8');
console.log('db.js ROOT has 20261015002:', clsRoot.includes('20261015002'));
const ui = extract('dist/client/assets/index-l8lmiRjl.js').toString('utf8');
console.log('client has Trả lời tin nhắn:', ui.includes('Trả lời tin nhắn'));
console.log('ALL_PASS');
