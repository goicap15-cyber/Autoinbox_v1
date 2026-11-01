const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const DB_PATH = 'C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/database.db';
const LOG_PATH = 'C:\\Users\\Admin\\AppData\\Roaming\\autochatbot-fb-crm\\data\\composer-debug.log';
const fmt = (iso) => new Date(iso).toLocaleTimeString('vi-VN', { hour12: false });
const db = new DatabaseSync(DB_PATH, { readOnly: true });

let lastRowid = db.prepare('SELECT COALESCE(MAX(rowid),0) AS m FROM messages').get().m;
console.log(`[WATCH] start rowid=${lastRowid} ${new Date().toISOString()}`);

setInterval(() => {
  try {
    const rows = db.prepare(`
      SELECT rowid, id, thread_id, fb_message_id, client_message_id, content, is_outgoing, sender_role,
             datetime(timestamp_ms/1000, 'unixepoch') AS ts_utc
      FROM messages WHERE rowid > ? ORDER BY rowid
    `).all(lastRowid);
    for (const r of rows) {
      lastRowid = r.rowid;
      console.log(`[DB ${fmt(new Date().toISOString())}] #${r.id} t=${r.thread_id} ${r.is_outgoing ? 'OUT' : 'IN'}${r.sender_role === 'operator' ? '(op)' : ''} mid=${String(r.fb_message_id || '').substring(0, 46)} ts=${r.ts_utc} ${JSON.stringify(String(r.content || '').substring(0, 26))}`);
    }
  } catch (e) {
    console.log('[WATCH] db err', String(e.message).substring(0, 80));
  }
}, 3000);

let logSize = 0;
try { logSize = fs.statSync(LOG_PATH).size; } catch (_) {}
setInterval(() => {
  try {
    const st = fs.statSync(LOG_PATH);
    if (st.size < logSize) logSize = 0;
    if (st.size === logSize) return;
    const fd = fs.openSync(LOG_PATH, 'r');
    const buf = Buffer.alloc(st.size - logSize);
    fs.readSync(fd, buf, 0, buf.length, logSize);
    fs.closeSync(fd);
    logSize = st.size;
    const text = buf.toString('utf8');
    for (const line of text.split('\n')) {
      if (!line.includes('"kind":"obs"') && !line.includes('NEW_MESSAGE_RECEIVED') && !line.includes('Blocked duplicate') && !line.includes('Correlating ambiguous')) continue;
      try {
        const j = JSON.parse(line);
        if (j.kind === 'obs') {
          console.log(`[OBS ${j.at}] ${j.stage} t=${j.thread || ''} id=${String(j.id || '').substring(0, 44)} ${JSON.stringify(String(j.content || '').substring(0, 24))}`);
        } else {
          console.log(`[SRV ${j.at}] ${j.stage || ''} ${line.substring(0, 160)}`);
        }
      } catch (_) {
        if (line.includes('NEW_MESSAGE_RECEIVED') || line.includes('Blocked duplicate') || line.includes('Correlating ambiguous')) {
          console.log(`[RAW] ${line.substring(0, 180)}`);
        }
      }
    }
  } catch (_) {}
}, 2000);
