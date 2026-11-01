const fs = require('fs');

const path = 'C:/Users/Admin/Downloads/Duan/CRM_FB1/src/extension/background.js';
let src = fs.readFileSync(path, 'utf8');
const NL = '\r\n';
let count = 0;

function rep(oldStr, newStr, label) {
  const o = oldStr.replace(/\n/g, NL);
  const n = newStr.replace(/\n/g, NL);
  const idx = src.indexOf(o);
  if (idx === -1) { console.error('MISS: ' + label); process.exitCode = 1; return; }
  if (src.indexOf(o, idx + 1) !== -1) { console.error('DUP: ' + label); process.exitCode = 1; return; }
  src = src.substring(0, idx) + n + src.substring(idx + o.length);
  count++;
  console.log('OK: ' + label);
}

// A1: log job receive (after isUserClick computed in SYNC_THREAD_MESSAGES case)
rep(
  "            const isUserClick = ['crm_navigation', 'crm_scroll_older', 'crm_scroll_viewport'].includes(String(message.data?.reason || ''));",
  "            const isUserClick = ['crm_navigation', 'crm_scroll_older', 'crm_scroll_viewport'].includes(String(message.data?.reason || ''));\n" +
  "            bgDebug({ stage: 'SYNC_JOB', thread: String(message.data?.thread_id || '').substring(0, 24), reason: message.data?.reason || null, page: Boolean(message.data?.page_id), click: isUserClick });",
  'A1 SYNC_JOB'
);

// A2: log handleSyncThreadMessages entry
rep(
  "  if (!thread_id) return;\n  const allowedReasons = new Set(",
  "  if (!thread_id) return;\n  bgDebug({ stage: 'SYNC_THREAD_START', thread: String(thread_id || '').substring(0, 24), mode, reason: reason || null, allow_nav: allow_navigation === true });\n  const allowedReasons = new Set(",
  'A2 SYNC_THREAD_START'
);

// A3a: skip - navigation not authorized
rep(
  "  if (!_history_tab_id && (allow_navigation !== true || !allowedReasons.has(baseReason))) {\n    sendToBackend('THREAD_MESSAGES_SYNCED', {",
  "  if (!_history_tab_id && (allow_navigation !== true || !allowedReasons.has(baseReason))) {\n    bgDebug({ stage: 'SYNC_SKIP', why: 'navigation_not_authorized', thread: String(thread_id || '').substring(0, 24), reason: reason || null });\n    sendToBackend('THREAD_MESSAGES_SYNCED', {",
  'A3a SKIP nav_not_authorized'
);

// A3b: skip - locked by user selection
rep(
  "    console.log(`[FB Engine] [NAV_LOCK] Skipping background sync for thread=${thread_id} — history tab locked to ${userNavigationLockThreadId}`);",
  "    console.log(`[FB Engine] [NAV_LOCK] Skipping background sync for thread=${thread_id} — history tab locked to ${userNavigationLockThreadId}`);\n" +
  "    bgDebug({ stage: 'SYNC_SKIP', why: 'locked_by_user_selection', thread: String(thread_id || '').substring(0, 24), locked_to: String(userNavigationLockThreadId || '').substring(0, 24) });",
  'A3b SKIP user lock'
);

// A3c: skip - page locked
rep(
  "      console.log(`[FB Engine] [PAGE_NAV_LOCK] Skipping background sync for thread=${thread_id} on page=${pid} — tab locked to ${lockedThread}`);",
  "      console.log(`[FB Engine] [PAGE_NAV_LOCK] Skipping background sync for thread=${thread_id} on page=${pid} — tab locked to ${lockedThread}`);\n" +
  "      bgDebug({ stage: 'SYNC_SKIP', why: 'page_locked', thread: String(thread_id || '').substring(0, 24) });",
  'A3c SKIP page lock'
);

// A4: SPA nav wait loop -> capture outcome + log
rep(
  "      if (clicked?.[0]?.result?.ok) {\n" +
  "        const deadline = Date.now() + 4000;\n" +
  "        while (Date.now() < deadline) {\n" +
  "          if (!isPersonalNavigationCurrent(navigationToken)) return false;\n" +
  "          await delay(200);\n" +
  "          const currentId = await getCurrentThreadIdInTab(tab.id);\n" +
  "          if (String(currentId) === targetId) {\n" +
  "            console.log(`[FB Engine] ✅ Navigation tới thread ${targetId} thành công (${clicked[0].result.type})`);\n" +
  "            return true;\n" +
  "          }\n" +
  "        }\n" +
  "      }",
  "      if (clicked?.[0]?.result?.ok) {\n" +
  "        const deadline = Date.now() + 4000;\n" +
  "        let navOk = false;\n" +
  "        let lastSeenId = null;\n" +
  "        while (Date.now() < deadline) {\n" +
  "          if (!isPersonalNavigationCurrent(navigationToken)) return false;\n" +
  "          await delay(200);\n" +
  "          lastSeenId = await getCurrentThreadIdInTab(tab.id);\n" +
  "          if (String(lastSeenId) === targetId) { navOk = true; break; }\n" +
  "        }\n" +
  "        bgDebug({ stage: 'SPA_NAV', type: clicked[0].result.type, ok: navOk, current: String(lastSeenId || '').substring(0, 24), target: String(targetId).substring(0, 24) });\n" +
  "        if (navOk) {\n" +
  "          console.log(`[FB Engine] ✅ Navigation tới thread ${targetId} thành công (${clicked[0].result.type})`);\n" +
  "          return true;\n" +
  "        }\n" +
  "      }",
  'A4 SPA_NAV'
);

// A5: fallback tabs.update wait loop -> capture outcome + log
rep(
  "    const deadline = Date.now() + 4000;\n" +
  "    while (Date.now() < deadline) {\n" +
  "      if (!isPersonalNavigationCurrent(navigationToken)) return false;\n" +
  "      await delay(250);\n" +
  "      const currentId = await getCurrentThreadIdInTab(tab.id);\n" +
  "      if (String(currentId) === targetId) {\n" +
  "        console.log(`[FB Engine] ✅ Personal Messenger đã vào đúng thread ${targetId} via tabs.update`);\n" +
  "        return true;\n" +
  "      }\n" +
  "    }",
  "    const deadline = Date.now() + 4000;\n" +
  "    let navOk = false;\n" +
  "    let lastSeenId = null;\n" +
  "    while (Date.now() < deadline) {\n" +
  "      if (!isPersonalNavigationCurrent(navigationToken)) return false;\n" +
  "      await delay(250);\n" +
  "      lastSeenId = await getCurrentThreadIdInTab(tab.id);\n" +
  "      if (String(lastSeenId) === targetId) { navOk = true; break; }\n" +
  "    }\n" +
  "    bgDebug({ stage: 'NAV_FALLBACK', ok: navOk, current: String(lastSeenId || '').substring(0, 24), target: String(targetId).substring(0, 24) });\n" +
  "    if (navOk) {\n" +
  "      console.log(`[FB Engine] ✅ Personal Messenger đã vào đúng thread ${targetId} via tabs.update`);\n" +
  "      return true;\n" +
  "    }",
  'A5 NAV_FALLBACK'
);

// A6: abort url_mismatch/route mismatch -> log details
rep(
  "  if (!onTargetThread || !pageIdentityOk || (currentTabThreadId && String(currentTabThreadId) !== navigationThreadId)) {\n" +
  "    console.warn(`[DOM Sync Verification] ⚠️ Tab Facebook đang mở thread ${currentTabThreadId || 'khác'} (header: ${routeDetail || 'n/a'}), không khớp thread ${thread_id}. Hủy sync để tránh ghi nhầm DB.`);",
  "  if (!onTargetThread || !pageIdentityOk || (currentTabThreadId && String(currentTabThreadId) !== navigationThreadId)) {\n" +
  "    bgDebug({ stage: 'SYNC_ABORT', why: page_id ? 'thread_route_mismatch' : 'url_mismatch', on_target: onTargetThread === true, current: String(currentTabThreadId || '').substring(0, 24), target: String(navigationThreadId || '').substring(0, 24) });\n" +
  "    console.warn(`[DOM Sync Verification] ⚠️ Tab Facebook đang mở thread ${currentTabThreadId || 'khác'} (header: ${routeDetail || 'n/a'}), không khớp thread ${thread_id}. Hủy sync để tránh ghi nhầm DB.`);",
  'A6 SYNC_ABORT'
);

if (process.exitCode) { console.log('FAILED, not writing'); process.exit(1); }
fs.writeFileSync(path, src, 'utf8');
console.log('WROTE ' + count + ' replacements');
new Function(src);
console.log('SYNTAX_OK');
