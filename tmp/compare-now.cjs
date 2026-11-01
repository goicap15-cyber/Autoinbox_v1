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
console.log('=== DB: 5 tin page mới nhất ===');
for (const m of db.prepare("SELECT m.id, m.content, m.is_outgoing, m.created_at FROM messages m JOIN threads t ON t.id=m.thread_id WHERE t.source_id LIKE 'src_page%' ORDER BY m.id DESC LIMIT 5").all())
  console.log(' ', m.id, '| out:', m.is_outgoing, '|', m.created_at, '|', JSON.stringify((m.content||'').slice(0,25)));

console.log('=== GRAPH: tin mới nhất trên Facebook (theo token từng page) ===');
const srcs = db.prepare("SELECT id, external_id, display_name, access_token_encrypted FROM inbox_sources WHERE source_type='page_messenger' AND access_token_encrypted IS NOT NULL").all();
db.close();

(async () => {
  for (const s of srcs) {
    const token = decryptToken(s.access_token_encrypted);
    const convs = await fetch('https://graph.facebook.com/v21.0/' + s.external_id + '/conversations?fields=id,updated_time,message_count&limit=3&access_token=' + encodeURIComponent(token)).then(r => r.json()).catch(() => ({}));
    if (convs.error) { console.log('PAGE', s.external_id, '→ lỗi:', convs.error.message); continue; }
    for (const c of (convs.data || [])) {
      const msgs = await fetch('https://graph.facebook.com/v21.0/' + c.id + '/messages?fields=id,message,from,created_time&limit=3&access_token=' + encodeURIComponent(token)).then(r => r.json()).catch(() => ({}));
      console.log('PAGE', s.external_id, '| conv', c.id, '| updated:', c.updated_time, '| count:', c.message_count);
      for (const m of (msgs.data || []).slice(0, 3)) {
        console.log('   -', m.created_time, '| from:', m.from?.id, '|', JSON.stringify((m.message || '[media]').slice(0, 30)));
      }
    }
  }
  process.exit(0);
})();
