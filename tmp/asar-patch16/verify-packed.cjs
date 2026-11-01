// Verify packed asar for patch16: needles + better_sqlite3 unpacked + live layers.
const asar = require('@electron/asar');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const asarPath = path.join(__dirname, 'out-app.asar');

function walk(dir, base = '') {
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out = out.concat(walk(path.join(dir, e.name), rel));
    else out.push(rel);
  }
  return out;
}

const header = asar.getRawHeader(asarPath).header;
function nodeFor(rel) {
  let node = header;
  for (const s of rel.split('/')) node = node && node.files && node.files[s];
  return node;
}

const native = nodeFor('node_modules/better-sqlite3/build/Release/better_sqlite3.node');
console.log('better_sqlite3.node:', native && native.unpacked === true ? 'UNPACKED (OK)' : 'IN_ARCHIVE (FAIL)');

const bundleFiles = walk(path.join(ROOT, 'dist', 'client')).filter((f) => /^assets\/index-.*\.js$/.test(f));
const bundleName = bundleFiles.sort().pop();
console.log('dist bundle:', bundleName);

const needles = [
  ['server WS_SKIP_BUBBLE_INDEX_DRIFT_GHOST', 'WS_SKIP_BUBBLE_INDEX_DRIFT_GHOST'],
  ['server same-minute bump comment', "Chỉ đẩy khi tin nằm CÙNG PHÚT với ts mới nhất"],
  ['server drift guard SQL', "OR fb_message_id LIKE ? ESCAPE"],
];
let fail = false;
for (const [label, needle] of needles) {
  const p = path.join(ROOT, 'dist', 'server', 'server.js');
  const src = fs.readFileSync(p, 'utf8');
  const ok = src.includes(needle);
  console.log(`dist/server ${label}:`, ok ? 'OK' : 'MISSING');
  if (!ok) fail = true;
}
const treeServer = fs.readFileSync(path.join(__dirname, 'tree', 'dist', 'server', 'server.js'), 'utf8');
for (const [label, needle] of needles) {
  const ok = treeServer.includes(needle);
  console.log(`tree/dist/server ${label}:`, ok ? 'OK' : 'MISSING');
  if (!ok) fail = true;
}
const treeServerRoot = fs.readFileSync(path.join(__dirname, 'tree', 'server', 'server.js'), 'utf8');
console.log('tree/server (root layer) needles:', needles.every(([, n]) => treeServerRoot.includes(n)) ? 'OK' : 'MISSING');

const liveAsar = path.join(ROOT, 'release', 'win-unpacked', 'resources', 'app.asar');
if (fs.existsSync(liveAsar)) {
  const liveHeader = asar.getRawHeader(liveAsar).header;
  const liveNative = (() => { let n = liveHeader; for (const s of 'node_modules/better-sqlite3/build/Release/better_sqlite3.node'.split('/')) n = n && n.files && n.files[s]; return n; })();
  console.log('LIVE asar better_sqlite3:', liveNative && liveNative.unpacked === true ? 'UNPACKED (OK)' : 'IN_ARCHIVE');
}

console.log(fail ? 'VERIFY FAILED' : 'VERIFY PASS');
process.exit(fail ? 1 : 0);
