const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const db = new DatabaseSync(path.join(process.env.APPDATA, 'autochatbot-fb-crm', 'data', 'database.db'), { readOnly: true });
console.log('USERS:', JSON.stringify(db.prepare(`SELECT id, username, role, company_role FROM users`).all(), null, 1));
console.log('SESSION COLS:', db.prepare("PRAGMA table_info(auth_sessions)").all().map(c => c.name).join(','));
db.close();
