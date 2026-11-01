const db = require('better-sqlite3')('C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/database.db', { readonly: true });
const acc = '100004449999465';
const mcols = db.prepare("PRAGMA table_info(messages)").all().map(c=>c.name);
console.log('messages cols:', mcols.join(','));
const threads = db.prepare("SELECT id, contact_name, last_message, external_thread_id FROM threads WHERE account_id=? AND is_unread=1").all(acc);
for (const t of threads) {
  const cnt = db.prepare("SELECT COUNT(*) c FROM messages WHERE thread_id=?").get(t.id).c;
  const last = db.prepare("SELECT content, timestamp_ms FROM messages WHERE thread_id=? ORDER BY timestamp_ms DESC, id DESC LIMIT 1").get(t.id);
  const ts = last?.timestamp_ms ? new Date(last.timestamp_ms).toISOString().slice(5,19) : 'none';
  console.log(cnt.toString().padEnd(4),'|',ts,'|',String(t.contact_name||'').slice(0,20).padEnd(20),'| db_last:',String(last?.content||'').replace(/\s+/g,' ').slice(0,30));
}
console.log('--- sidebar_previews ---');
const sp = db.prepare("SELECT sql FROM sqlite_master WHERE name LIKE 'sidebar_preview%'").all();
for (const s of sp) console.log(String(s.sql).slice(0,260));
