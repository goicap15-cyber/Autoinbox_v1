const asar = require('@electron/asar');
const srv = asar.extractFile('release/win-unpacked/resources/app.asar', 'dist\\server\\server.js').toString();
const det = asar.extractFile('release/win-unpacked/resources/app.asar', 'dist\\server\\utils\\sidebarIncomingDetection.js').toString();
const bg = asar.extractFile('release/win-unpacked/resources/app.asar', 'dist\\extension\\background.js').toString();
const obs = asar.extractFile('release/win-unpacked/resources/app.asar', 'dist\\extension\\sidebarActivityObserver.js').toString();
const sched = asar.extractFile('release/win-unpacked/resources/app.asar', 'dist\\server\\services\\InboxSyncScheduler.js').toString();
const checks = [
  // build29 giu nguyen
  ['srv: media_only_hint + MEDIA_HINT', srv.includes('media_only_hint') && srv.includes("syncDebug('MEDIA_HINT'")],
  ['sched: FIFO + click chen dau', sched.includes('queue.splice(insertAt, 0,') && sched.includes("effectivePriority === 'high' && userDriven")],
  // build30: fresh row time
  ['det: isFreshRowTimeText export', det.includes('function isFreshRowTimeText') && det.includes('isFreshRowTimeText };')],
  ['srv: import isFreshRowTimeText', srv.includes("isChangedIncomingSidebarPreview, isFreshRowTimeText } = require('./utils/sidebarIncomingDetection')")],
  ['srv: mediaHintLastSeen dedupe', srv.includes('const mediaHintLastSeen = new Map()') && srv.includes('Date.now() - mediaHintLastAt > 90 * 1000')],
  ['srv: flip OR fresh time', srv.includes('unreadFlippedToIncoming || isFreshRowTimeText(t.row_time_text)')],
  ['bg: scraper row_time_text', (bg.match(/row_time_text/g) || []).length >= 3 && bg.includes('SIDEBAR_TIME_LINE_RE')],
  ['bg: relay passthrough row_time_text', bg.includes('row_time_text: thread.row_time_text')],
  ['obs: TIME_LINE_RE + row_time_text', obs.includes('TIME_LINE_RE') && obs.includes('row_time_text: timeLine.slice(0, 24)')],
  // build31: nhịp chuyển tab
  ['bg: requestTabActivation helper', bg.includes('function requestTabActivation') && bg.includes('CRM_TAB_SWITCH_MIN_GAP_MS = 5000')],
  ['bg: page job qua requestTabActivation', bg.includes('requestTabActivation(tab.id, { immediate: isUserDrivenReason })')],
  ['bg: personal la tab nha', bg.includes('requestTabActivation(tab.id, { isMessengerHome: true })')],
  ['bg: page job xong hen ve messenger', bg.includes('scheduleReturnToMessengerTab()') && bg.includes('lastPageSyncJobStartAt')]
];
let fail = 0;
for (const [name, ok] of checks) { console.log(ok ? 'OK  ' : 'FAIL', name); if (!ok) fail++; }
process.exit(fail ? 1 : 0);
