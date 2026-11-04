const asar = require('@electron/asar');
const srv = asar.extractFile('release/win-unpacked/resources/app.asar', 'dist\\server\\server.js').toString();
const sched = asar.extractFile('release/win-unpacked/resources/app.asar', 'dist\\server\\services\\InboxSyncScheduler.js').toString();
const checks = [
  // build28 giu nguyen
  ['srv: syncDebug + PREVIEW_BUBBLE', srv.includes("source: 'SYNC_DEBUG'") && srv.includes("syncDebug('PREVIEW_BUBBLE'")],
  // build29: media-only detection
  ['srv: rawSidebarPreview truoc DB fallback', srv.includes('const rawSidebarPreview = cleanMessageText(t.last_message);')],
  ['srv: media_only_hint push', (srv.match(/media_only_hint/g) || []).length === 2],
  ['srv: unreadFlippedToIncoming', srv.includes('const unreadFlippedToIncoming')],
  ['srv: guard tin really 90s', srv.includes('const recentRealIncoming = db.prepare(') && srv.includes('Date.now() - 90 * 1000')],
  ['srv: MEDIA_HINT debug + bump', srv.includes("syncDebug('MEDIA_HINT'") && srv.includes("last_activity = CURRENT_TIMESTAMP, is_unread = 1, unread_manual = 1")],
  ['srv: boundPageSource ra khoi if bubble', (srv.match(/ConversationRepository\.getThreadSource\(canonicalThreadId\)/g) || []).length >= 1 && srv.indexOf('const boundPageSource') < srv.indexOf('if (incomingPreviewChanged)')],
  // build29: FIFO queue
  ['sched: click user van chen dau', sched.includes("effectivePriority === 'high' && userDriven")],
  ['sched: FIFO insert sau cung job high', sched.includes('queue.splice(insertAt, 0,') && sched.includes("queue[insertAt].priority === 'high'")]
];
let fail = 0;
for (const [name, ok] of checks) { console.log(ok ? 'OK  ' : 'FAIL', name); if (!ok) fail++; }
process.exit(fail ? 1 : 0);
