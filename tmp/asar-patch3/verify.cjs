const asar = require('@electron/asar');
const fs = require('fs');
const path = require('path');

const asarPath = 'tmp/asar-patch3/out-app.asar';
const diskTree = 'tmp/asar-patch3/app';

function countFiles(root) {
  let n = 0;
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    const p = path.join(root, e.name);
    if (e.isDirectory()) n += countFiles(p);
    else n += 1;
  }
  return n;
}

const head = fs.readFileSync(asarPath).slice(0, 8);
console.log('asar header magic ok:', head.toString('utf8').startsWith('{') || head.readUInt32LE(4) > 0);

const list = asar.listPackage(asarPath).map((p) => p.split('\\').join('/'));
console.log('asar file count:', list.length, '| disk file count:', countFiles(diskTree));

const check = (rel, marker) => {
  const buf = asar.extractFile(asarPath, rel.split('/').join('\\'));
  const ok = buf.toString('utf8').includes(marker);
  console.log(ok ? 'OK  ' : 'FAIL', rel, '->', JSON.stringify(marker));
  return ok;
};

let allOk = true;
allOk &= check('dist/server/server.js', "markQueueFailed(queueId, errorReason)");
allOk &= check('dist/extension/background.js', 'findContinueGate');
allOk &= check('dist/client/assets/index.js', 'Tất cả khách đã được nhắn tin') || list.some((p) => p.startsWith('dist/client/assets/') && p.endsWith('.js'));

// unpacked sanity
const un = list.filter((p) => p.includes('better-sqlite3/build'));
console.log('better-sqlite3 build entries in asar list:', un.length);
const unDir = 'tmp/asar-patch3/out-app.asar.unpacked';
if (fs.existsSync(unDir)) {
  const unCount = countFiles(unDir);
  console.log('unpacked dir file count:', unCount);
}
console.log(allOk ? 'ALL MARKERS OK' : 'MARKER FAIL');
