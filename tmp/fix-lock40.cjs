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

// FIX 1: chi click crm_navigation (chuyen hoi thoai) moi renew khoa 30s.
// crm_scroll_older client tu ban moi vai giay khi thread dang mo -> khoa
// khong bao gio het han -> sync nen bi chan vinh vien (log 09:38-09:44).
rep(
  "              } else {\n" +
  "                // Lock the personal history tab to the thread the user just clicked.\n" +
  "                // Background sync for any other personal thread is blocked only for\n" +
  "                // the 30s click window (same as the Page lock). A lock without\n" +
  "                // expiry permanently blocked background syncs of every other\n" +
  "                // thread, so customer images/videos never synced until the\n" +
  "                // operator clicked that thread themselves.\n" +
  "                userNavigationLockThreadId = String(message.data?.thread_id || '');\n" +
  "                userNavigationLockUntil = Date.now() + 30000;",
  "              } else if (String(message.data?.reason || '') === 'crm_navigation') {\n" +
  "                // Lock the personal history tab to the thread the user just clicked.\n" +
  "                // Background sync for any other personal thread is blocked only for\n" +
  "                // the 30s click window (same as the Page lock). A lock without\n" +
  "                // expiry permanently blocked background syncs of every other\n" +
  "                // thread, so customer images/videos never synced until the\n" +
  "                // operator clicked that thread themselves.\n" +
  "                // CHI click chuyen hoi thoai that su moi khoa: crm_scroll_older\n" +
  "                // client tu ban moi vai giay khi thread dang mo - neu tinh la\n" +
  "                // click thi khoa 30s duoc gia han mai mai, sync nen (ca tin\n" +
  "                // khach) bi chan vinh vien (do log 2026-10-01 09:38-09:44).\n" +
  "                userNavigationLockThreadId = String(message.data?.thread_id || '');\n" +
  "                userNavigationLockUntil = Date.now() + 30000;",
  'FIX1 lock only on real click'
);

// FIX 2: tin khach (sidebar_incoming) luon di qua khoa 30s
rep(
  "  if (!_history_tab_id && !page_id && !isUserDrivenReason\n" +
  "    && userNavigationLockThreadId\n" +
  "    && Date.now() < userNavigationLockUntil\n" +
  "    && userNavigationLockThreadId !== String(thread_id || '')) {",
  "  // Tin khach (sidebar_incoming) luon duoc di qua khoa: operator dang doc\n" +
  "  // hoi thoai khac khong duoc lam tin khach mat qua hydrate media.\n" +
  "  if (!_history_tab_id && !page_id && !isUserDrivenReason\n" +
  "    && baseReason !== 'sidebar_incoming'\n" +
  "    && userNavigationLockThreadId\n" +
  "    && Date.now() < userNavigationLockUntil\n" +
  "    && userNavigationLockThreadId !== String(thread_id || '')) {",
  'FIX2 sidebar_incoming bypasses lock'
);

if (process.exitCode) { console.log('FAILED, not writing'); process.exit(1); }
fs.writeFileSync(path, src, 'utf8');
console.log('WROTE ' + count + ' replacements');
new Function(src);
console.log('SYNTAX_OK');
