const fs = require('fs');
const p = 'C:/Users/Admin/Downloads/Duan/CRM_FB1/src/extension/background.js';
let src = fs.readFileSync(p, 'utf8');
const NL = '\r\n';
const n = (s) => s.replace(/\n/g, NL);

function rep(name, from, to) {
  const f = n(from);
  const t = n(to);
  const count = src.split(f).length - 1;
  if (count !== 1) {
    console.log(`MISS/DUP ${name}: ${count} occurrences`);
    process.exit(1);
  }
  src = src.replace(f, t);
  console.log('OK', name);
}

// 1. Track user-occupied lane next to the chain map
rep('add personalHistoryUserJobActive map',
`const personalHistoryChains = new Map();
// A failed upload can leave Messenger's hidden attachment draft mounted in`,
`const personalHistoryChains = new Map();
// Job cua operator (click/cuon) dang chiem tab history: job tin khach (priority)
// khong duoc gianh tab giua chung, neu khong navigation cua no keo tab di lam
// job cuon cua operator bi abort url_mismatch (log 2026-10-01 10:27:27-38).
const personalHistoryUserJobActive = new Map();
// A failed upload can leave Messenger's hidden attachment draft mounted in`);

// 2. Rework runPersonalHistorySerialized
rep('rework runPersonalHistorySerialized',
`function runPersonalHistorySerialized(accountId, operation, isPriority = false) {
  const key = String(accountId || user_id || 'default');
  if (isPriority) {
    personalHistoryChains.delete(key);
  }
  const previous = personalHistoryChains.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  personalHistoryChains.set(key, current);
  current.finally(() => {
    if (personalHistoryChains.get(key) === current) personalHistoryChains.delete(key);
  }).catch(() => {});
  return current;
}`,
`function runPersonalHistorySerialized(accountId, operation, isPriority = false, isUserJob = false) {
  const key = String(accountId || user_id || 'default');
  const userJobOccupiesLane = !isUserJob && personalHistoryUserJobActive.get(key) === true;
  if (isPriority && userJobOccupiesLane) {
    // Tin khach toi khi operator dang click/cuon: xep hang sau, khong gianh tab.
    bgDebug({ stage: 'SYNC_DEFERRED', lane: key, why: 'user_job_occupies_history_lane' });
  } else if (isPriority) {
    personalHistoryChains.delete(key);
  }
  const previous = personalHistoryChains.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  personalHistoryChains.set(key, current);
  if (isUserJob) personalHistoryUserJobActive.set(key, true);
  current.finally(() => {
    if (isUserJob) personalHistoryUserJobActive.delete(key);
    if (personalHistoryChains.get(key) === current) personalHistoryChains.delete(key);
  }).catch(() => {});
  return current;
}`);

// 3. Pass isUserJob at the call site
rep('call site passes isUserJob',
`            const incomingBoost = String(message.data?.reason || '').startsWith('sidebar_incoming');
            await runPersonalHistorySerialized(
              laneKey,
              () => runPersonalHistoryWithDeadline(laneKey, message.data, () => handleSyncThreadMessages(message.data)),
              isUserClick || incomingBoost
            );`,
`            const incomingBoost = String(message.data?.reason || '').startsWith('sidebar_incoming');
            await runPersonalHistorySerialized(
              laneKey,
              () => runPersonalHistoryWithDeadline(laneKey, message.data, () => handleSyncThreadMessages(message.data)),
              isUserClick || incomingBoost,
              isUserClick
            );`);

new Function(src);
fs.writeFileSync(p, src);
console.log('SAVED, syntax OK, length', src.length);
