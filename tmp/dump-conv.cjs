const fs = require('fs');
try {
  const env = fs.readFileSync(require('path').resolve('.env'), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
} catch (_) {}
const Database = require('better-sqlite3');
const os = require('os'); const path = require('path');
const { decryptToken } = require('../src/server/utils/tokenEncryption');
const db = new Database(path.join(os.homedir(), 'AppData/Roaming/autochatbot-fb-crm/data/database.db'), { readonly: true });
const s = db.prepare("SELECT id, external_id, access_token_encrypted FROM inbox_sources WHERE external_id='683923444796165'").get();
const token = decryptToken(s.access_token_encrypted);

(async () => {
  // 1. Danh sách hội thoại của page
  const convs = await fetch('https://graph.facebook.com/v21.0/' + s.external_id + '/conversations?fields=id,updated_time,participants&limit=5&access_token=' + encodeURIComponent(token)).then(r => r.json());
  if (convs.error) { console.log('conversations lỗi:', convs.error.message); process.exit(1); }
  for (const c of (convs.data || [])) {
    const psid = (c.participants?.data || []).find((p) => p.id !== s.external_id)?.id;
    console.log('CONV:', c.id, '| updated_time:', c.updated_time, '| psid:', psid);
    // 2. Tin nhắn gần nhất của hội thoại
    const msgs = await fetch('https://graph.facebook.com/v21.0/' + c.id + '/messages?fields=id,message,from,created_time&limit=10&access_token=' + encodeURIComponent(token)).then(r => r.json());
    if (msgs.error) { console.log('   messages lỗi:', msgs.error.message); continue; }
    for (const m of (msgs.data || []).slice(0, 10)) {
      console.log('   -', m.created_time, '| from:', m.from?.id, '|', JSON.stringify((m.message || '[không có text]').slice(0, 30)));
    }
  }
  process.exit(0);
})();
