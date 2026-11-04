// Verify build 55: bo gate nuot tin outgoing nhann tay Messenger (3 cua)
const asar = require('@electron/asar');
const path = require('path');
const B = path.sep;
const base = path.join(__dirname, '..', 'release', 'win-unpacked', 'resources', 'app.asar');

const extract = (parts) => asar.extractFile(base, parts.join(B)).toString('utf8');

let contentJs, bgJs, serverJs;
const tryPaths = [
  { c: ['dist', 'extension', 'content.js'], b: ['dist', 'extension', 'background.js'], s: ['dist', 'server', 'server.js'] },
  { c: ['src', 'extension', 'content.js'], b: ['src', 'extension', 'background.js'], s: ['src', 'server', 'server.js'] },
];
for (const p of tryPaths) {
  try {
    contentJs = extract(p.c);
    bgJs = extract(p.b);
    serverJs = extract(p.s);
    console.log('asar paths:', p.s.join('/'));
    break;
  } catch (_) {}
}
if (!contentJs || !bgJs || !serverJs) { console.log('FAIL: khong tim duoc file trong asar'); process.exit(1); }

const checks = [
  // --- build 55: mo 3 gate cho tin outgoing nhann tay co mid that ---
  ['content.js: gate giu lai cho chua co native id', contentJs.includes('if (isPlainOutgoingDomText && !parsed.native_id) return;')],
  ['background.js: echoHasRealMid', bgJs.includes('const echoHasRealMid = Boolean(echoMid)')],
  ['background.js: echo co mid that di tiep', /&& !echoHasRealMid\s*\)/.test(bgJs)],
  ['server.js: anti-ghost khop theo mid cho dom_observer', serverJs.includes("const obsEchoHasRealMid = m.source === 'dom_observer' && obsEchoMid")],
  ['server.js: identity query anti-ghost', serverJs.includes('AND is_outgoing = 1 AND fb_message_id = ?')],
  ['server.js: nhanh khop noi dung 300s con nguyen', serverJs.includes("datetime('now', '-300 seconds')")],
  // --- build 54: guard phantom (phai con nguyen) ---
  ['server.js: WS skip phantom log', serverJs.includes("syncDebug('WS_SKIP_BUBBLE_FAMILY_PHANTOM'")],
  ['server.js: heal 2c-bis family base', serverJs.includes('const familyBaseStmt = db.prepare(')],
  ['repo-side build 54 via server inlined? far-anchor check in WS', serverJs.includes('Number(bubbleBaseRow.timestamp_ms || 0)) > 60000')],
  // --- build 53/52: mirror + reread ---
  ['server.js: WS mirror cross-account', serverJs.includes('WS_MIRROR_CROSS_ACCOUNT')],
  ['content.js: reread anchor', contentJs.includes('const rereadScope = parsed.dom_anchor || node;')],
];

let ok = true;
for (const [name, pass] of checks) {
  console.log(pass ? 'OK  ' : 'FAIL', name);
  if (!pass) ok = false;
}
process.exit(ok ? 0 : 1);
