const asar = require('@electron/asar');
const bg = asar.extractFile('release/win-unpacked/resources/app.asar', 'dist\\extension\\background.js').toString();
const srv = asar.extractFile('release/win-unpacked/resources/app.asar', 'dist\\server\\server.js').toString();
const obs = asar.extractFile('release/win-unpacked/resources/app.asar', 'dist\\extension\\sidebarActivityObserver.js').toString();
const checks = [
  // build27 guards van con nguyen
  ['bg: RECIPIENT_IDENTITY_MISMATCH con nguyen', bg.includes("error_code: 'RECIPIENT_IDENTITY_MISMATCH'")],
  // Edit 1: observer log HINT_SEND_FAIL
  ['obs: HINT_SEND_FAIL', obs.includes("stage: 'HINT_SEND_FAIL'")],
  // Edit 2: background
  ['bg: relaySidebarActivityThreads helper', bg.includes('function relaySidebarActivityThreads')],
  ['bg: HINT_RECEIVED log', bg.includes("stage: 'HINT_RECEIVED'")],
  ['bg: immediate snapshot relay trong handler', bg.includes("relaySidebarActivityThreads(hintData.threads, 'sidebar_hint_snapshot'")],
  ['bg: HINT_RELAYED log', bg.includes("stage: 'HINT_RELAYED'")],
  ['bg: HINT_TAB_REJECTED + fallback snapshot', bg.includes("stage: 'HINT_TAB_REJECTED'") && bg.includes("'sidebar_hint_snapshot_fallback'")],
  ['bg: HINT_SCRAPE_FAIL log', bg.includes("stage: 'HINT_SCRAPE_FAIL'")],
  ['bg: observed_at truyen vao scheduler', bg.includes('relaySidebarActivityThreads(threads, \'sidebar_activity_observer\', observedAt)')],
  // Edit 3: server
  ['srv: syncDebug helper', srv.includes("source: 'SYNC_DEBUG'")],
  ['srv: REALTIME_HINT', srv.includes("syncDebug('REALTIME_HINT'")],
  ['srv: PREVIEW_CHANGED', srv.includes("syncDebug('PREVIEW_CHANGED'")],
  ['srv: PREVIEW_BUBBLE + latency', srv.includes("syncDebug('PREVIEW_BUBBLE'") && srv.includes('latency_ms')]
];
let fail = 0;
for (const [name, ok] of checks) { console.log(ok ? 'OK  ' : 'FAIL', name); if (!ok) fail++; }
process.exit(fail ? 1 : 0);
