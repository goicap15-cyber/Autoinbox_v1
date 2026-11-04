// Probe Viet Seeding scan endpoint bằng key trong KV của DB sống (readonly).
// KHÔNG in key ra output — chỉ in HTTP status + body.
const path = require('path');
const Database = require('better-sqlite3');

const DB = process.env.APPDATA + '/autochatbot-fb-crm/data/database.db';
const POST_URL = process.argv[2] || 'https://www.facebook.com/share/p/19iW5fD31e/';

async function main() {
  const db = new Database(DB, { readonly: true, fileMustExist: true });
  const row = db.prepare("SELECT value FROM page_api_config WHERE key = 'vietseeding:global'").get();
  db.close();
  if (!row) { console.log('KV khong co vietseeding:global'); process.exit(2); }
  const cfg = JSON.parse(row.value);
  const key = String(cfg.api_key || '').trim();
  console.log('key mask:', key ? key.slice(0, 6) + '...' + key.slice(-4) + ' (len=' + key.length + ')' : '(TRONG!)');
  if (!key) process.exit(2);

  const res = await fetch('https://api.vietseeding.com/api/export/comment-leads/by-post/scan', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: POST_URL })
  });
  const text = await res.text();
  console.log('POST /scan ->', 'HTTP', res.status, text.slice(0, 400));

  if (res.status !== 200 && res.status !== 202) {
    const res2 = await fetch('https://api.vietseeding.com/api/export/comment-leads/by-post?url=' + encodeURIComponent(POST_URL) + '&limit=5&offset=0', {
      headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' }
    });
    const t2 = await res2.text();
    console.log('GET /by-post ->', 'HTTP', res2.status, t2.slice(0, 300));
  }
}
main().catch((e) => { console.log('LOI:', e.message); process.exit(1); });
