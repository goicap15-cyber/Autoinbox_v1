const Database = require('better-sqlite3');
const db = new Database(process.env.APPDATA + '/autochatbot-fb-crm/data/database.db', { readonly: true, fileMustExist: true });

const tids = ['61575269172855','100030988800938','100035611244751','100000508710713','100067849497230','100009656656633','100010024174513','100008200668802','100000163018234','100047602787963','100024636332556','100001606783709','61585076393386'];
console.log('--- threads ton tai? ---');
for (const t of tids) {
  const row = db.prepare('SELECT id, account_id, pinned, last_activity FROM threads WHERE id = ?').get(t);
  console.log(t, row ? JSON.stringify(row) : 'BI MAT');
}

console.log('--- foreign_keys pragma hien tai (connection moi) ---');
console.log(db.prepare('PRAGMA foreign_keys').get());

console.log('--- messages pending cua 5 thread do ---');
for (const t of ['61575269172855','100030988800938','100035611244751','100000508710713','100067849497230']) {
  const n = db.prepare("SELECT COUNT(*) n FROM messages WHERE thread_id = ? AND client_message_id LIKE 'queue_%'").get(t);
  console.log(t, 'queue_ messages:', n.n);
}
db.close();
