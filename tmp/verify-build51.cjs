// Verify build 51: bubble family tracker + heal 2c trong asar
const asar = require('@electron/asar');
const path = require('path');
const B = path.sep;
const base = path.join(__dirname, '..', 'release', 'win-unpacked', 'resources', 'app.asar');

const extract = (parts) => asar.extractFile(base, parts.join(B)).toString('utf8');

let contentJs, dedupJs, serverJs;
const tryPaths = [
  { c: ['dist', 'extension', 'content.js'], d: ['dist', 'extension', 'domMessageDedup.js'], s: ['dist', 'server', 'server.js'] },
  { c: ['src', 'extension', 'content.js'], d: ['src', 'extension', 'domMessageDedup.js'], s: ['src', 'server', 'server.js'] },
];
for (const p of tryPaths) {
  try {
    contentJs = extract(p.c);
    dedupJs = extract(p.d);
    serverJs = extract(p.s);
    console.log('asar paths:', p.s.join('/'));
    break;
  } catch (_) {}
}
if (!serverJs) { console.log('FAIL: khong tim duoc file trong asar'); process.exit(1); }

const checks = [
  ['content.js: tracker fn', contentJs.includes('function createBubbleFamilyTracker()')],
  ['content.js: tracker instance', contentJs.includes('const bubbleFamilyTracker = createBubbleFamilyTracker()')],
  ['content.js: chatObserver verdict skip', contentJs.includes('if (verdict.duplicate) return;')],
  ['content.js: reconcile verdict skip', contentJs.includes('if (verdict.duplicate) continue;')],
  ['content.js: reread verdict skip', contentJs.includes('if (deferredVerdict && deferredVerdict.duplicate) return;')],
  ['content.js: seedBaseline slot mark', contentJs.includes('bubbleFamilyTracker.resolveBatch(toTrackerItems(thread_id, baselineParsed))')],
  ['content.js: markSeen >= 4 chỗ', (contentJs.match(/bubbleFamilyTracker\.markSeen\(/g) || []).length >= 4],
  ['domMessageDedup.js: mirror tracker', dedupJs.includes('createBubbleFamilyTracker')],
  ['server.js: heal 2c xoá phantom', serverJs.includes('deletePhantomBubble') && serverJs.includes('Phantom __bubble_N')],
  ['server.js: heal 2c protected rule', serverJs.includes('m.id - twin.id <= 4')],
  ['server.js: giữ fix cũ unread pin', serverJs.includes('unread_manual = -1')],
  ['server.js: giữ fix cũ page lane', serverJs.includes('hasNewerIncomingPage')],
];

let ok = true;
for (const [name, pass] of checks) {
  console.log(pass ? 'OK  ' : 'FAIL', name);
  if (!pass) ok = false;
}
process.exit(ok ? 0 : 1);
