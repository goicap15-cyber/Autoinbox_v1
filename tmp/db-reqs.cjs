const db = require('better-sqlite3')('C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/database.db', { readonly: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t=>t.name);
console.log('TABLES:', tables.filter(n=>/request|wait|pending|sidebar/i.test(n)).join(', '));
const mr = tables.find(n=>/message_request/i.test(n));
if (mr) {
  const cols = db.prepare(`PRAGMA table_info(${mr})`).all().map(c=>c.name);
  console.log(mr, 'cols:', cols.join(','));
  const cnt = db.prepare(`SELECT COUNT(*) c FROM ${mr}`).get().c;
  console.log(mr, 'rows:', cnt);
  for (const r of db.prepare(`SELECT * FROM ${mr} ORDER BY rowid DESC LIMIT 12`).all())
    console.log(JSON.stringify(r).slice(0,200));
}
