const path = require('path');
const fs = require('fs');
const asar = require(path.resolve(process.cwd(), 'node_modules', '@electron', 'asar'));
const p = path.resolve(__dirname, 'out-app8.asar');
const idx = fs.readFileSync(p);
const dataStart = 8 + idx.readUInt32LE(4);
const h = asar.getRawHeader(p).header;
const files = [];
console.log('dist keys:', Object.keys((h.files||{}).dist?.files || {}));
(function w(n, pre) {
  for (const [k, c] of Object.entries(n.files || {})) {
    if (c.files) w(c, pre + k + '/');
    else files.push({ f: pre + k, n: c });
  }
})(h, '');
console.log('total files:', files.length, JSON.stringify(files.slice(0,5)));
const dbFiles = files.filter((x) => x.f.includes('db.js'));
console.log('db.js files:', dbFiles.map((x) => x.f).join(', ') || '(none)');
for (const rel of ['dist/server/database/db.js', 'server/database/db.js']) {
  const e = files.find((x) => x.f === rel);
  if (!e) { console.log(rel, 'MISSING'); continue; }
  const buf = idx.slice(dataStart + Number(e.n.offset), dataStart + Number(e.n.offset) + e.n.size);
  console.log(rel, 'has 20261015004:', buf.toString('utf8').includes('20261015004'));
}
