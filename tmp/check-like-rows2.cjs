const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');
const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'autochatbot-fb-crm', 'data', 'database.db');
const db = new Database(dbPath);
const rows = db.prepare(`
  SELECT id, fb_message_id, content, is_outgoing, direction_status, sender_role, delivery_status, timestamp_ms, created_at
  FROM messages WHERE id IN (524233, 524247, 524507)
`).all();
console.log(JSON.stringify(rows, null, 1));
db.close();
