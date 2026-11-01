const Database = require('better-sqlite3');
const os = require('os'); const path = require('path');
const db = new Database(path.join(os.homedir(), 'AppData/Roaming/autochatbot-fb-crm/data/database.db'), { readonly: true });
let lastId = Number(process.argv[2] || 499491);
console.log('BAT DAU GIAM SAT — baseline id=' + lastId + ' — ' + new Date().toISOString());
let seen = 0;
for (let i = 0; i < 18; i++) {
  const rows = db.prepare("SELECT m.id, m.content, m.is_outgoing, m.created_at FROM messages m JOIN threads t ON t.id=m.thread_id WHERE t.source_id LIKE 'src_page%' AND m.id > ? ORDER BY m.id ASC").all(lastId);
  for (const m of rows) {
    seen++;
    console.log('[' + new Date().toISOString() + '] TIN MOI #' + m.id + ' | ' + (m.is_outgoing ? 'OPERATOR' : 'KHACH') + ' | ' + JSON.stringify((m.content || '[media/attach]').slice(0, 30)) + ' | tao_luc: ' + m.created_at);
    lastId = m.id;
  }
  if (i < 17) await new Promise((r) => setTimeout(r, 10000));
}
console.log('KET THUC GIAM SAT — tong tin moi: ' + seen);
process.exit(0);
