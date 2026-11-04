const fs = require('fs');
const P = 'src/server/services/PageApiService.js';
let src = fs.readFileSync(P, 'utf8');
const NL = src.includes('\r\n') ? '\r\n' : '\n';
const OLD = [
  '    if (p.token && /^EA[A-Za-z0-9_-]{20,}/.test(p.token)) {',
  "      database.prepare(\"UPDATE inbox_sources SET access_token_encrypted = ?, status = 'ACTIVE' WHERE id = ?\")",
  '        .run(encryptToken(p.token), existing.id);',
  '      console.log(`[PageApi] \u{1F510} \u0110\u00E3 l\u01B0u Page Access Token cho page ${p.pageId}`);',
  '    }',
].join(NL);
const NEW = [
  '    if (p.token && /^EA[A-Za-z0-9_-]{20,}/.test(p.token)) {',
  '      // G\u1EAFn lu\u00F4n owner theo account ch\u1EA1y L\u1EA5y token \u2014 kh\u00F4ng \u0111\u1EC3 page c\u00F3 token m\u00E0 m\u1ED3 c\u00F4i',
  '      // (owner NULL l\u00E0m watcher/webhook kh\u00F4ng bi\u1EBF tin v\u1EC1 account n\u00E0o \u2014 l\u1ED7i 2026-10-06)',
  '      database.prepare("UPDATE inbox_sources SET access_token_encrypted = ?, status = \'ACTIVE\', owner_account_id = COALESCE(owner_account_id, ?) WHERE id = ?")',
  '        .run(encryptToken(p.token), accountId || null, existing.id);',
  '      console.log(`[PageApi] \u{1F510} \u0110\u00E3 l\u01B0u Page Access Token cho page ${p.pageId} (owner: ${accountId || existing.owner_account_id})`);',
  '    }',
].join(NL);
if (!src.includes(OLD)) { console.error('savePages token block not found'); process.exit(1); }
src = src.replace(OLD, NEW);
fs.writeFileSync(P, src);
console.log('savePages owner-bind added');
