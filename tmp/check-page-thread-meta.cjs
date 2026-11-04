const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const dbPath = path.join(process.env.APPDATA, 'autochatbot-fb-crm', 'data', 'database.db');
const db = new DatabaseSync(dbPath, { readOnly: true });
const rows = db.prepare(`SELECT id, source_type, page_id, account_id, contact_name, is_unread, last_activity FROM threads WHERE id LIKE '615%' OR source_type LIKE '%page%' ORDER BY last_activity DESC LIMIT 20`).all();
console.log(JSON.stringify(rows, null, 1));
const pages = db.prepare(`SELECT * FROM pages LIMIT 10`).all().catch === undefined ? null : null;
db.close();
