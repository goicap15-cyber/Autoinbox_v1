// Verify build49 asar: chan bao replay 2s (NO_REPLAY + stale-result guard +
// preempt cap + checkpoint stop_reason). Client fix verified functionally.
const path = require('path');
const fs = require('fs');
const asar = require(path.join('C:/Users/Admin/Downloads/Duan/CRM_FB1/node_modules/@electron/asar'));
const asarPath = 'C:/Users/Admin/Downloads/Duan/CRM_FB1/release/win-unpacked/resources/app.asar';

const PROBES = [
  ['dist/server/services/InboxSyncScheduler.js',
    ['NO_REPLAY_REASONS', 'STALE_RESULT_REASONS', 'INBOX_SYNC_STALE_RESULT_IGNORED',
     'preempt_count', 'dispatchedAt = Date.now()', 'preemptedAt.set(key, Date.now())',
     'preemptedAt.delete(key)', 'isNoReplay', "includes('_replay')",
     "'no_scroll_growth'", "'timeout'", "'navigation_superseded'"],
    ['if (!isLoopTerminator) {', "const userDriven = /^(crm_navigation|crm_navigation_replay|crm_scroll_older|crm_scroll_viewport)/"]],
  ['dist/server/server.js',
    ['schedulerResultReason', 'checkpointStopReason', "boundary_reached ? 'reached_top' : null)"],
    ['markThreadSyncResult(account_id, thread_id, reason || null, page_id || null)']],
  ['dist/extension/background.js',
    ['operatorRequestsReasons'],
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

// Client bundle: index-*.js phải tồn tại trong asar (verify kỹ bằng hành vi).
const entries = asar.listPackage(asarPath);
const clientBundle = entries.find((e) => /dist[\\/]client[\\/]assets[\\/]index-.*\.js$/.test(String(e)));
if (clientBundle) {
  const clean = String(clientBundle).replace(/^\\/, '');
  const bundle = asar.extractFile(asarPath, clean).toString('utf8');
  const hasProp = bundle.includes('onViewportScroll');
  if (!hasProp) bad += 1;
  console.log((hasProp ? 'PASS' : 'FAIL') + ' CO   client bundle (' + clean + ') :: onViewportScroll prop present, size=' + bundle.length);
} else {
  console.error('FAIL CO   client bundle :: index-*.js not found in asar');
  bad += 1;
}

const stat = fs.statSync(asarPath);
console.log('asar mtime:', stat.mtime.toISOString(), 'size:', stat.size);
process.exit(bad ? 1 : 0);
