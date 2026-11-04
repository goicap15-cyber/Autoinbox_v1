// Verify build 56: guard otid flipped (WS + repo) + heal 2c-ter + markers build truoc
const asar = require('@electron/asar');
const path = require('path');
const B = path.sep;
const base = path.join(__dirname, '..', 'release', 'win-unpacked', 'resources', 'app.asar');

const extract = (parts) => asar.extractFile(base, parts.join(B)).toString('utf8');

let serverJs, repoJs, contentJs, dedupJs;
const tryPaths = [
  { s: ['dist', 'server', 'server.js'], r: ['dist', 'server', 'repositories', 'ConversationRepository.js'], c: ['dist', 'extension', 'content.js'], d: ['dist', 'extension', 'domMessageDedup.js'] },
  { s: ['src', 'server', 'server.js'], r: ['src', 'server', 'repositories', 'ConversationRepository.js'], c: ['src', 'extension', 'content.js'], d: ['src', 'extension', 'domMessageDedup.js'] },
];
for (const p of tryPaths) {
  try {
    serverJs = extract(p.s);
    repoJs = extract(p.r);
    contentJs = extract(p.c);
    dedupJs = extract(p.d);
    console.log('asar paths:', p.s.join('/'));
    break;
  } catch (_) {}
}
if (!serverJs || !repoJs) { console.log('FAIL: khong tim duoc file trong asar'); process.exit(1); }

const checks = [
  // --- build 56: otid flipped guard ---
  ['server.js: WS skip otid flipped log', serverJs.includes("syncDebug('WS_SKIP_OTID_FLIPPED'")],
  ['server.js: otid family strip', serverJs.includes('const otidFamilyId = String(stableMessageId).replace(/__bubble_')],
  ['server.js: otid guard condition', serverJs.includes('if (!isOutgoing && /^\\d{15,19}$/.test(otidFamilyId)')],
  ['server.js: heal 2c-ter marker', serverJs.includes('(2c-ter) Otid thuần số')],
  ['server.js: heal 2c-ter condition', serverJs.includes('if (Number(m.is_outgoing) === 0 && /^\\d{15,19}$/.test(familyId))')],
  ['repo.js: otid guard', repoJs.includes('if (!isOutgoing && /^[0-9]{15,19}(?:__bubble_\\d+)?$/.test(String(stableId))')],
  // --- build 55: 3 gates Messenger-typed ---
  ['content.js: plain outgoing gate', contentJs.includes('if (isPlainOutgoingDomText && !parsed.native_id) return;')],
  ['content.js: echo exemption', contentJs.includes('labelProvesIncoming')],
  ['content.js: tracker fn', contentJs.includes('function createBubbleFamilyTracker()')],
  // --- build 54: phantom family guard ---
  ['server.js: WS skip bubble family', serverJs.includes("syncDebug('WS_SKIP_BUBBLE_FAMILY_PHANTOM'")],
  ['server.js: heal 2c-bis', serverJs.includes('const familyBaseStmt = db.prepare(')],
  // --- build 53: mirror cross-account ---
  ['server.js: WS mirror cross-account', serverJs.includes('WS_MIRROR_CROSS_ACCOUNT') && serverJs.includes('mirrorMessageId')],
  ['repo.js: mirror per-thread', repoJs.includes('::${threadId}')],
  // --- cu: unread pin + page lane ---
  ['server.js: unread pin -1', serverJs.includes('unread_manual = -1')],
  ['server.js: page lane newer incoming', serverJs.includes('hasNewerIncomingPage')],
];

let ok = true;
for (const [name, pass] of checks) {
  console.log(pass ? 'OK  ' : 'FAIL', name);
  if (!pass) ok = false;
}
process.exit(ok ? 0 : 1);
