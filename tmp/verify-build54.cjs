// Verify build 54: guard phantom __bubble lat chieu (WS + repo) + heal 2c-bis
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
if (!serverJs || !repoJs) { console.log('FAIL: khong tim duoc file trong asar'); process.exit(1); }

const checks = [
  // --- build 54: phantom family guard ---
  ['server.js: WS skip phantom log', serverJs.includes("syncDebug('WS_SKIP_BUBBLE_FAMILY_PHANTOM'")],
  ['server.js: WS suffix check', /__bubble_\\d\+\$\/\.test\(String\(stableMessageId\)\)/.test(serverJs)],
  ['server.js: WS flipped condition', serverJs.includes('Number(bubbleBaseRow.is_outgoing) !== (isOutgoing ? 1 : 0)')],
  ['server.js: WS far-anchor 60s', serverJs.includes('Number(bubbleBaseRow.timestamp_ms || 0)) > 60000')],
  ['server.js: heal 2c-bis family base', serverJs.includes('const familyBaseStmt = db.prepare(')],
  ['server.js: heal 2c-bis flipped delete', serverJs.includes('Number(familyBase.is_outgoing) !== Number(m.is_outgoing)')],
  ['repo.js: far-anchor outgoing skip', repoJs.includes('outgoingBubbleFamilyId')],
  ['repo.js: mirror per-thread (build 53)', repoJs.includes('::${threadId}')],
  // --- build 53: mirror cross-account ---
  ['server.js: WS mirror cross-account', serverJs.includes('WS_MIRROR_CROSS_ACCOUNT') && serverJs.includes('mirrorMessageId')],
  // --- build 52: reread + echo exemption ---
  ['content.js: reread anchor', contentJs.includes('const rereadScope = parsed.dom_anchor || node;')],
  ['content.js: echo exemption incoming label', contentJs.includes('labelProvesIncoming')],
  ['content.js: tracker fn', contentJs.includes('function createBubbleFamilyTracker()')],
  // --- build 51 + truoc ---
  ['server.js: heal 2c phantom cu', serverJs.includes('deletePhantomBubble') && serverJs.includes('Phantom __bubble_N')],
  ['server.js: unread pin -1', serverJs.includes('unread_manual = -1')],
  ['server.js: page lane newer incoming', serverJs.includes('hasNewerIncomingPage')],
];

let ok = true;
for (const [name, pass] of checks) {
  console.log(pass ? 'OK  ' : 'FAIL', name);
  if (!pass) ok = false;
}
process.exit(ok ? 0 : 1);
