const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const db = new DatabaseSync(path.join(process.env.APPDATA, 'autochatbot-fb-crm', 'data', 'database.db'), { readOnly: true });
const rows = db.prepare("SELECT key, substr(value,1,900) AS v FROM page_api_config WHERE key LIKE 'account:%'").all();
for (const r of rows) {
  console.log('==', r.key, '==');
  console.log(r.v.replace(/\/g, ''));
  console.log('');
}
