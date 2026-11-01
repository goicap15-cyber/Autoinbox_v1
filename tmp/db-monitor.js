// Monitor: theo dõi tin mới vào thread 39065684943075776 trên DB sống.
// In ra: nội dung + thời điểm tin được khách gửi + thời điểm xuất hiện trong DB (độ trễ watcher).
const { DatabaseSync } = require('node:sqlite');
const DB = 'C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/database.db';
let seen = new Set();
function firstPass() {
  const db = new DatabaseSync(DB, { readOnly: true });
  const rows = db.prepare("SELECT id FROM messages WHERE thread_id='39065684943075776'").all();
  for (const r of rows) seen.add(r.id);
  db.close();
  console.log('[monitor] seeded', seen.size, 'rows | bắt đầu theo dõi...');
}
firstPass();
setInterval(() => {
  try {
    const db = new DatabaseSync(DB, { readOnly: true });
    const rows = db.prepare("SELECT id, content, is_outgoing, timestamp_ms FROM messages WHERE thread_id='39065684943075776' AND id > ? ORDER BY id").all(Math.max(0, ...seen) || 0);
    db.close();
    const now = Date.now();
    for (const r of rows) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      const lag = Math.round((now - r.timestamp_ms) / 1000);
      console.log(`[monitor ${new Date().toLocaleTimeString('vi-VN')}] TIN MỚI id=${r.id} | ${r.is_outgoing ? 'OUT' : 'IN '} | "${r.content}" | khách gửi lúc ${new Date(r.timestamp_ms).toLocaleTimeString('vi-VN')} | vào DB sau ${lag}s`);
    }
  } catch (e) { console.log('[monitor] err', e.message); }
}, 5000);
