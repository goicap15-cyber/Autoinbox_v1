const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/database.db', { readOnly: true });
const rows = db.prepare(`
  SELECT external_id, owner_account_id, status, display_name, created_at
  FROM inbox_sources WHERE source_type = 'page_messenger' ORDER BY created_at DESC
`).all();
console.log('created_at         | ext_id            | owner        | name');
for (const r of rows) {
  console.log(String(r.created_at).padEnd(18), '|', String(r.external_id).padEnd(17), '|', String(r.owner_account_id ?? 'NULL').padEnd(12), '|', r.display_name.slice(0,40));
}
console.log('\nTong:', rows.length);
const byOwner = {};
for (const r of rows) { const k = r.owner_account_id ?? 'NULL'; byOwner[k] = (byOwner[k]||0)+1; }
console.log('Phan bo owner:', JSON.stringify(byOwner));
const recent = rows.filter(r => String(r.created_at) >= '2026-09-27 16:00');
console.log('\nTao sau 16:00 hom nay:', recent.length);
for (const r of recent) console.log('  ', r.external_id, '|', r.owner_account_id, '|', r.display_name);
