const fs = require('fs');
const P = 'src/server/services/PageApiService.js';
let src = fs.readFileSync(P, 'utf8');
const NL = src.includes('\r\n') ? '\r\n' : '\n';

// 1) graphGet: thêm timeout 10s
const oldG = [
  'async function graphGet(path, params, database = getDb()) {',
  '  const url = new URL(`${GRAPH_BASE}/${path}`);',
  '  for (const [k, v] of Object.entries(params || {})) {',
  "    if (k !== 'access_token') url.searchParams.set(k, v);",
  '  }',
  "  url.searchParams.set('access_token', params.access_token);",
  "  const res = await fetch(url, { method: 'GET' });",
  '  const data = await res.json().catch(() => ({}));',
  '  return data;',
  '}',
].join(NL);
const newG = [
  'async function graphGet(path, params, database = getDb()) {',
  '  const url = new URL(`${GRAPH_BASE}/${path}`);',
  '  for (const [k, v] of Object.entries(params || {})) {',
  "    if (k !== 'access_token') url.searchParams.set(k, v);",
  '  }',
  "  url.searchParams.set('access_token', params.access_token);",
  '  // TIMEOUT B\u1EAET BU\u1ED8C: fetch treo (m\u1EA1ng ch\u1EE3p) kh\u00F4ng c\u00F3 timeout l\u00E0m watcher',
  '  // k\u1EB9t busy v\u0129nh vi\u1EC5n \u2014 m\u1ECDi chu k\u1EF3 sau b\u1ECB b\u1ECF (l\u1ED7i 2026-10-06)',
  "  const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(10000) });",
  '  const data = await res.json().catch(() => ({}));',
  '  return data;',
  '}',
].join(NL);
if (!src.includes(oldG)) { console.error('graphGet block not found'); process.exit(1); }
src = src.replace(oldG, newG);

// 2) watcher: tự mở khóa nếu chu kỳ trước treo quá 60s
const oldW = [
  '  pageWatcherTimer = setInterval(async () => {',
  '    if (pageWatcherBusy) return;',
  '    pageWatcherBusy = true;',
].join(NL);
const newW = [
  '  pageWatcherTimer = setInterval(async () => {',
  '    if (pageWatcherBusy) {',
  "      console.warn('[PageApi] Chu k\u1EF3 watcher tr\u01B0\u1EDBc ch\u01B0a xong sau 60s \u2014 m\u1EDF kh\u00F3a c\u01B0\u1EE1ng b\u1EE9c.');",
  '      pageWatcherBusy = false;',
  '    }',
  '    pageWatcherBusy = true;',
].join(NL);
if (!src.includes(oldW)) { console.error('watcher head not found'); process.exit(1); }
src = src.replace(oldW, newW);

// 3) sendPageMessage + message_attachments upload cũng thêm timeout
src = src.replace(
  "  const res = await fetch(`${GRAPH_BASE}/${source.external_id}/messages`, {\n    method: 'POST',",
  "  const res = await fetch(`${GRAPH_BASE}/${source.external_id}/messages`, {\n    method: 'POST',\n    signal: AbortSignal.timeout(20000),"
);

fs.writeFileSync(P, src);
console.log('timeouts + unlock added');
