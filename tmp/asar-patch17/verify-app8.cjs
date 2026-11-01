const path = require('path');
const fs = require('fs');
const asar = require(path.resolve(process.cwd(), 'node_modules', '@electron', 'asar'));
const asarPath = path.resolve(__dirname, 'out-app8.asar');
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
for (const rel of ['dist/server/server.js', 'server/server.js', 'dist/extension/background.js', 'dist/client/assets/index-Dor1ABld.js', 'client/assets/index-Dor1ABld.js']) {
  const buf = extract(rel);
  console.log(rel, 'size', buf.length, buf.length > 0 ? 'OK' : 'EMPTY');
}
const srv = extract('dist/server/server.js').toString('utf8');
console.log('server has autoDetectMentionsFromText:', srv.includes('autoDetectMentionsFromText'));
console.log('server has normMentionKey:', srv.includes('normMentionKey'));
console.log('server has group_members query:', srv.includes('SELECT name FROM group_members WHERE thread_id = ?'));
console.log('server has SYNC_GROUP_MEMBERS_RESULT:', srv.includes('SYNC_GROUP_MEMBERS_RESULT'));
console.log('server has migration 20261015004:', srv.includes('20261015004'));
const bg = extract('dist/extension/background.js').toString('utf8');
console.log('bg has dispatchMentionSelect:', bg.includes('dispatchMentionSelect'));
console.log('bg has dropdown probe (Gợi ý lượt nhắc):', bg.includes('Gợi ý lượt nhắc'));
console.log('bg has CONTENT_DEBUG mention segments:', bg.includes("stage: 'segments'"));
console.log('bg has member scan:', bg.includes('SYNC_GROUP_MEMBERS_RESULT'));
const ui = extract('client/assets/index-Dor1ABld.js').toString('utf8');
console.log('client has groupMembers prop:', ui.includes('groupMembers'));
console.log('client has sync-members:', ui.includes('sync-members'));
console.log('client has THREAD_MEMBERS:', ui.includes('THREAD_MEMBERS'));
console.log('ALL_PASS');
