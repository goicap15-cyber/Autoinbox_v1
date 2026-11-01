// Do ben phai (outgoing) van thieu — dump messages 2 thread Nguyen Bao Long.
const { DatabaseSync } = require('node:sqlite');
const DB = 'C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/database.db';
const db = new DatabaseSync(DB, { readOnly: true });

const threads = db.prepare("SELECT id, external_thread_id, contact_name, account_id, last_activity FROM threads WHERE contact_name LIKE '%Long%'").all();
console.log('=== THREADS Nguyen Bao Long ===');
for (const t of threads) console.log(JSON.stringify(t));
if (!threads.length) process.exit(0);

const since = Date.now() - 4 * 24 * 3600 * 1000; // 4 ngay
for (const t of threads) {
  console.log(`\n=== MESSAGES thread ${t.id} (acc ${t.account_id}, ${t.contact_name}) ===`);
  const rows = db.prepare(`
    SELECT rowid, fb_message_id, content, is_outgoing, sender_role, sender_id,
           datetime(timestamp_ms/1000, 'unixepoch', '+7 hours') AS ts_local,
           datetime(created_at/1000, 'unixepoch', '+7 hours') AS created_local
    FROM messages WHERE thread_id = ? AND timestamp_ms >= ?
    ORDER BY timestamp_ms ASC, rowid ASC`).all(String(t.id), since);
  for (const r of rows) {
    const c = String(r.content || '').replace(/\s+/g, ' ').slice(0, 40);
    console.log(`${r.ts_local} | out=${r.is_outgoing} role=${r.sender_role} | "${c}" | mid=${String(r.fb_message_id).slice(0, 60)} | rowid=${r.rowid} | created=${r.created_local}`);
  }
}
