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
const srcs = db.prepare("SELECT id, external_id, display_name, access_token_encrypted FROM inbox_sources WHERE source_type='page_messenger' AND access_token_encrypted IS NOT NULL").all();
db.close();

(async () => {
  for (const s of srcs) {
    let token;
    try { token = decryptToken(s.access_token_encrypted); } catch (e) { console.log(s.external_id, '→ DECRYPT LỖI:', e.message); continue; }
    const me = await fetch('https://graph.facebook.com/v21.0/me?fields=id,name&access_token=' + encodeURIComponent(token)).then(r => r.json()).catch(() => ({}));
    if (me.error) {
      console.log(`PAGE ${s.external_id} (${s.display_name}): TOKEN CHẾT — ${me.error.message} (code ${me.error.code})`);
    } else {
      console.log(`PAGE ${s.external_id} (${s.display_name}): token OK — page=${me.id} "${me.name}"`);
      const conv = await fetch('https://graph.facebook.com/v21.0/' + me.id + '/conversations?fields=id,updated_time&limit=3&access_token=' + encodeURIComponent(token)).then(r => r.json()).catch(() => ({}));
      if (conv.error) console.log('   conversations lỗi:', conv.error.message);
      else console.log('   conversations OK:', (conv.data || []).length, 'hội thoại gần nhất, updated_time mới nhất:', conv.data?.[0]?.updated_time || '-');
    }
  }
  process.exit(0);
})();
