const Database = require('better-sqlite3');
const db = new Database('C:\Users\Admin\AppData\Roaming\autochatbot-fb-crm\data\database.db', { readonly: true });
const rows = db.prepare(`SELECT id, account_id, contact_name, last_activity FROM threads ORDER BY julianday(last_activity) DESC LIMIT 5`).all();
console.log(JSON.stringify(rows, null, 1));
db.close();
