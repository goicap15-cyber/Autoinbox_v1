// Verify out-app.asar: file count, header consistency, new-client + server-patch markers.
const asar = require('@electron/asar');
const fs = require('fs');
const path = require('path');

const ASAR = path.join(__dirname, 'out-app.asar');
const SRC = path.join(__dirname, 'app');
const B = '\\';

function fail(m) { console.log('FAIL', m); process.exitCode = 1; }
function check(m, ok) { console.log(ok ? 'ok' : 'FAIL', m); if (!ok) process.exitCode = 1; }
function get(p) {
  return asar.extractFile(ASAR, p.split('/').join(B)).toString('utf8');
}

const header = asar.getRawHeader(ASAR);
const files = [];
const unpacked = [];
(function walk(node, prefix) {
  if (node.files) {
    for (const [name, child] of Object.entries(node.files)) {
      walk(child, prefix + '/' + name, child.unpacked === true);
    }
    return;
  }
  if (node.size !== undefined) {
    files.push(prefix);
    if (node.unpacked) unpacked.push(prefix);
  }
})(header.header, '');

const disk = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name).split(path.sep).join('/');
    if (entry.isDirectory()) walk(p); else disk.push(p.slice(SRC.replace(/\\/g, '/').length));
  }
})(SRC);

check(`file count asar=${files.length} disk=${disk.length}`, files.length === disk.length);
const asarSet = new Set(files);
check('every disk file in asar', disk.every((f) => asarSet.has(f)));

const sqliteBuild = files.filter((f) => f.startsWith('/node_modules/better-sqlite3/build'));
check(`better-sqlite3/build header entries=${sqliteBuild.length} all unpacked`, sqliteBuild.length > 0 && sqliteBuild.every((f) => unpacked.includes(f)));

const unpackedDir = path.join(__dirname, 'out-app.asar.unpacked');
let unpackedDisk = 0;
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.isDirectory()) walk(path.join(d, e.name)); else unpackedDisk += 1; } })(unpackedDir);
check(`unpacked on disk=${unpackedDisk} == header unpacked=${unpacked.length}`, unpackedDisk === unpacked.length);
const dotNode = unpacked.filter((f) => f.endsWith('.node'));
check(`.node files unpacked=${dotNode.length} (>=1)`, dotNode.length >= 1);

const newClient = get('dist/client/assets/index-DPa2TdUL.js');
check('client marker "Tất cả khách đã được nhắn tin"', newClient.includes('Tất cả khách đã được nhắn tin'));

const svc = get('dist/server/services/CommentLeadsService.js');
check('server patch debugLog still present', svc.includes('enqueue: vào service'));
check('server patch pin still present', svc.includes('UPDATE threads SET pinned = 1'));

const bg = get('dist/extension/background.js');
check('extension cold-outreach present', bg.includes('PROFILE_COMPOSER_NOT_FOUND'));
