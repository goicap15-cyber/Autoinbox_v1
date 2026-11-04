const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const DB = path.join(process.env.APPDATA, 'autochatbot-fb-crm', 'data', 'database.db');
const BASE = 'http://127.0.0.1:5050';
const token = crypto.randomBytes(32).toString('base64url');
const hash = crypto.createHash('sha256').update(token).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function writeSession() {
  const db = new DatabaseSync(DB);
  db.exec('PRAGMA busy_timeout = 10000');
  db.prepare("INSERT INTO auth_sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)")
    .run(15, hash, new Date(Date.now() + 7 * 86400000).toISOString());
  db.close();
}
function deleteSession() {
  try {
    const db = new DatabaseSync(DB);
    db.exec('PRAGMA busy_timeout = 10000');
    db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(hash);
    db.close();
  } catch (_) {}
}
async function api(method, pathname, body) {
  const res = await fetch(BASE + pathname, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: 'crm_session=' + token },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, json };
}
async function main() {
  writeSession();
  try {
    const ps = await api('POST', '/api/page-api/accounts/100066325187762/page-setup', {
      appId: '2513578042460915', pageIds: ['683923444796165', '664031873456106'],
    });
    console.log('[rerun] page-setup ->', ps.status, JSON.stringify(ps.json));
    const syncId = ps.json && ps.json.sync_id;
    if (!syncId) return;
    const deadline = Date.now() + 900000;
    while (Date.now() < deadline) {
      const r = await api('GET', '/api/page-api/sync-status?sync_id=' + syncId);
      const job = r.json && r.json.job;
      if (job) console.log('[rerun]', job.status, '|', (job.message || '').slice(0, 140));
      if (job && ['success', 'error', 'need_password', 'need_register_input'].includes(job.status)) {
        console.log('[rerun] FINAL:', JSON.stringify(job, null, 1));
        return;
      }
      await sleep(3000);
    }
    console.log('[rerun] TIMEOUT');
  } finally {
    deleteSession();
  }
}
main().catch((e) => { console.error('[rerun] crash:', e); deleteSession(); });
