// Verify build 52: fix reread timer (anchor) + echo suppression exemption + obsDebug instrumentation
const asar = require('@electron/asar');
const path = require('path');
const B = path.sep;
const base = path.join(__dirname, '..', 'release', 'win-unpacked', 'resources', 'app.asar');

const extract = (parts) => asar.extractFile(base, parts.join(B)).toString('utf8');

let contentJs, dedupJs, serverJs, repoJs;
const tryPaths = [
  { c: ['dist', 'extension', 'content.js'], d: ['dist', 'extension', 'domMessageDedup.js'], s: ['dist', 'server', 'server.js'], r: ['dist', 'server', 'repositories', 'ConversationRepository.js'] },
  { c: ['src', 'extension', 'content.js'], d: ['src', 'extension', 'domMessageDedup.js'], s: ['src', 'server', 'server.js'], r: ['src', 'server', 'repositories', 'ConversationRepository.js'] },
];
for (const p of tryPaths) {
  try {
    contentJs = extract(p.c);
    dedupJs = extract(p.d);
    serverJs = extract(p.s);
    repoJs = extract(p.r);
    console.log('asar paths:', p.s.join('/'));
    break;
  } catch (_) {}
}
if (!serverJs) { console.log('FAIL: khong tim duoc file trong asar'); process.exit(1); }

const checks = [
  ['content.js: reread theo anchor', contentJs.includes('const rereadScope = parsed.dom_anchor || node;')],
  ['content.js: reread khong con parse root', !contentJs.includes('const reread = parseMessagesFromDOMNode(node, true)')],
  ['content.js: label exemption incoming', contentJs.includes('const labelProvesIncoming')],
  ['content.js: echo suppression co exemption', contentJs.includes('!parsed.native_id && !parsed.is_outgoing && !labelProvesIncoming')],
  ['content.js: obsDebug TRACKER_DUPLICATE', contentJs.includes("stage: 'TRACKER_DUPLICATE'")],
  ['content.js: obsDebug ECHO_SUPPRESSED', contentJs.includes("stage: 'ECHO_SUPPRESSED'")],
  ['content.js: obsDebug REREAD_NATIVE_ID', contentJs.includes("stage: deferredVerdict ? 'REREAD_NATIVE_ID' : 'REREAD_SYNTHETIC'")],
  ['content.js: giu tracker build 51', contentJs.includes('function createBubbleFamilyTracker()')],
  ['content.js: giu verdict skip x3 path', (contentJs.match(/if \(verdict\.duplicate\)/g) || []).length === 3],
  ['domMessageDedup.js: mirror tracker', dedupJs.includes('createBubbleFamilyTracker')],
  ['server.js: mirror cross-account insert', serverJs.includes('WS_MIRROR_CROSS_ACCOUNT') && serverJs.includes('mirrorMessageId')],
  ['repo.js: mirror saveMessagesTransaction', repoJs.includes('::${threadId}')],
  ['server.js: giu heal 2c', serverJs.includes('deletePhantomBubble') && serverJs.includes('Phantom __bubble_N')],
  ['server.js: giu fix unread pin', serverJs.includes('unread_manual = -1')],
];

let ok = true;
for (const [name, pass] of checks) {
  console.log(pass ? 'OK  ' : 'FAIL', name);
  if (!pass) ok = false;
}
process.exit(ok ? 0 : 1);
