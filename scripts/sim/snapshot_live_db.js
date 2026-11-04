const Database = require('better-sqlite3');
const out = process.argv[2];
const src = new Database(process.argv[3], { readonly: true, fileMustExist: true });
try {
  const before = {
    threads: src.prepare('SELECT COUNT(*) AS c FROM threads').get().c,
    messages: src.prepare('SELECT COUNT(*) AS c FROM messages').get().c,
    pageSources: src.prepare("SELECT COUNT(*) AS c FROM inbox_sources WHERE source_type='page_messenger'").get().c,
  };
  src.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
  const chk = new Database(out, { readonly: true });
  const after = {
    threads: chk.prepare('SELECT COUNT(*) AS c FROM threads').get().c,
    messages: chk.prepare('SELECT COUNT(*) AS c FROM messages').get().c,
    pageSources: chk.prepare("SELECT COUNT(*) AS c FROM inbox_sources WHERE source_type='page_messenger'").get().c,
  };
  chk.close();
  console.log('[SNAPSHOT] before=' + JSON.stringify(before) + ' after=' + JSON.stringify(after));
  if (before.threads !== after.threads || before.messages !== after.messages) {
    throw new Error('Snapshot không khớp nguồn');
  }
} finally {
  src.close();
}
console.log('[SNAPSHOT] OK: ' + out);
