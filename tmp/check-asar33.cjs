const asar = require('@electron/asar');
const bg = asar.extractFile('release/win-unpacked/resources/app.asar', 'dist\\extension\\background.js').toString();
const sched = asar.extractFile('release/win-unpacked/resources/app.asar', 'dist\\server\\services\\InboxSyncScheduler.js').toString();
const checks = [
  // build33: quet nhe doc tab chat, khong mo tab discovery/BS, khong force active
  ['bg: realtime doc tab chat (khong ensure discovery)', bg.includes("getRegisteredTab(FbCrmMessengerTabRoles.roleKey(account_id, 'chat'))") && bg.includes('let personalTab = null;')],
  ['bg: bizTabs chi cho quet sau (isRealtimeScan)', bg.includes('const bizTabs = isRealtimeScan ? [] :')],
  ['bg: realtime khong force active tab', bg.includes('if (!isRealtimeInboxScan) {')],
  ['bg: page active gap 15s', bg.includes('CRM_PAGE_TAB_SWITCH_MIN_GAP_MS = 15000')],
  ['bg: messenger 5s / page 15s theo loai', bg.includes('isMessengerHome ? CRM_TAB_SWITCH_MIN_GAP_MS : CRM_PAGE_TAB_SWITCH_MIN_GAP_MS')],
  // build32 giu nguyen
  ['sched: windowSource always_on', sched.includes("state.windowSource = 'always_on'")],
  ['sched: else-if chi clear khi operator', sched.includes("extensionLive && state.windowSource === 'operator'")],
  // build31 giu nguyen
  ['bg: requestTabActivation helper', bg.includes('function requestTabActivation') && bg.includes('CRM_TAB_SWITCH_MIN_GAP_MS = 5000')],
  ['bg: scheduleReturnToMessengerTab', bg.includes('function scheduleReturnToMessengerTab')]
];
let fail = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) fail += 1;
}
process.exit(fail ? 1 : 0);
