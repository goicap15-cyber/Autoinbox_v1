const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/database.db', { readOnly: true });
console.log('ext_id            | owner                      | status   | name');
const rows = db.prepare(`
  SELECT external_id, owner_account_id, status, display_name
  FROM inbox_sources WHERE source_type = 'page_messenger' ORDER BY external_id
`).all();
for (const r of rows) {
  console.log(String(r.external_id).padEnd(17), '|', String(r.owner_account_id ?? 'NULL').padEnd(26), '|', r.status.padEnd(8), '|', r.display_name);
}
console.log('\nTổng:', rows.length);
const nullOwner = rows.filter(r => r.owner_account_id == null);
console.log('Owner NULL:', nullOwner.length, '->', nullOwner.map(r => r.display_name).join(' ; '));
const otherOwner = rows.filter(r => r.owner_account_id && r.owner_account_id !== '100091572376716');
console.log('Owner khác:', otherOwner.length, '->', otherOwner.map(r => `${r.external_id}(${r.owner_account_id})`).join(' ; '));
