// Chẩn đoán subscription webhook của page — đọc token từ DB app, hỏi Facebook
const fs = require('fs');
try {
  const env = fs.readFileSync(require('path').resolve(__dirname, '../.env'), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
} catch (_) {}
const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const { decryptToken } = require('../src/server/utils/tokenEncryption');

const db = new Database(path.join(os.homedir(), 'AppData/Roaming/autochatbot-fb-crm/data/database.db'), { readonly: true });
const sources = db.prepare(`
  SELECT id, external_id, display_name, access_token_encrypted
  FROM inbox_sources WHERE source_type='page_messenger' AND access_token_encrypted IS NOT NULL
`).all();
db.close();

(async () => {
  for (const s of sources) {
    const token = decryptToken(s.access_token_encrypted);
    const pid = s.external_id;
    // 1. Page này đã đăng ký app chưa?
    const g = await fetch(`https://graph.facebook.com/v21.0/${pid}/subscribed_apps?access_token=${encodeURIComponent(token)}`).then(r => r.json());
    const apps = (g.data || []).map(a => a.id);
    console.log(`PAGE ${pid} (${s.display_name.slice(0, 30)}): subscribed_apps =`, apps.length ? apps.join(',') : 'KHÔNG CÓ');
    if (g.error) console.log('   lỗi GET:', g.error.message, '| code:', g.error.code);
    // 2. Token có quyền gì?
    const perms = await fetch(`https://graph.facebook.com/v21.0/me/permissions?access_token=${encodeURIComponent(token)}`).then(r => r.json());
    const granted = (perms.data || []).filter(p => p.status === 'granted').map(p => p.permission);
    console.log('   permissions granted:', granted.join(', ') || '(không đọc được)');
  }
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
