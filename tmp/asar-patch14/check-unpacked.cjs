const p = require('path');
const asar = require('@electron/asar');
const asarPath = p.join(__dirname, 'out-app.asar');
const header = asar.getRawHeader(asarPath).header;
const segs = ['node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'];
let node = header;
for (const s of segs) { node = node && node.files && node.files[s]; }
if (!node) { console.log('RESULT: FAIL — entry missing in header'); process.exit(1); }
console.log('unpacked flag:', node.unpacked === true ? 'UNPACKED (đúng)' : 'IN_ARCHIVE (sai)');
console.log('size:', node.size);
process.exit(node.unpacked === true ? 0 : 1);
