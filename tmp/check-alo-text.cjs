const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/database.db', { readOnly: true });

// Tìm thread gần đây nhất
const thread = db.prepare(`SELECT id, contact_name FROM threads WHERE datetime(last_activity) >= datetime('now', '-1 hour') ORDER BY last_activity DESC LIMIT 1`).get();
console.log('Thread:', thread.id, thread.contact_name);

// Lấy messages của thread này
const rows = db.prepare(`
  SELECT content, is_outgoing, delivery_status, timestamp_source, datetime(created_at) as ca 
  FROM messages 
  WHERE thread_id = ? AND content LIKE '%alo%' 
  ORDER BY created_at DESC
`).all(thread.id);

console.log('\nMessages chứa "alo" (newest first):');
for (const r of rows.slice(0, 20)) {
  console.log(JSON.stringify({
    out: r.is_outgoing,
    st: r.delivery_status,
    tsrc: r.timestamp_source,
    content: String(r.content || '').substring(0, 30),
    ca: r.ca
  }));
}

db.close();
