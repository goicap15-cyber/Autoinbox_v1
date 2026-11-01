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

// V0: module vars for WS_RECV throttle + stale re-register throttle
rep(
  "let wsConnectingTimer = null;\n\nfunction connectWebSocket() {",
  "let wsConnectingTimer = null;\n" +
  "const wsRecvLogAt = new Map(); // type -> last WS_RECV log time (chan lo log)\n" +
  "let staleReRegisterUntil = 0;\n\n" +
  "function connectWebSocket() {",
  'V0 vars'
);

// V1: onmessage entry - log + self-heal stale socket mapping
rep(
  "  socket.onmessage = async (event) => {\n" +
  "    if (ws !== socket) return;\n" +
  "    try {\n" +
  "      const message = JSON.parse(event.data);\n" +
  "      console.log('[FB Engine] 📩 Nhận từ Backend:', message.type, '| raw:', event.data.substring(0, 300));",
  "  socket.onmessage = async (event) => {\n" +
  "    if (ws !== socket) {\n" +
  "      // Server van ban message vao socket NAY tuc la mapping ben server\n" +
  "      // con tro socket cu. Neu khong dang ky lai, SYNC_THREAD_MESSAGES se\n" +
  "      // roi vao socket chet yen tinh - khach nhan khong bao gio duoc hydrate.\n" +
  "      let staleType = 'unparsed';\n" +
  "      try { staleType = JSON.parse(event.data)?.type || 'unknown'; } catch (_) {}\n" +
  "      bgDebug({ stage: 'WS_RECV_STALE', type: staleType });\n" +
  "      if (ws && ws.readyState === WebSocket.OPEN && user_id && Date.now() > staleReRegisterUntil) {\n" +
  "        staleReRegisterUntil = Date.now() + 10000;\n" +
  "        sendToBackend('REGISTER_ACCOUNT', { account_id: user_id, fb_dtsg: fb_dtsg || '', pending_key, name: account_name || null, avatar_url: account_avatar_url || null });\n" +
  "        bgDebug({ stage: 'WS_RE_REGISTER', why: 'stale_socket_recv' });\n" +
  "      }\n" +
  "      return;\n" +
  "    }\n" +
  "    try {\n" +
  "      const message = JSON.parse(event.data);\n" +
  "      const recvKey = String(message.type || 'unknown');\n" +
  "      if (Date.now() - (wsRecvLogAt.get(recvKey) || 0) > 5000) {\n" +
  "        wsRecvLogAt.set(recvKey, Date.now());\n" +
  "        bgDebug({ stage: 'WS_RECV', type: recvKey });\n" +
  "      }\n" +
  "      console.log('[FB Engine] 📩 Nhận từ Backend:', message.type, '| raw:', event.data.substring(0, 300));",
  'V1 onmessage log + self-heal'
);

// V2: stale REGISTER_ACCOUNT_ACK visibility
rep(
  "            console.warn('[FB Engine] Ignore stale REGISTER_ACCOUNT_ACK:', ackAccountId, 'expected:', user_id);",
  "            console.warn('[FB Engine] Ignore stale REGISTER_ACCOUNT_ACK:', ackAccountId, 'expected:', user_id);\n" +
  "            bgDebug({ stage: 'WS_STALE_ACK', ack: ackAccountId.substring(0, 20), expected: String(user_id || '').substring(0, 20) });",
  'V2 stale ack log'
);

// V3: onclose visibility in composer-debug
rep(
  "    console.log(`[FB Engine] WebSocket đóng (code=${event.code}). Thử lại sau ${reconnectDelay / 1000}s...`);",
  "    console.log(`[FB Engine] WebSocket đóng (code=${event.code}). Thử lại sau ${reconnectDelay / 1000}s...`);\n" +
  "    bgDebug({ stage: 'WS_CLOSED', code: event.code });",
  'V3 onclose log'
);

if (process.exitCode) { console.log('FAILED, not writing'); process.exit(1); }
fs.writeFileSync(path, src, 'utf8');
console.log('WROTE ' + count + ' replacements');
new Function(src);
console.log('SYNTAX_OK');
