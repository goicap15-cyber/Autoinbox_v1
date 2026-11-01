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

// Socket moi chiem mapping khi socket cu chet HOAC >8s khong dang ky lai.
// Content script dang ky lai moi ~3s tren socket HIEN TAI, nen socket duoc
// map neu con song thi lastRegisterAt luon moi. Neu khong - day la socket
// zombie (van OPEN ben server nhung extension da bo) va cuMapping phai
// chuyen, neu khong SYNC_THREAD_MESSAGES bắn vào socket chet mai mai.
rep(
  "          const previousExtension = extensionConnections.get(account_id);\n" +
  "          // A Page Chrome has the same Facebook account id as Personal\n" +
  "          // Messenger. Preserve the personal socket instead of closing it;\n" +
  "          // Page identifies itself immediately afterwards with PAGE_CONTEXT_READY.\n" +
  "          if (!previousExtension || previousExtension.readyState !== WebSocket.OPEN) {\n" +
  "            extensionConnections.set(account_id, ws);\n" +
  "          }",
  "          ws.lastRegisterAt = Date.now();\n" +
  "          const previousExtension = extensionConnections.get(account_id);\n" +
  "          const previousIsZombie = previousExtension && previousExtension !== ws\n" +
  "            && previousExtension.readyState === WebSocket.OPEN\n" +
  "            && Date.now() - (previousExtension.lastRegisterAt || 0) > 8000;\n" +
  "          if (previousIsZombie) {\n" +
  "            syncDebug('WS_REMAPPED', { thread: null, account: String(account_id || '').substring(0, 20), why: 'zombie_socket_stale_register' });\n" +
  "          }\n" +
  "          // A Page Chrome has the same Facebook account id as Personal\n" +
  "          // Messenger. Preserve the personal socket instead of closing it;\n" +
  "          // Page identifies itself immediately afterwards with PAGE_CONTEXT_READY.\n" +
  "          // Socket zombie (van OPEN nhung extension khong con doc) phai nhuong\n" +
  "          // mapping cho socket dang ky moi, neu khong job dieu huong chet yen tinh.\n" +
  "          if (!previousExtension || previousExtension.readyState !== WebSocket.OPEN || previousIsZombie) {\n" +
  "            extensionConnections.set(account_id, ws);\n" +
  "          }",
  'SV1 zombie remap'
);

if (process.exitCode) { console.log('FAILED, not writing'); process.exit(1); }
fs.writeFileSync(path, src, 'utf8');
console.log('WROTE ' + count + ' replacements');
new Function(src);
console.log('SYNTAX_OK');
