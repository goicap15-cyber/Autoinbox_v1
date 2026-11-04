const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const db = new DatabaseSync(path.join(process.env.APPDATA, 'autochatbot-fb-crm', 'data', 'database.db'), { readOnly: true });
const tcols = db.prepare("PRAGMA table_info(threads)").all().map(c => c.name);
console.log('THREAD COLS:', tcols.join(','));
for (const tid of ['28526176070358322','39065684943075776']) {
  const t = db.prepare(`SELECT * FROM threads WHERE id = ? LIMIT 1`).get(tid);
  if (t) console.log('THREAD', tid, JSON.stringify(t, null, 1));
  const msgs = db.prepare(`SELECT id, fb_message_id, substr(content,1,25) AS content, is_outgoing, delivery_status, delivery_error, created_at FROM messages WHERE thread_id = ? ORDER BY id DESC LIMIT 8`).all(tid);
  console.log('MSGS', tid, JSON.stringify(msgs, null, 1));
}
db.close();
