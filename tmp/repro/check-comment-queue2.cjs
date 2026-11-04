const Database = require('better-sqlite3');
const db = new Database(process.env.APPDATA + '/autochatbot-fb-crm/data/database.db', { readonly: true, fileMustExist: true });

console.log('--- message_queue columns ---');
console.log(db.prepare("PRAGMA table_info(message_queue)").all().map((c) => c.name).join(', '));

console.log('--- queue rows cho comment leads ---');
for (const r of db.prepare("SELECT * FROM message_queue WHERE idempotency_key LIKE 'comment_lead_%' ORDER BY created_at DESC LIMIT 14").all()) {
  const { id, status, account_id, dispatch_status, error_reason, attempts, created_at, updated_at, next_attempt_at } = r;
  console.log(JSON.stringify({ id, status, account_id, dispatch_status, error_reason, attempts, created_at, updated_at, next_attempt_at }));
}

console.log('--- tổng theo status ---');
console.log(db.prepare("SELECT status, COUNT(*) n FROM message_queue GROUP BY status").all());
db.close();
