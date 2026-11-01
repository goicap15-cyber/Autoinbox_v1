// Do DOM that cua sidebar Messenger tren tab dang song (chi doc).
const http = require('http');
const PORT = 59582;

function getJson(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path }, (res) => {
      let s = '';
      res.on('data', (d) => (s += d));
      res.on('end', () => { try { resolve(JSON.parse(s)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

const EXPR = `(() => {
  const norm = (v) => String(v || '').replace(/\\s+/g, ' ').trim();
  const links = [...document.querySelectorAll('a[href*="/messages/t/"], a[href*="/messages/e2ee/t/"]')];
  const seen = new Set();
  const rows = [];
  for (const link of links) {
    const href = link.getAttribute('href') || '';
    const m = href.match(/\\/messages\\/(?:e2ee\\/)?t\\/([^\\/?#]+)/);
    if (!m || seen.has(m[1])) continue;
    seen.add(m[1]);
    const row = link.closest('[role="row"], [role="listitem"], li') || link.parentElement || link;
    const lines = String(row.innerText || '').split(/\\n+/).map(norm).filter(Boolean);
    rows.push({
      id: m[1],
      lines: lines.slice(0, 5),
      boldSpans: row.querySelectorAll('[style*="font-weight"], [class*="Bold"], b, strong').length,
      htmlTail: row.innerHTML.length > 1200 ? row.innerHTML.slice(-1200) : row.innerHTML
    });
    if (rows.length >= 6) break;
  }
  const counts = {
    unreadCountTestid: document.querySelectorAll('[data-testid="unread-count"]').length,
    classUnread: document.querySelectorAll('.unread').length,
    ariaUnreadEn: [...document.querySelectorAll('[aria-label]')].filter((e) => /unread/i.test(e.getAttribute('aria-label'))).length,
    ariaChuaDoc: [...document.querySelectorAll('[aria-label]')].filter((e) => /chưa đọc/i.test(e.getAttribute('aria-label'))).length,
    ariaChuaDocSample: [...document.querySelectorAll('[aria-label]')].filter((e) => /chưa đọc/i.test(e.getAttribute('aria-label'))).slice(0, 3).map((e) => ({ tag: e.tagName, label: e.getAttribute('aria-label').substring(0, 60), cls: String(e.className).substring(0, 80), html: e.outerHTML.substring(0, 200) }))
  };
  return JSON.stringify({ rowCount: links.length, rows, counts });
})()`;

async function main() {
  const targets = await getJson('/json/list');
  const tab = targets.find((t) => t.type === 'page' && /\/messages\/e2ee\/t\/7928489110551128/.test(t.url))
    || targets.find((t) => t.type === 'page' && /\/messages\//.test(t.url));
  if (!tab) { console.log('KHONG THAY TAB MESSENGER'); return; }
  console.log('TAB:', tab.url.substring(0, 80));
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (m, p) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.onmessage = (ev) => { const msg = JSON.parse(ev.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } };
  await new Promise((r) => (ws.onopen = r));
  const r = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (r.result?.exceptionDetails) { console.log('EXC:', JSON.stringify(r.result.exceptionDetails).substring(0, 400)); return; }
  const data = JSON.parse(r.result.result.value);
  console.log('TONG LINK:', data.rowCount);
  console.log('COUNTS:', JSON.stringify(data.counts, null, 1));
  for (const row of data.rows) {
    console.log('--- ROW ' + row.id + ' bold=' + row.boldSpans);
    console.log('  lines:', JSON.stringify(row.lines));
    console.log('  htmlTail:', row.htmlTail.replace(/\s+/g, ' ').substring(0, 900));
  }
  ws.close();
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
