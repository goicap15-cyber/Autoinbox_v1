// Verify build48 asar: filter notice hoi thoai he thong + gate tab requests.
const path = require('path');
const fs = require('fs');
const asar = require(path.join('C:/Users/Admin/Downloads/Duan/CRM_FB1/node_modules/@electron/asar'));
const asarPath = 'C:/Users/Admin/Downloads/Duan/CRM_FB1/release/win-unpacked/resources/app.asar';

const PROBES = [
  // [file, [markers phai CO], [markers phai KHONG co]]
  ['dist/extension/sidebarActivityObserver.js',
    ['detectRowUnread', 'borderTopLeftRadius', 'tin nhắn mới|new message', 'const unread = detectRowUnread(row)'],
    []],
  ['dist/extension/background.js',
    // build47 markers
    ['personal_history_tab_idle', 'pageOnlyReasons', 'hasUnreadDot = rowContainer.querySelector', 'bgAlpha', 'borderTopLeftRadius',
     'operator_click_sticky', 'closeLeftoverTransientTabs', "ensureRoleMessengerTab(user_id, 'history')",
     // build48 markers
     'operatorRequestsReasons', 'manual_window_inbox', 'manual_window_requests',
     'requestedScan = { account_id, resume, scan_mode, time_budget_ms, reason }'],
    ['SYNC_LANE_TAKEOVER', 'incoming_grace_15s', 'tryIncomingTakeover']],
  ['dist/server/server.js',
    ['if (changed.page_id) {', 'changed.unread_flipped', 'PREVIEW_BUMP_REPEAT', 'rowTimePrevSeen', 'row_fresh_new: rowFreshNew',
     // build48 markers
     'isSystemConversationNotice(rawSidebarPreview)',
     'unread_manual = 0 WHERE id = ? AND unread_manual != 0'],
    []],
  ['dist/server/utils/textFilter.js',
    ['isSystemConversationNotice', 'SYSTEM_CONVERSATION_NOTICE_PATTERNS',
     'Các bạn hiện đã được kết nối trên Messenger', 'Cuộc gọi (?:thoại|video) đã kết thúc'],
    []],
  ['dist/server/services/InitialMessageSweepService.js',
    ['!thread.page_id'],
    []]
];

let bad = 0;
for (const [file, mustHave, mustNotHave] of PROBES) {
  let content;
  try {
    content = asar.extractFile(asarPath, file.split('/').join(path.sep)).toString('utf8');
  } catch (e) {
    console.error('EXTRACT FAIL ' + file + ': ' + e.message);
    bad += 1;
    continue;
  }
  for (const m of mustHave) {
    const ok = content.includes(m);
    if (!ok) bad += 1;
    console.log((ok ? 'PASS' : 'FAIL') + ' CO   ' + file + ' :: ' + m);
  }
  for (const m of mustNotHave) {
    const gone = !content.includes(m);
    if (!gone) bad += 1;
    console.log((gone ? 'PASS' : 'FAIL') + ' KHONG ' + file + ' :: ' + m);
  }
}
const stat = fs.statSync(asarPath);
console.log('asar mtime:', stat.mtime.toISOString(), 'size:', stat.size);
process.exit(bad ? 1 : 0);
