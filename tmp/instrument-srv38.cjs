const fs = require('fs');

const path = 'C:/Users/Admin/Downloads/Duan/CRM_FB1/src/server/server.js';
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

// Dispatch fail: extension WS missing
rep(
  "  dispatchThreadMessagesSync: ({ account_id, thread_id, external_thread_id, thread_url, page_id, contact_name, reason, allow_navigation, sync_mode, scroll_delta }) => {\n" +
  "    const extWs = extensionConnections.get(String(account_id));\n" +
  "    if (!extWs || extWs.readyState !== WebSocket.OPEN) return false;",
  "  dispatchThreadMessagesSync: ({ account_id, thread_id, external_thread_id, thread_url, page_id, contact_name, reason, allow_navigation, sync_mode, scroll_delta }) => {\n" +
  "    const extWs = extensionConnections.get(String(account_id));\n" +
  "    if (!extWs || extWs.readyState !== WebSocket.OPEN) {\n" +
  "      syncDebug('SYNC_DISPATCH_FAIL', { thread: String(thread_id || '').substring(0, 20), reason: reason || null, why: 'no_extension_ws' });\n" +
  "      return false;\n" +
  "    }",
  'S1 DISPATCH_FAIL'
);

// Dispatch success: log after extWs.send
rep(
  "        scroll_delta: Number(scroll_delta) || 0\n" +
  "      }\n" +
  "    }));\n" +
  "    return true;",
  "        scroll_delta: Number(scroll_delta) || 0\n" +
  "      }\n" +
  "    }));\n" +
  "    syncDebug('SYNC_DISPATCH', { thread: String(thread_id || '').substring(0, 20), reason: reason || null, mode });\n" +
  "    return true;",
  'S2 DISPATCH_OK'
);

if (process.exitCode) { console.log('FAILED, not writing'); process.exit(1); }
fs.writeFileSync(path, src, 'utf8');
console.log('WROTE ' + count + ' replacements');
new Function(src);
console.log('SYNTAX_OK');
