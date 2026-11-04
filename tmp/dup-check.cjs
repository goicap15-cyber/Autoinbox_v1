const Database = require('better-sqlite3');
const db = new Database('C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/database.db', { readonly: true });
const THREAD = '2211776809571916';

// 1) Duplicate content rows with different mids
const dups = db.prepare(`
  SELECT fb_message_id, content, sender_name, is_outgoing, created_at, timestamp_ms, substr(source,1,40) AS source
  FROM messages WHERE thread_id = ? AND content IN ('là sao','chắc vẫn hơn em')
  ORDER BY created_at
`).all(THREAD);
console.log('=== DUP CONTENT ROWS ===');
for (const r of dups) console.log(JSON.stringify(r));

// 2) Tail of thread to see ordering anomalies
const tail = db.prepare(`
  SELECT fb_message_id, substr(content,1,30) AS content, sender_name, is_outgoing, created_at, timestamp_ms
  FROM messages WHERE thread_id = ? ORDER BY created_at DESC LIMIT 25
`).all(THREAD);
console.log('=== THREAD TAIL (newest 25) ===');
for (const r of tail.reverse()) console.log(JSON.stringify(r));

// 3) reply metadata columns
const cols = db.prepare("PRAGMA table_info(messages)").all().map(c => c.name);
console.log('=== COLUMNS ===', cols.join(','));
db.close();
