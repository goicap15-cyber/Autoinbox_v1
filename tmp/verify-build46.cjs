// Verify build46 asar chua 3 fix tab (C sticky + B transient + A startup).
const path = require('path');
const fs = require('fs');
const asar = require(path.join('C:/Users/Admin/Downloads/Duan/CRM_FB1/node_modules/@electron/asar'));
const asarPath = 'C:/Users/Admin/Downloads/Duan/CRM_FB1/release/win-unpacked/resources/app.asar';

const PROBES = [
  ['dist/extension/background.js', [
    'operator_click_sticky',
    'navigation_locked_by_user_selection',
    'tryIncomingTakeover',
    'closeLeftoverTransientTabs',
    "ensureRoleMessengerTab(user_id, 'history')"
  ]],
  ['dist/extension/tabAudit.js', [
    'isTransientTab',
    '/\\/messages\\/requests(?:\\/|$|\\?)/i'
  ]],
  ['dist/server/services/ProcessManager.js', [
    'ensureMessagesTabOnRunningProfile',
    '/json/new?https://www.facebook.com/messages/',
    'DevToolsActivePort',
    'await Promise.race([messagesLoad, new Promise((resolve) => setTimeout(resolve, 8000))])'
  ]],
  // build45 markers phai van con (khong bi mat khi rebase/merge)
  ['dist/extension/background.js', ['SYNC_LANE_TAKEOVER', 'incoming_grace_15s']],
  ['dist/server/server.js', ['PREVIEW_BUMP_REPEAT', 'rowTimePrevSeen', 'isUnreadNow || !lastMsgMatches']],
  ['dist/server/utils/sidebarIncomingDetection.js', ['rowFreshNew === true', 'const samePreview']]
];

let bad = 0;
for (const [file, markers] of PROBES) {
  let content;
  try {
    content = asar.extractFile(asarPath, file.split('/').join(path.sep)).toString('utf8');
  } catch (e) {
    console.error('EXTRACT FAIL ' + file + ': ' + e.message);
    bad += 1;
    continue;
  }
  for (const m of markers) {
    const ok = content.includes(m);
    if (!ok) bad += 1;
    console.log((ok ? 'PASS' : 'FAIL') + ' ' + file + ' :: ' + m);
  }
}
const stat = fs.statSync(asarPath);
console.log('asar mtime:', stat.mtime.toISOString(), 'size:', stat.size);
process.exit(bad ? 1 : 0);
