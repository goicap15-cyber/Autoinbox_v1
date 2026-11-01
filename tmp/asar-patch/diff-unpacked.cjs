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
  return out.map((p) => p.split(B).join('/')).sort();
}

const oldAsar = 'C:/Users/Admin/Downloads/Duan/CRM_FB1/release/win-unpacked/resources/app.asar';
const newAsar = 'C:/Users/Admin/Downloads/Duan/CRM_FB1/tmp/asar-patch/out2/app.asar';
const oldSet = new Set(listUnpackedFiles(oldAsar));
const newSet = new Set(listUnpackedFiles(newAsar));
const nowEmbedded = [...oldSet].filter((p) => !newSet.has(p));
console.log('now embedded count:', nowEmbedded.length);
const natives = nowEmbedded.filter((p) => /\.(node|dll|exe)$/i.test(p));
console.log('native among them:', natives.length ? natives : 'none');
const byTop = {};
for (const p of nowEmbedded) {
  const parts = p.split('/');
  const key = parts.length <= 3 ? parts.slice(0, 2).join('/') : parts.slice(0, 3).join('/');
  byTop[key] = (byTop[key] || 0) + 1;
}
console.log(JSON.stringify(byTop, null, 1));
