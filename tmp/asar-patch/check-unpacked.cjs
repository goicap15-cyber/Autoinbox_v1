const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');

const B = path.sep;
function listUnpackedFiles(asarPath) {
  const header = asar.getRawHeader(asarPath).header;
  const out = [];
  (function walk(node, prefix) {
    if (!node.files) return;
    for (const [name, child] of Object.entries(node.files)) {
      const p = prefix ? prefix + B + name : name;
      if (child.unpacked && !child.files) out.push(p);
      if (child.files) walk(child, p);
    }
  })(header, '');
  return out.sort();
}

function listFiles(root) {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(path.relative(root, p));
    }
  })(root);
  return out.sort();
}

const oldAsar = 'C:/Users/Admin/Downloads/Duan/CRM_FB1/release/win-unpacked/resources/app.asar';
const newAsar = 'C:/Users/Admin/Downloads/Duan/CRM_FB1/tmp/asar-patch/out2/app.asar';

const pairs = [
  ['OLD', oldAsar, oldAsar + '.unpacked'],
  ['NEW', newAsar, newAsar + '.unpacked'],
];

for (const [label, asarPath, unpackedDir] of pairs) {
  const headerUnpacked = listUnpackedFiles(asarPath).map((p) => p.split(B).join('/'));
  const diskFiles = listFiles(unpackedDir).map((p) => p.split(B).join('/'));
  const missingOnDisk = headerUnpacked.filter((p) => !diskFiles.includes(p));
  const notInHeader = diskFiles.filter((p) => !headerUnpacked.includes(p));
  console.log(`=== ${label}: header unpacked files=${headerUnpacked.length} disk=${diskFiles.length}`);
  console.log('  missing on disk:', missingOnDisk.length ? missingOnDisk : 'none');
  console.log('  on disk but not in header:', notInHeader.length ? notInHeader : 'none');
}
