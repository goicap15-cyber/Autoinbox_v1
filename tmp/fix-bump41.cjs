const fs = require('fs');
const NL = '\r\n';
let fail = 0;

function rep(file, oldStr, newStr, label) {
  let src = fs.readFileSync(file, 'utf8');
  const o = oldStr.replace(/\n/g, NL);
  const n = newStr.replace(/\n/g, NL);
  const idx = src.indexOf(o);
  if (idx === -1) { console.error('MISS: ' + label); fail = 1; return; }
  if (src.indexOf(o, idx + 1) !== -1) { console.error('DUP: ' + label); fail = 1; return; }
  src = src.substring(0, idx) + n + src.substring(idx + o.length);
  fs.writeFileSync(file, src, 'utf8');
  console.log('OK: ' + label);
}

const SRV = 'C:/Users/Admin/Downloads/Duan/CRM_FB1/src/server/server.js';
const APP = 'C:/Users/Admin/Downloads/Duan/CRM_FB1/src/client/App.jsx';

// 1. Media-only hint: bump last_activity da co - gui kem gia tri cho client
//    de thread nhay len dau danh sach ngay (client sort theo last_activity).
rep(SRV,
  "                db.prepare('UPDATE threads SET last_activity = CURRENT_TIMESTAMP, is_unread = 1, unread_manual = 1 WHERE id = ?').run(String(canonicalThreadId));\n" +
  "                io.emit('THREAD_UNREAD_CHANGED', { thread_id: String(canonicalThreadId), is_unread: 1 });\n" +
  "                syncDebug('MEDIA_HINT', { thread: String(canonicalThreadId).substring(0, 24), status: sync_status || null });",
  "                const bumpedAtIso = new Date().toISOString();\n" +
  "                db.prepare('UPDATE threads SET last_activity = CURRENT_TIMESTAMP, is_unread = 1, unread_manual = 1 WHERE id = ?').run(String(canonicalThreadId));\n" +
  "                io.emit('THREAD_UNREAD_CHANGED', { thread_id: String(canonicalThreadId), is_unread: 1, last_activity: bumpedAtIso });\n" +
  "                syncDebug('MEDIA_HINT', { thread: String(canonicalThreadId).substring(0, 24), status: sync_status || null });",
  'S1 media hint bump + payload'
);

// 2. Text preview: cung bump last_activity trong DB (truoc day chi set unread)
//    de thu tu danh sach dung ca sau khi reload trang.
rep(SRV,
  "                  db.prepare('UPDATE threads SET is_unread = 1, unread_manual = 1 WHERE id = ?').run(String(canonicalThreadId));\n" +
  "                  io.emit('THREAD_UNREAD_CHANGED', { thread_id: String(canonicalThreadId), is_unread: 1 });",
  "                  db.prepare('UPDATE threads SET last_activity = CURRENT_TIMESTAMP, is_unread = 1, unread_manual = 1 WHERE id = ?').run(String(canonicalThreadId));\n" +
  "                  io.emit('THREAD_UNREAD_CHANGED', { thread_id: String(canonicalThreadId), is_unread: 1, last_activity: new Date().toISOString() });",
  'S2 text preview bump DB'
);

// 3. Client: THREAD_UNREAD_CHANGED nhan last_activity tu payload (media-only
//    khong co NEW_MESSAGE nen day la duyet duy nhat de thread nhay len dau).
rep(APP,
  "      setThreads((prev) => sortThreadsByActivity(prev.map((t) => (String(t.id) === tid\n" +
  "        ? { ...t, is_unread: next ? 1 : 0, unread_manual: next ? 1 : -1 }\n" +
  "        : t))));",
  "      const nextActivity = typeof payload?.last_activity === 'string' ? payload.last_activity : null;\n" +
  "      setThreads((prev) => sortThreadsByActivity(prev.map((t) => (String(t.id) === tid\n" +
  "        ? { ...t, is_unread: next ? 1 : 0, unread_manual: next ? 1 : -1, ...(nextActivity ? { last_activity: nextActivity } : {}) }\n" +
  "        : t))));",
  'C1 client uses payload last_activity'
);

process.exit(fail ? 1 : 0);
