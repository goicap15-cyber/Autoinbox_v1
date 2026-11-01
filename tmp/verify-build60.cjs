// Verify build 60: sweeper giữ row + grace, echo-merge set sent, late dispatch upgrade,
// tail reconcile nhận OUT text có mid., marker relay bg + server.
const path = require('path');
const asar = require('@electron/asar');
const B = path.sep;
const base = 'release/win-unpacked/resources/app.asar';
const rd = (p) => asar.extractFile(base, p.split('/').join(B)).toString('utf8');

const server = rd('dist/server/server.js');
const background = rd('dist/extension/background.js');
const content = rd('dist/extension/content.js');
const repo = rd('dist/server/repositories/ConversationRepository.js');

const checks = [
  // b60 sweeper 3 nhánh + grace
  ['server: marker OUT_ACK_TIMEOUT_KEPT', server.includes("syncDebug('OUT_ACK_TIMEOUT_KEPT'")],
  ['server: marker OUT_ACK_TIMEOUT_DEDUPED', server.includes("syncDebug('OUT_ACK_TIMEOUT_DEDUPED'")],
  ['server: grace nhận cả row failed', /WHERE id = \? AND delivery_status IN \('pending', 'failed'\)/.test(server)],
  ['server: sweeper bắn SYNC_THREAD_MESSAGES crawl', /reason: 'history_retry'[\s\S]{0,200}allow_navigation: true/.test(server)],
  ['server: pending content-match nhận failed + pending_%', /outbound\.delivery_status IN \('pending', 'failed'\)/.test(server) && /outbound\.fb_message_id LIKE 'pending_%'/.test(server)],
  ['server: late dispatch upgrade failed->sent', server.includes("syncDebug('OUT_LATE_DISPATCH_UPGRADED'")],
  ['server: echo-merge set sent + OUT_ECHO_MERGED', /delivery_status = 'sent', delivery_error = NULL[\s\S]{0,400}syncDebug\('OUT_ECHO_MERGED'/.test(server)],
  ['server: OUT_KNOWN_CONFIRMED_SKIP marker', server.includes("syncDebug('OUT_KNOWN_CONFIRMED_SKIP'")],
  ['server: OUT_DISPATCH_CONFIRMED marker', server.includes("syncDebug('OUT_DISPATCH_CONFIRMED'")],
  ['server: OUT_RESULT marker', server.includes("syncDebug('OUT_RESULT'")],
  // b60 content.js tail reconcile
  ['content: gate OUT text cần mid.', /const hasDurableMidId = \/\^mid\\\.\//.test(content) && content.includes('!hasDurableMidId) continue')],
  // b60 bg relay
  ['bg: SEND_TRACE relay', background.includes("stage: 'SEND_TRACE'")],
  ['bg: BG_SKIP_ROLE relay', background.includes("stage: 'BG_SKIP_ROLE'")],
  // hồi quy các fix trước
  ['b59: strip __bubble suffix giữ nguyên', /const echoFamilyMid = echoMid\.replace\(\/__bubble_\\d\+\$\/, ''\)/.test(background)],
  ['b58: sweep WS + repo giữ nguyên', server.includes('WS_HEAL_FLIPPED_BUBBLE_SIBLING') && repo.includes('collapseFlippedBubbleSiblings')],
  ['b54: guard family giữ nguyên', server.includes("syncDebug('WS_SKIP_BUBBLE_FAMILY_PHANTOM'")],
];
let fail = 0;
for (const [name, ok] of checks) { console.log(ok ? 'PASS' : 'FAIL', name); if (!ok) fail++; }
console.log(fail === 0 ? `ALL_OK (${checks.length}/${checks.length})` : `FAILED ${fail}/${checks.length}`);
process.exit(fail === 0 ? 0 : 1);
