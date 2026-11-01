// Theo dõi job user đang chạy; khi xong (success) thì trigger page-setup
// với appId MỚI NHẤT của account (user vừa tạo app mới có thể khác app cũ).
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const DB = path.join(process.env.APPDATA, 'autochatbot-fb-crm', 'data', 'database.db');
const BASE = 'http://127.0.0.1:5050';
const ACCOUNT_ID = '100066325187762';
const PAGE_IDS = ['683923444796165', '664031873456106'];
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
function appIdFromConfig() {
  const db = new DatabaseSync(DB, { readOnly: true });
  const row = db.prepare("SELECT value FROM page_api_config WHERE key = ?").get('account:' + ACCOUNT_ID);
  db.close();
  if (!row) return null;
  try {
    const v = JSON.parse(row.value);
    const apps = v.apps || [];
    return apps.length ? String(apps[apps.length - 1].appId) : null;
  } catch (_) { return null; }
}
async function main() {
  writeSession();
  try {
    let lastStatus = '';
    const deadline = Date.now() + 900000;
    while (Date.now() < deadline) {
      const r = await api('GET', '/api/page-api/sync-status');
      const job = r.json && r.json.job;
      if (!job) {
        console.log('[mon] no active job');
        break;
      }
      const line = job.status + ' | ' + (job.message || '').slice(0, 120);
      if (line !== lastStatus) { console.log('[mon]', job.sync_id.slice(0, 8), line); lastStatus = line; }
      if (['success', 'error', 'need_password', 'need_register_input'].includes(job.status)) {
        console.log('[mon] JOB END:', job.status, '-', (job.message || '').slice(0, 200));
        break;
      }
      await sleep(5000);
    }
    // dù user job kết thúc kiểu gì, thử trigger page-setup với appId mới nhất
    const appId = appIdFromConfig();
    console.log('[mon] latest appId từ config:', appId);
    if (!appId) { console.log('[mon] không có appId — bỏ trigger'); return; }
    const ps = await api('POST', `/api/page-api/accounts/${ACCOUNT_ID}/page-setup`, { appId, pageIds: PAGE_IDS });
    console.log('[mon] page-setup ->', ps.status, JSON.stringify(ps.json));
    const syncId = ps.json && ps.json.sync_id;
    if (!syncId) return;
    const jobDeadline = Date.now() + 900000;
    while (Date.now() < jobDeadline) {
      const r2 = await api('GET', '/api/page-api/sync-status?sync_id=' + syncId);
      const j2 = r2.json && r2.json.job;
      if (j2) console.log('[mon][ps]', j2.status, '|', (j2.message || '').slice(0, 140));
      if (j2 && ['success', 'error', 'need_password', 'need_register_input'].includes(j2.status)) {
        console.log('[mon][ps] FINAL:', JSON.stringify(j2, null, 1));
        return;
      }
      await sleep(3000);
    }
    console.log('[mon] TIMEOUT chờ page-setup');
  } finally {
    deleteSession();
  }
}
main().catch((e) => { console.error('[mon] crash:', e); deleteSession(); });
