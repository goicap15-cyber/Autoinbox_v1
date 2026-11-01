// Fix A: tin khach gianh lane history sau 15s grace khi operator dang thao tac.
const fs = require('fs');
const path = 'C:/Users/Admin/Downloads/Duan/CRM_FB1/src/extension/background.js';
let src = fs.readFileSync(path, 'utf8');

const OLD = [
  "function runPersonalHistorySerialized(accountId, operation, isPriority = false, isUserJob = false) {\r\n",
  "  const key = String(accountId || user_id || 'default');\r\n",
  "  const userJobOccupiesLane = !isUserJob && personalHistoryUserJobActive.get(key) === true;\r\n",
  "  if (isPriority && userJobOccupiesLane) {\r\n",
  "    // Tin khach toi khi operator dang click/cuon: xep hang sau, khong gianh tab.\r\n",
  "    bgDebug({ stage: 'SYNC_DEFERRED', lane: key, why: 'user_job_occupies_history_lane' });\r\n",
  "  } else if (isPriority) {\r\n",
  "    personalHistoryChains.delete(key);\r\n",
  "  }\r\n",
  "  const previous = personalHistoryChains.get(key) || Promise.resolve();\r\n",
  "  const current = previous.catch(() => {}).then(operation);\r\n",
  "  personalHistoryChains.set(key, current);\r\n",
  "  if (isUserJob) personalHistoryUserJobActive.set(key, true);\r\n",
  "  current.finally(() => {\r\n",
  "    if (isUserJob) personalHistoryUserJobActive.delete(key);\r\n",
  "    if (personalHistoryChains.get(key) === current) personalHistoryChains.delete(key);\r\n",
  "  }).catch(() => {});\r\n",
  "  return current;\r\n",
  "}\r\n"
].join('');

const NEW = [
  "function runPersonalHistorySerialized(accountId, operation, isPriority = false, isUserJob = false) {\r\n",
  "  const key = String(accountId || user_id || 'default');\r\n",
  "  const userJobOccupiesLane = !isUserJob && personalHistoryUserJobActive.get(key) === true;\r\n",
  "  let incomingTakeoverTimer = null;\r\n",
  "  if (isPriority && userJobOccupiesLane) {\r\n",
  "    // Tin khach toi khi operator dang click/cuon: xep hang sau, khong gianh tab.\r\n",
  "    bgDebug({ stage: 'SYNC_DEFERRED', lane: key, why: 'user_job_occupies_history_lane' });\r\n",
  "  } else if (isPriority) {\r\n",
  "    personalHistoryChains.delete(key);\r\n",
  "  }\r\n",
  "  const previous = personalHistoryChains.get(key) || Promise.resolve();\r\n",
  "  const current = previous.catch(() => {}).then(operation);\r\n",
  "  personalHistoryChains.set(key, current);\r\n",
  "  if (isUserJob) personalHistoryUserJobActive.set(key, true);\r\n",
  "  if (isPriority && userJobOccupiesLane && !key.startsWith('page:')) {\r\n",
  "    // 2026-10-02: sau 15s doi, tin khach GIANH lane ca nhan - kick token\r\n",
  "    // navigation (cung key \"<acc>:history\" voi token cua job click/cuon)\r\n",
  "    // lam job do tu huy (navigation_superseded, server retry lai qua\r\n",
  "    // TRANSIENT_REASONS), thay vi de tin khach doi ca 45-65s cua job\r\n",
  "    // operator (reproduce 2026-10-02: tin Khang den 12:42:26, chay\r\n",
  "    // 12:44:13 sau 3 job click/scroll chiem lane). Lane Page bo qua:\r\n",
  "    // job Page khong tao navigation token de kick.\r\n",
  "    incomingTakeoverTimer = setTimeout(() => {\r\n",
  "      if (personalHistoryUserJobActive.get(key) !== true) return;\r\n",
  "      if (personalHistoryChains.get(key) !== current) return;\r\n",
  "      beginPersonalNavigation(key);\r\n",
  "      personalHistoryChains.delete(key);\r\n",
  "      bgDebug({ stage: 'SYNC_LANE_TAKEOVER', lane: key, why: 'incoming_grace_15s' });\r\n",
  "    }, 15000);\r\n",
  "  }\r\n",
  "  current.finally(() => {\r\n",
  "    if (incomingTakeoverTimer) clearTimeout(incomingTakeoverTimer);\r\n",
  "    if (isUserJob) personalHistoryUserJobActive.delete(key);\r\n",
  "    if (personalHistoryChains.get(key) === current) personalHistoryChains.delete(key);\r\n",
  "  }).catch(() => {});\r\n",
  "  return current;\r\n",
  "}\r\n"
].join('');

const count = src.split(OLD).length - 1;
if (count !== 1) {
  console.error(`MISS/DUP: expected exactly 1 match, found ${count}`);
  process.exit(1);
}
src = src.replace(OLD, NEW);
fs.writeFileSync(path, src, 'utf8');
const after = fs.readFileSync(path, 'utf8');
if (!after.includes('SYNC_LANE_TAKEOVER') || after.split('incomingTakeoverTimer').length !== 4) {
  console.error('VERIFY FAIL: takeover code not present after write');
  process.exit(1);
}
if (after.includes('\r\n') === false) {
  console.error('VERIFY FAIL: CRLF lost');
  process.exit(1);
}
console.log('OK background.js patched: 1 replacement, CRLF preserved');
