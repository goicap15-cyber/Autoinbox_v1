const Database = require('../node_modules/better-sqlite3');
const db = new Database('C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/database.db', { readonly: true });
const junk = db.prepare(`SELECT COUNT(*) n FROM threads WHERE is_unread=1 AND last_message IS NOT NULL`).get();
const all = db.prepare(`SELECT COUNT(*) n FROM threads WHERE is_unread=1`).get();
console.log('unread total:', all.n, '| with last_message:', junk.n);
const rows = db.prepare(`SELECT id, contact_name, last_message FROM threads WHERE is_unread=1 ORDER BY last_activity DESC LIMIT 8`).all();
for (const r of rows) console.log(r.id, '|', String(r.contact_name).slice(0,20), '|', String(r.last_message).slice(0,60));
