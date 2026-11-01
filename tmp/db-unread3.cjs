const db = require('better-sqlite3')('C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/database.db', { readonly: true });
const acc = '100004449999465';
console.log('--- unread=1 grouped by inbox_folder ---');
for (const r of db.prepare("SELECT COALESCE(inbox_folder,'NULL') f, COUNT(*) c FROM threads WHERE account_id=? AND is_unread=1 GROUP BY f").all(acc))
  console.log(String(r.f).padEnd(30), r.c);
console.log('--- all threads by folder ---');
for (const r of db.prepare("SELECT COALESCE(inbox_folder,'NULL') f, COUNT(*) c FROM threads WHERE account_id=? GROUP BY f").all(acc))
  console.log(String(r.f).padEnd(30), r.c);
console.log('--- sample MESSAGE_REQUEST_POSSIBLE threads ---');
for (const r of db.prepare("SELECT contact_name, last_message, is_unread FROM threads WHERE account_id=? AND inbox_folder='MESSAGE_REQUEST_POSSIBLE' ORDER BY rowid DESC LIMIT 15").all(acc))
  console.log('u='+r.is_unread,'|',String(r.contact_name||'').slice(0,24).padEnd(24),'|',String(r.last_message||'').replace(/\s+/g,' ').slice(0,40));
