const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/database.db', { readOnly: true });

for (const t of ['accounts', 'threads', 'messages', 'sources', 'unread_state', 'sidebar_preview']) {
  try {
    const fks = db.prepare(`PRAGMA foreign_key_list(${t})`).all();
    console.log(`\n=== ${t} FKs ===`);
    if (!fks.length) console.log('(none)');
    for (const fk of fks) console.log(`  ${fk.from} -> ${fk.table}.${fk.to} on_delete=${fk.on_delete}`);
  } catch (e) { console.log(`\n=== ${t}: ${e.message}`); }
}

// account existence check
const acct = db.prepare('SELECT id, name, status FROM accounts').all();
console.log('\n=== accounts ===');
for (const a of acct) console.log(`  ${a.id} ${a.status} ${a.name}`);

// orphan threads: thread referencing missing account
try {
  const orphanAcct = db.prepare(`SELECT COUNT(*) c FROM threads t LEFT JOIN accounts a ON a.id = t.account_id WHERE a.id IS NULL`).get();
  console.log('\nthreads with missing account_id:', orphanAcct.c);
} catch (e) { console.log('threads.account_id orphan check:', e.message); }
try {
  const orphanMsg = db.prepare(`SELECT COUNT(*) c FROM messages m LEFT JOIN threads t ON t.thread_id = m.thread_id WHERE t.thread_id IS NULL`).get();
  console.log('messages with missing thread_id:', orphanMsg.c);
} catch (e) { console.log('messages orphan check:', e.message); }
try {
  const orphanSrc = db.prepare(`SELECT COUNT(*) c FROM threads t LEFT JOIN sources s ON s.id = t.source_id WHERE s.id IS NULL AND t.source_id IS NOT NULL`).get();
  console.log('threads with missing source_id:', orphanSrc.c);
} catch (e) { console.log('source orphan check:', e.message); }

db.close();
