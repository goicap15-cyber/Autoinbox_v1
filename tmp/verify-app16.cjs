const path = require('path');
const fs = require('fs');
const asar = require(path.resolve(process.cwd(), 'node_modules', '@electron', 'asar'));
const p = path.resolve(process.cwd(), 'tmp', 'asar-patch17', 'out-app16.asar');
const idx = fs.readFileSync(p);
const dataStart = 8 + idx.readUInt32LE(4);
const header = asar.getRawHeader(p).header;

const files = [];
(function w(n, pre) {
  for (const [k, c] of Object.entries(n.files || {})) {
    if (c.files) w(c, pre + k + '/');
    else files.push({ f: pre + k, n: c });
  }
})(header, '');

const want = [
  'dist/extension/background.js',
  'dist/extension/manifest.json',
  'dist/server/server.js',
  'server/server.js',
  'dist/client'
];
for (const w2 of want.slice(0, 4)) {
  const hit = files.find((x) => x.f === w2);
  if (!hit) { console.log('MISSING: ' + w2); process.exit(1); }
  const buf = idx.subarray(dataStart + Number(hit.n.offset), dataStart + Number(hit.n.offset) + Number(hit.n.size));
  const text = buf.toString('utf8');
  if (w2.endsWith('background.js')) {
    console.log(w2, 'size=' + hit.n.size, 'app16=' + text.includes("EXT_BUILD = 'app16'"), 'e2ee_fallback=' + text.includes('navigate_e2ee_fallback'), 'scan_queued=' + text.includes('scan_queued'));
  } else if (w2.endsWith('manifest.json')) {
    console.log(w2, 'version=' + (JSON.parse(text).version));
  } else {
    console.log(w2, 'size=' + hit.n.size, 'thread_url=' + text.includes("thread_url: String(thread.thread_url || '')"));
  }
}
const clientDir = files.filter((x) => x.f.startsWith('dist/client/'));
console.log('dist/client files:', clientDir.length);
const clientIdx = files.find((x) => x.f.startsWith('dist/client/index-'));
console.log('client bundle:', clientIdx ? clientIdx.f : 'MISSING');
console.log('total files:', files.length);
