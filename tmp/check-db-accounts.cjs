const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/database.db', { readOnly: true });
const rows = db.prepare("SELECT id, name, status, created_at FROM accounts ORDER BY created_at DESC LIMIT 12").all();
console.log('Tổng:', db.prepare('SELECT COUNT(*) n FROM accounts').get().n);
for (const r of rows) console.log(`${r.id} | ${r.status} | ${r.created_at} | ${r.name || '(không tên)'}`);
