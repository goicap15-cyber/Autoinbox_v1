const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const db = new DatabaseSync(path.join(process.env.APPDATA, 'autochatbot-fb-crm', 'data', 'database.db'), { readOnly: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%page%' OR name LIKE '%app%')").all();
console.log('TABLES:', tables.map(t => t.name).join(','));
for (const t of tables) {
  if (t.name.includes('app')) {
    try {
      const rows = db.prepare(`SELECT * FROM ${t.name} LIMIT 5`).all();
      console.log('== ' + t.name + ' ==', JSON.stringify(rows, null, 1).slice(0, 1500));
    } catch (e) { console.log(t.name, e.message); }
  }
}
db.close();
