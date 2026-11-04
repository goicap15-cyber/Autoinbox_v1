// Verify build 59: bg strip __bubble suffix + WS squat fix + markers cũ
const path = require('path');
const fs = require('fs');
const asar = require('@electron/asar');
const B = path.sep;
const base = 'release/win-unpacked/resources/app.asar';
const rd = (p) => asar.extractFile(base, p.split('/').join(B)).toString('utf8');

const server = rd('dist/server/server.js');
const background = rd('dist/extension/background.js');
const content = rd('dist/extension/content.js');
const repo = rd('dist/server/repositories/ConversationRepository.js');

const checks = [
  ['bg: strip __bubble suffix trước khi test real-mid', /const echoFamilyMid = echoMid\.replace\(\/__bubble_\\d\+\$\/, ''\);/.test(background)],
  ['bg: echoHasRealMid dùng family', /const echoHasRealMid = Boolean\(echoFamilyMid\)/.test(background)],
  ['bg: prefix test trên family', /&& !\/\^\(\?:dom_\|pending_\|history_\)\/\.test\(echoFamilyMid\)/.test(background)],
  ['server: squat fix điều kiện changes===0 + __bubble id', /if \(insertMsgResult\.changes === 0 && \/__bubble_\\d\+\$\/\.test\(String\(stableMessageId\)\)\)/.test(server)],
  ['server: squat window 900s', /AND datetime\(created_at\) >= datetime\('now', '-900 seconds'\)/.test(server)],
  ['server: squat chỉ flip IN->OUT confirmed', /Number\(squatterRow\.is_outgoing\) === 0\s*\n\s*&& isOutgoing && directionStatus === 'confirmed'/.test(server)],
  ['server: marker WS_FIX_FLIPPED_SQUATTER', server.includes("syncDebug('WS_FIX_FLIPPED_SQUATTER'")],
  ['server: emit THREAD_MESSAGES_UPDATED trong squat fix', /WS_FIX_FLIPPED_SQUATTER[\s\S]{0,400}THREAD_MESSAGES_UPDATED/.test(server)],
  ['b58: sweep WS + repo giữ nguyên', server.includes('WS_HEAL_FLIPPED_BUBBLE_SIBLING') && repo.includes('collapseFlippedBubbleSiblings')],
  ['b56: otid guard giữ nguyên', server.includes("syncDebug('WS_SKIP_OTID_FLIPPED'")],
  ['b55: anti-ghost khớp mid giữ nguyên', /const obsEchoHasRealMid = m\.source === 'dom_observer' && obsEchoMid/.test(server)],
  ['b54: guard family giữ nguyên', server.includes("syncDebug('WS_SKIP_BUBBLE_FAMILY_PHANTOM'")],
  ['b57: occlusion giữ nguyên (Chrome launch)', /'--disable-features=IntensiveWakeUpThrottling'/.test(rd('dist/server/services/ProcessManager.js'))],
];
let fail = 0;
for (const [name, ok] of checks) { console.log(ok ? 'PASS' : 'FAIL', name); if (!ok) fail++; }
console.log(fail === 0 ? 'ALL_OK (13/13)' : `FAILED ${fail}/${checks.length}`);
process.exit(fail === 0 ? 0 : 1);
