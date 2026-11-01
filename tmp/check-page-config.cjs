const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const db = new DatabaseSync(path.join(process.env.APPDATA, 'autochatbot-fb-crm', 'data', 'database.db'), { readOnly: true });
const rows = db.prepare(`SELECT key, substr(value,1,600) AS v, updated_at FROM page_api_config`).all();
console.log(JSON.stringify(rows, null, 1));
db.close();
