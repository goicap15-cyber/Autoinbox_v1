const Database = require('better-sqlite3');
const db = new Database(process.env.APPDATA + '/autochatbot-fb-crm/data/database.db', { readonly: true, fileMustExist: true });
console.log(db.prepare("PRAGMA table_info(accounts)").all().map((c) => c.name).join(', '));
for (const r of db.prepare("SELECT * FROM accounts WHERE id IN ('100066325187762','100012928383139')").all()) {
  console.log(JSON.stringify(r));
}
console.log('--- inbox_sources personal ---');
for (const r of db.prepare("SELECT id, source_type, external_id, owner_account_id, created_at, updated_at FROM inbox_sources WHERE source_type='personal_messenger'").all()) {
  console.log(JSON.stringify(r));
}
db.close();
