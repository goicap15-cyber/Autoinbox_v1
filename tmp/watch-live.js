const { DatabaseSync } = require('node:sqlite');
const DB = 'C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/database.db';
const COL = { facebook_payload: '\x1b[32m', dom_order: '\x1b[33m', dom_clock_order: '\x1b[33m', facebook_label: '\x1b[36m', realtime_fallback: '\x1b[35m' };
const RST = '\x1b[0m';

function open() {
  try { return new DatabaseSync(DB, { readOnly: true }); } catch (_) { return null; }
}

let db = open();
if (!db) { console.log('DB not open yet, will retry'); }
let lastId = 0;
try { lastId = db.prepare('SELECT MAX(id) AS m FROM messages').get().m || 0; } catch (_) {}
console.log(`[WATCH] baseline id=${lastId} - canh tin moi + facebook_payload ...`);

const nameCache = new Map();
function threadName(dbx, tid) {
  if (!tid) return '?';
  if (nameCache.has(String(tid))) return nameCache.get(String(tid));
  let n = '?';
  try { n = dbx.prepare('SELECT contact_name FROM threads WHERE id = ?').get(String(tid))?.contact_name || '?'; } catch (_) {}
  nameCache.set(String(tid), n);
  return n;
}

setInterval(() => {
  const dbx = open();
  if (!dbx) { console.log('.'); return; }
  let rows = [];
  try {
    rows = dbx.prepare('SELECT * FROM messages WHERE id > ? ORDER BY id ASC').all(lastId);
  } catch (_) { return; }
  for (const r of rows) {
    lastId = r.id;
    const color = COL[r.timestamp_source] || '';
    const ts = r.timestamp_ms > 0 ? new Date(Number(r.timestamp_ms)).toLocaleTimeString('vi-VN') : '?';
    const media = r.media_type !== 'text' ? ` [${r.media_type}${r.media_url ? ' URL' : ' noURL'}]` : '';
    const src = r.timestamp_source;
    const who = r.is_outgoing ? 'OUT' : 'IN ';
    const content = (r.content || '').substring(0, 40);
    console.log(`${color}#${r.id} ${new Date().toLocaleTimeString('vi-VN')} ${who} src=${src}${RST} thr=${threadName(dbx, r.thread_id)} ts=${ts}${media} "${content}"`);
  }
  try { dbx.close(); } catch (_) {}
}, 3000);
