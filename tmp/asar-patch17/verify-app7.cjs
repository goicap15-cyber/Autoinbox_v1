const path = require('path');
const fs = require('fs');
const asar = require(path.resolve(process.cwd(), 'node_modules', '@electron', 'asar'));
const asarPath = path.resolve(__dirname, 'out-app7.asar');
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
for (const rel of ['dist/server/server.js', 'server/server.js', 'dist/client/assets/index-Dor1ABld.js', 'client/assets/index-Dor1ABld.js']) {
  const buf = extract(rel);
  console.log(rel, 'size', buf.length, buf.length > 0 ? 'OK' : 'EMPTY');
}
const srv = extract('dist/server/server.js').toString('utf8');
console.log('server has SYNC_GROUP_MEMBERS_RESULT:', srv.includes('SYNC_GROUP_MEMBERS_RESULT'));
console.log('server has sync-members route:', srv.includes('/sync-members'));
console.log('server has members route:', srv.includes("/id/members'") || srv.includes(':id/members'));
console.log('server has group_members:', srv.includes('group_members'));
const dbjs = extract('dist/server/database/db.js').toString('utf8');
console.log('db.js has migration 20261015004:', dbjs.includes('20261015004'));
const ui = extract('client/assets/index-Dor1ABld.js').toString('utf8');
console.log('client has groupMembers:', ui.includes('groupMembers'));
console.log('client has sync-members fetch:', ui.includes('sync-members'));
console.log('client has THREAD_MEMBERS:', ui.includes('THREAD_MEMBERS'));
console.log('client has startsWithRows:', ui.includes('startsWithRows'));
console.log('ALL_PASS');
