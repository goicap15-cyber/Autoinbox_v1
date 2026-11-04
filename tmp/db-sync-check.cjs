// Doc DB song (readOnly) - kiem tra sync con song khong trong luc Chrome bi che
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/database.db', { readOnly: true });

const t = (s) => {
  const n = Number(s);
  if (!n) return String(s || '');
  const d = new Date(n < 1e12 ? n * 1000 : n);
  return d.toISOString().replace('T', ' ').slice(0, 19);
};

const msgs5 = db.prepare("SELECT COUNT(*) c FROM messages WHERE created_at > ?").get(Date.now() - 5 * 60 * 1000).c;
const msgs15 = db.prepare("SELECT COUNT(*) c FROM messages WHERE created_at > ?").get(Date.now() - 15 * 60 * 1000).c;
const last = db.prepare("SELECT id, thread_id, is_outgoing, created_at, substr(replace(content, char(10), ' '), 1, 60) txt FROM messages ORDER BY created_at DESC LIMIT 5").all();
const upd = db.prepare("SELECT id, last_activity, substr(replace(last_message, char(10), ' '), 1, 50) lm FROM threads ORDER BY last_activity DESC LIMIT 5").all();

console.log(`msg moi 5p: ${msgs5} | 15p: ${msgs15}`);
console.log('--- 5 message moi nhat ---');
for (const m of last) console.log(`  ${t(m.created_at)} ${m.is_outgoing ? 'OUT' : 'IN '} ${m.thread_id} :: ${m.txt}`);
console.log('--- 5 thread cap nhat gan nhat ---');
for (const r of upd) console.log(`  ${t(r.last_activity)} ${r.id} :: ${r.lm}`);
db.close();
