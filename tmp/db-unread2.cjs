const db = require('better-sqlite3')('C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/database.db', { readonly: true });
const acc = '100004449999465';
const cols = db.prepare("PRAGMA table_info(threads)").all().map(c=>c.name);
console.log('threads cols:', cols.join(','));
const unread = db.prepare("SELECT contact_name, last_message, is_unread, unread_manual, thread_url FROM threads WHERE account_id=? AND is_unread=1 ORDER BY rowid DESC LIMIT 95").all(acc);
for (const r of unread) console.log(String(r.contact_name||'').slice(0,22).padEnd(22), '|', String(r.last_message||'').replace(/\s+/g,' ').slice(0,40));
