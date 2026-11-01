const fs = require('fs');
const P = 'src/server/services/PageApiService.js';
let src = fs.readFileSync(P, 'utf8');
const NL = src.includes('\r\n') ? '\r\n' : '\n';

// 0) verify file intact (chưa bị generator hỏng)
if (src.split('function processMessagingEvent').length - 1 !== 1) {
  console.error('UNEXPECTED: processMessagingEvent count != 1 — dừng để kiểm tra tay');
  process.exit(1);
}

// 1) helper findAccountForPage (nếu chưa có)
if (!src.includes('function findAccountForPage')) {
  const helper = [
    '// Đa page / đa account: tra pageId thuộc app của account nào (page_api_config)',
    'function findAccountForPage(pageId, database = getDb()) {',
    "  const rows = database.prepare(\"SELECT key, value FROM page_api_config WHERE key LIKE 'account:%'\").all();",
    '  for (const r of rows) {',
    '    try {',
    '      const j = JSON.parse(r.value);',
    '      for (const app of (j.apps || [])) {',
    '        if ((app.pages || []).some((p) => String(p.pageId) === String(pageId))) {',
    "          return r.key.slice('account:'.length);",
    '        }',
    '      }',
    '    } catch (_) {}',
    '  }',
    '  return null;',
    '}',
    '',
  ].join(NL);
  const anchor = 'function handleWebhookBody(body, io, database = getDb()) {';
  if (!src.includes(anchor)) { console.error('handleWebhookBody anchor not found'); process.exit(1); }
  src = src.replace(anchor, helper + NL + anchor);
}

// 2) owner resolution: config trước, single-active sau
const lines = src.split(NL);
// tìm khối: 'if (source && !source.owner_account_id) {' ... '}' (7 dòng) chứa 'activeAccounts'
const oi = lines.findIndex((l) => l.includes('if (source && !source.owner_account_id) {'));
if (oi >= 0 && lines.slice(oi, oi + 9).some((l) => l.includes('activeAccounts'))) {
  const endBlock = lines.findIndex((l, i) => i > oi && l.trim() === '}' && lines.slice(oi, i).some((x) => x.includes('activeAccounts')));
  const resolved = [
    lines[oi].replace('!source.owner_account_id', '!source.owner_account_id'),
    "    const resolved = findAccountForPage(pageId, database) || (() => { const a = database.prepare(\"SELECT id FROM accounts WHERE status = 'ACTIVE' OR status IS NULL\").all(); return a.length === 1 ? String(a[0].id) : null; })();",
    '    if (resolved) {',
    "      database.prepare('UPDATE inbox_sources SET owner_account_id = ? WHERE id = ? AND owner_account_id IS NULL')",
    '        .run(String(resolved), source.id);',
    "      console.log('[PageApi] 🔗 Tự gắn owner ' + resolved + ' cho page ' + pageId);",
    '    }',
    lines[endBlock],
  ];
  lines.splice(oi, endBlock - oi + 1, ...resolved);
  console.log('owner resolution upgraded');
} else if (oi >= 0) {
  console.log('owner block đã mới hoặc không tìm thấy activeAccounts — bỏ qua');
}

// 3) thay processMessagingEvent bằng bản mới (từ file)
const newFn = fs.readFileSync('tmp/new-process-messaging-event.js', 'utf8').replace(/\n$/, '');
const sIdx = lines.findIndex((l) => l.startsWith('function processMessagingEvent'));
const eIdx = lines.findIndex((l) => l.includes('── Poller cầu nối hosting'));
if (sIdx < 0 || eIdx < 0 || eIdx <= sIdx) { console.error('fn markers not found', { sIdx, eIdx }); process.exit(1); }
lines.splice(sIdx, eIdx - sIdx, ...newFn.split('\n'));

fs.writeFileSync(P, lines.join(NL));
console.log('spliced OK');
