const Database = require('better-sqlite3');
const db = new Database(process.env.APPDATA + '/autochatbot-fb-crm/data/database.db', { readonly: true, fileMustExist: true });

console.log('--- comment_leads theo status ---');
console.log(db.prepare("SELECT status, COUNT(*) n FROM comment_leads GROUP BY status").all());

console.log('--- comment_leads mới nhất (12 row) ---');
for (const r of db.prepare("SELECT id, author_name, status, account_id, queued_at, sent_at, substr(error,1,60) err FROM comment_leads ORDER BY created_at DESC LIMIT 14").all()) {
  console.log(JSON.stringify(r));
}

console.log('--- message_queue personal_messenger gần nhất ---');
for (const r of db.prepare("SELECT id, status, source_type, account_id, error_reason, attempt_count, created_at, updated_at FROM message_queue WHERE source_type LIKE 'personal%' ORDER BY created_at DESC LIMIT 14").all()) {
  console.log(JSON.stringify(r));
}
db.close();
