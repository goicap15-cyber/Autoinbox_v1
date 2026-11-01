const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const dbPath = path.join(process.env.APPDATA, 'autochatbot-fb-crm', 'data', 'database.db');
const db = new DatabaseSync(dbPath, { readOnly: true });
const q = (sql, ...p) => db.prepare(sql).all(...p);
console.log('--- page_api_config ---');
for (const r of q(`SELECT key, substr(value,1,500) AS v FROM page_api_config`)) {
  console.log(r.key, '=>', r.v);
}
console.log('--- last runs ---');
console.log(JSON.stringify(q(`SELECT * FROM page_api_runs ORDER BY id DESC LIMIT 3`), null, 1));
