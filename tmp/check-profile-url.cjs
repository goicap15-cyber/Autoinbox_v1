const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');
const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'autochatbot-fb-crm', 'data', 'database.db');
const db = new Database(dbPath, { readonly: true });
const rows = db.prepare("SELECT thread_id, name, profile_url, phone, avatar_url FROM contacts WHERE name LIKE ? OR profile_url LIKE ?").all('%Diệu Linh%', '%1894838067833459%');
console.log('CONTACTS:', JSON.stringify(rows, null, 2));
if (rows.length) {
  const ids = rows.map(r => r.thread_id);
  const threads = db.prepare(`SELECT id, external_thread_id, contact_name, account_id FROM threads WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  console.log('THREADS:', JSON.stringify(threads, null, 2));
}
db.close();
