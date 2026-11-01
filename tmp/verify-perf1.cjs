// Verify build perf-fix 1: hint spam gate + log rotation + pause-anim
const asar = require('@electron/asar');
const path = require('path');
const B = path.sep;
const base = path.join(__dirname, '..', 'release', 'win-unpacked', 'resources', 'app.asar');

const extract = (parts) => asar.extractFile(base, parts.join(B)).toString('utf8');

let serverJs, contentJs, bgJs, obsJs, pcJs;
const tryPaths = [
  { d: 'dist' },
  { d: 'src' },
];
for (const p of tryPaths) {
  try {
    serverJs = extract([p.d, 'server', 'server.js']);
    contentJs = extract([p.d, 'extension', 'content.js']);
    bgJs = extract([p.d, 'extension', 'background.js']);
    obsJs = extract([p.d, 'extension', 'sidebarActivityObserver.js']);
    pcJs = extract([p.d, 'extension', 'page_content.js']);
    console.log('asar paths:', p.d);
    break;
  } catch (_) {}
}
if (!serverJs || !bgJs || !obsJs || !pcJs || !contentJs) { console.log('FAIL: khong tim duoc file trong asar'); process.exit(1); }

const checks = [
  // --- build nay: perf fix ---
  ['server.js: log helper + rotation', serverJs.includes('appendComposerDebugLog') && serverJs.includes('30 * 1024 * 1024')],
  ['server.js: 4 writer dung helper', (serverJs.match(/appendComposerDebugLog\(/g) || []).length >= 5],
  ['server.js: pre-gate pure hint', serverJs.includes('isPureRealtimeHint') && serverJs.includes("syncDebug('REALTIME_HINT_UNCHANGED'")],
  ['server.js: hint sig map', serverJs.includes('lastRealtimeHintSig')],
  ['bg.js: relay dedupe account', bgJs.includes('lastHintRelaySig') && bgJs.includes("Date.now() - prevRelay.at < 8000")],
  ['observer.js: fp ben (fpPreview)', obsJs.includes('fpPreview') && obsJs.includes('đang soạn')],
  ['observer.js: tran gui 1.2s', obsJs.includes('1200 - (now - lastEmitAt)')],
  ['observer.js: ngat khi context chet', obsJs.includes('Extension context invalidated')],
  ['content.js: pause anim hidden', contentJs.includes('installHiddenTabAnimationPause') && contentJs.includes('data-crm-hidden')],
  ['page_content.js: pause anim hidden', pcJs.includes('installHiddenTabAnimationPause') && pcJs.includes('data-crm-hidden')],
  // --- build 56 giu nguyen ---
  ['server.js: WS skip otid flipped (b56)', serverJs.includes("syncDebug('WS_SKIP_OTID_FLIPPED'")],
  ['server.js: heal 2c-ter (b56)', serverJs.includes('(2c-ter) Otid thuần số')],
  ['content.js: plain outgoing gate (b55)', contentJs.includes('if (isPlainOutgoingDomText && !parsed.native_id) return;')],
  ['bg.js: SYNC_JOB log (b38+)', bgJs.includes("stage: 'SYNC_JOB'")],
];

let ok = true;
for (const [name, pass] of checks) {
  console.log(pass ? 'OK  ' : 'FAIL', name);
  if (!pass) ok = false;
}
process.exit(ok ? 0 : 1);
