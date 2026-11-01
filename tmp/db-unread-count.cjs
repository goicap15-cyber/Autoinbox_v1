const db = require('better-sqlite3')('C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/database.db', { readonly: true });
const acc = '100004449999465';
console.log('total', db.prepare('SELECT COUNT(*) c FROM threads WHERE account_id=?').get(acc).c,
  'unread=1', db.prepare('SELECT COUNT(*) c FROM threads WHERE account_id=? AND is_unread=1').get(acc).c);
console.log('unread_manual=1', db.prepare('SELECT COUNT(*) c FROM threads WHERE account_id=? AND unread_manual=1').get(acc).c);
const recent = db.prepare("SELECT id, contact_name, is_unread, unread_manual, last_message, updated_at FROM threads WHERE account_id=? AND is_unread=1 ORDER BY updated_at DESC LIMIT 25").all(acc);
for (const r of recent) console.log(String(r.updated_at).slice(5,19), '|u='+r.is_unread, '|m='+r.unread_manual, '|', String(r.contact_name).slice(0,22), '|', String(r.last_message).replace(/\s+/g,' ').slice(0,45));
try {
  const sp = db.prepare("SELECT COUNT(*) c FROM sidebar_previews").get();
  console.log('sidebar_previews rows:', sp?.c ?? 'NO TABLE');
  const recentSp = db.prepare("SELECT * FROM sidebar_previews ORDER BY rowid DESC LIMIT 8").all();
  for (const r of recentSp) console.log(' SP', JSON.stringify(r).slice(0, 160));
} catch (e) { console.log('sidebar_previews:', e.message); }
