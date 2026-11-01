const asar = require('@electron/asar');
const sched = asar.extractFile('release/win-unpacked/resources/app.asar', 'dist\\server\\services\\InboxSyncScheduler.js').toString();
const checks = [
  // build32: windowSource flag - tick always-on khong duoc tu dai scheduler full/requests
  ['sched: register windowSource: null', sched.includes('windowSource: null')],
  ['sched: always-on renew set windowSource', sched.includes("state.windowSource = 'always_on'")],
  ['sched: else-if chi clear khi operator', sched.includes("extensionLive && state.windowSource === 'operator'")],
  ['sched: startSyncWindow set operator', sched.includes("state.windowSource = 'operator'")],
  ['sched: stopSyncWindow clear', sched.includes('state.windowSource = null')],
  // build29-31 giu nguyen
  ['sched: FIFO queue', sched.includes('queue.splice(insertAt, 0,')],
  ['sched: always-on dispatch realtime', sched.includes("'scheduler_realtime_always_on'")]
];
let fail = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) fail += 1;
}
process.exit(fail ? 1 : 0);
