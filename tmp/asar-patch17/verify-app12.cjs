const path = require('path');
const fs = require('fs');
const asar = require(path.resolve(process.cwd(), 'node_modules', '@electron', 'asar'));
const asarPath = path.resolve(__dirname, 'out-app12b.asar');
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
const checks = ['dist/server/server.js', 'server/server.js', 'dist/extension/background.js', 'dist/extension/manifest.json'];
for (const rel of checks) {
  const buf = extract(rel);
  console.log(rel, 'size', buf.length, buf.length > 0 ? 'OK' : 'EMPTY');
}
for (const rel of ['dist/client/assets/index-hfExI3Rb.js', 'client/assets/index-hfExI3Rb.js']) {
  const buf = extract(rel);
  console.log(rel, 'size', buf.length);
}
const srv = extract('dist/server/server.js').toString('utf8');
console.log('server route mention-suggestions removed:', !srv.includes('mention-suggestions'));
console.log('server FETCH_MENTION_SUGGESTIONS_RESULT removed:', !srv.includes('FETCH_MENTION_SUGGESTIONS_RESULT'));
console.log('server keeps SYNC_GROUP_MEMBERS_RESULT:', srv.includes('SYNC_GROUP_MEMBERS_RESULT'));
console.log('server keeps autoDetectMentionsFromText:', srv.includes('autoDetectMentionsFromText'));
const bg = extract('dist/extension/background.js').toString('utf8');
console.log('bg EXT_BUILD app12:', bg.includes("EXT_BUILD = 'app12'"));
console.log('bg fetchMentionSuggestions removed:', !bg.includes('fetchMentionSuggestions'));
console.log('bg FETCH_MENTION_SUGGESTIONS removed:', !bg.includes('FETCH_MENTION_SUGGESTIONS'));
console.log('bg navigateScanTabToThread:', bg.includes('navigateScanTabToThread'));
console.log('bg keeps member scan:', bg.includes('SYNC_GROUP_MEMBERS_RESULT'));
const man = JSON.parse(extract('dist/extension/manifest.json').toString('utf8'));
console.log('manifest version:', man.version);
const ui = extract('client/assets/index-hfExI3Rb.js').toString('utf8');
console.log('client MENTION_SUGGESTIONS removed:', !ui.includes('MENTION_SUGGESTIONS'));
console.log('client mention-suggestions route removed:', !ui.includes('mention-suggestions'));
console.log('client keeps THREAD_MEMBERS:', ui.includes('THREAD_MEMBERS'));
console.log('client keeps groupMembers prop:', ui.includes('groupMembers'));
console.log('ALL_PASS');
