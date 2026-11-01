const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');
const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'autochatbot-fb-crm', 'data', 'database.db');
const db = new Database(dbPath, { readonly: true });
const rows = db.prepare(`
  SELECT id, fb_message_id, content, is_outgoing, direction_status,
         datetime(timestamp_ms/1000, 'unixepoch', 'localtime') AS ts_local,
         datetime(created_at, 'localtime') AS created_local
  FROM messages
  WHERE thread_id = '1078312194725711'
    AND created_at >= '2026-10-07T07:10:00'
  ORDER BY timestamp_ms ASC
`).all();
console.log('=== tin nhắn thread like từ 14:10 hôm nay (' + rows.length + ' row):');
for (const r of rows) console.log(JSON.stringify(r));
const likes = db.prepare(`
  SELECT COUNT(*) c, MIN(datetime(timestamp_ms/1000,'unixepoch','localtime')) first, MAX(datetime(timestamp_ms/1000,'unixepoch','localtime')) last
  FROM messages WHERE thread_id = '1078312194725711' AND content = '\u{1F44D}'
`).get();
console.log('=== tổng 👍 trong thread:', JSON.stringify(likes));
db.close();
