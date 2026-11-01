const Database = require('better-sqlite3');
const db = new Database(process.argv[2], { readonly: true, fileMustExist: true });
const rows = db.prepare(`
  SELECT content, COUNT(*) AS c FROM messages
  WHERE content LIKE '%trả lời một quảng cáo%' OR content LIKE '%trả lời quảng cáo%'
  GROUP BY content ORDER BY c DESC LIMIT 10
`).all();
let total = 0;
const RE = /^\s*\S.{0,120}\sđã trả lời (?:một )?quảng cáo\.?\s*$/i;
for (const r of rows) {
  const match = RE.test(String(r.content || '').trim());
  total += match ? r.c : 0;
  console.log((match ? 'MATCH   ' : 'NO-MATCH') + ' x' + r.c + '  ' + JSON.stringify(r.content).slice(0, 90));
}
console.log('Tổng khớp regex: ' + total);
db.close();
