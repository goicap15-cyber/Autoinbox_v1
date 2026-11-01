const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/database.db', { readOnly: true });

console.log('=== Pages IN DATABASE ===');
const inDb = db.prepare(`
  SELECT id, external_id, display_name, owner_account_id 
  FROM inbox_sources 
  WHERE source_type = 'page_messenger' 
    AND (owner_account_id IS NULL OR owner_account_id = '100091572376716')
  ORDER BY external_id
`).all();
inDb.forEach(r => console.log(`${r.external_id.padEnd(16)} | ${r.display_name}`));
console.log(`\nTotal in DB: ${inDb.length}\n`);

console.log('=== Accounts ===');
const acc = db.prepare("SELECT * FROM accounts WHERE id = '100091572376716'").get();
console.log(JSON.stringify(acc, null, 1));
