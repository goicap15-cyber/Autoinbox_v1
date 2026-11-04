// Verify build 58: sweep flipped bubble sibling sau insert (WS + repo)
const asar = require('@electron/asar');
const path = require('path');
const B = path.sep;
const base = path.join(__dirname, '..', 'release', 'win-unpacked', 'resources', 'app.asar');

const extract = (parts) => asar.extractFile(base, parts.join(B)).toString('utf8');
let serverJs, repoJs;
const tryPaths = [
  { s: ['dist', 'server', 'server.js'], r: ['dist', 'server', 'repositories', 'ConversationRepository.js'] },
  { s: ['src', 'server', 'server.js'], r: ['src', 'server', 'repositories', 'ConversationRepository.js'] },
];
for (const p of tryPaths) {
  try { serverJs = extract(p.s); repoJs = extract(p.r); console.log('asar paths:', p.s.join('/')); break; } catch (_) {}
}
if (!serverJs || !repoJs) { console.log('FAIL: khong doc duoc file trong asar'); process.exit(1); }

const checks = [
  // --- build 58: sweep flip-truoc-base ---
  ['server.js: sweep sau insert WS', serverJs.includes('ConversationRepository.collapseFlippedBubbleSiblings(m.thread_id, stableMessageId, m.content, db)')],
  ['server.js: log heal marker', serverJs.includes("syncDebug('WS_HEAL_FLIPPED_BUBBLE_SIBLING'")],
  ['repo.js: helper collapseFlippedBubbleSiblings', repoJs.includes('static collapseFlippedBubbleSiblings(threadId, insertedMessageId, content, database')],
  ['repo.js: sweep trong saveMessagesTransaction', repoJs.includes('ConversationRepository.collapseFlippedBubbleSiblings(threadId, stableId, content, database)')],
  // --- build 57: perf + occlusion ---
  ['server.js: pre-gate pure hint (b57)', serverJs.includes('isPureRealtimeHint')],
  ['server.js: log rotation (b57)', serverJs.includes('appendComposerDebugLog')],
  ['PM: bo CalculateNativeWinOcclusion (b57)', !extract(['dist', 'server', 'services', 'ProcessManager.js']).includes('CalculateNativeWinOcclusion')],
  // --- build 56/55 nguyen ven ---
  ['server.js: WS skip otid flipped (b56)', serverJs.includes("syncDebug('WS_SKIP_OTID_FLIPPED'")],
  ['server.js: heal 2c-ter (b56)', serverJs.includes('(2c-ter) Otid thuần số')],
  ['content.js: plain outgoing gate (b55)', extract(['dist', 'extension', 'content.js']).includes('if (isPlainOutgoingDomText && !parsed.native_id) return;')],
];

let ok = true;
for (const [name, pass] of checks) {
  console.log(pass ? 'OK  ' : 'FAIL', name);
  if (!pass) ok = false;
}
process.exit(ok ? 0 : 1);
