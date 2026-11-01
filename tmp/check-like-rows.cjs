const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');
const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'autochatbot-fb-crm', 'data', 'database.db');
const db = new Database(dbPath, { readonly: true });
const rows = db.prepare(`
  SELECT id, thread_id, fb_message_id, is_outgoing, direction_status, sender_role,
         datetime(timestamp_ms/1000, 'unixepoch', 'localtime') AS ts_local, created_at
  FROM messages
  WHERE content = '\u{1F44D}'
  ORDER BY timestamp_ms DESC LIMIT 20
`).all();
console.log('=== 20 row 👍 gần nhất:');
for (const r of rows) console.log(JSON.stringify(r));
const counts = db.prepare(`
  SELECT is_outgoing, direction_status, COUNT(*) c FROM messages WHERE content = '\u{1F44D}' GROUP BY is_outgoing, direction_status
`).all();
console.log('=== phân bố chiều:', JSON.stringify(counts));
db.close();
