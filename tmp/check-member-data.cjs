const Database = require('better-sqlite3');
const path = process.env.APPDATA + '\\autochatbot-fb-crm\\data\\database.db';
const db = new Database(path, { readonly: true });

console.log('messages cols:', db.prepare('PRAGMA table_info(messages)').all().map((c) => c.name).join(', '));

const msgs = db.prepare(`
  SELECT sender_name, sender_id, is_outgoing, substr(content,1,25) AS c
  FROM messages WHERE thread_id = '1671582060680153' ORDER BY id DESC LIMIT 12
`).all();
console.log('\n12 tin mới nhất thread 1671582060680153 (ADSUP):');
for (const m of msgs) console.log(' ', JSON.stringify({ name: m.sender_name, id: m.sender_id, out: m.is_outgoing, c: m.c }));
db.close();
