const Database = require('better-sqlite3');
const paths = process.argv.slice(2);
for (const p of paths) {
  try {
    const db = new Database(p, { readonly: true, fileMustExist: true });
    const t = db.prepare('SELECT COUNT(*) AS c FROM threads').get().c;
    const m = db.prepare('SELECT COUNT(*) AS c FROM messages').get().c;
    let s = 'n/a';
    try { s = db.prepare("SELECT COUNT(*) AS c FROM inbox_sources WHERE source_type='page_messenger'").get().c; } catch (_) {}
    console.log(p + '  threads=' + t + ' messages=' + m + ' pageSources=' + s);
    db.close();
  } catch (e) {
    console.log(p + '  ERROR: ' + e.message);
  }
}
