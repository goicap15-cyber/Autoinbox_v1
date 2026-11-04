// Dump FULL HTML cua 2 row dau + tim phan tu dang "dot" (chi doc).
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
    rows.push({ id: m[1], lines: lines.slice(0, 4), html: row.outerHTML });
    if (rows.length >= 2) break;
  }
  // cac phan tu "dot": size nho, tron
  const dots = [...document.querySelectorAll('div')].filter((d) => {
    const st = getComputedStyle(d);
    const r = d.getBoundingClientRect();
    return r.width >= 6 && r.width <= 14 && r.height >= 6 && r.height <= 14
      && (st.borderRadius === '50%' || st.borderRadius === '9999px')
      && st.backgroundColor !== 'rgba(0, 0, 0, 0)';
  }).slice(0, 20).map((d) => {
    const r = d.getBoundingClientRect();
    let rowId = null;
    const rowEl = d.closest('a[href*="/messages/"]');
    if (rowEl) { const mm = (rowEl.getAttribute('href')||'').match(/t\\/([^\\/?#]+)/); rowId = mm ? mm[1] : null; }
    return { rowId, w: Math.round(r.width), h: Math.round(r.height), bg: getComputedStyle(d).backgroundColor, cls: String(d.className).substring(0, 100), html: d.outerHTML.substring(0, 160) };
  });
  return JSON.stringify({ title: document.title, rows, dots });
})()`;

async function main() {
  const targets = await getJson('/json/list');
  const tab = targets.find((t) => t.type === 'page' && /\/messages\/e2ee\/t\/7928489110551128/.test(t.url));
  if (!tab) { console.log('KHONG THAY TAB'); return; }
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (m, p) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.onmessage = (ev) => { const msg = JSON.parse(ev.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } };
  await new Promise((r) => (ws.onopen = r));
  const r = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (r.result?.exceptionDetails) { console.log('EXC:', JSON.stringify(r.result.exceptionDetails).substring(0, 400)); return; }
  const data = JSON.parse(r.result.result.value);
  console.log('TITLE:', data.title);
  console.log('=== DOTS (' + data.dots.length + ') ===');
  data.dots.forEach((d) => console.log(JSON.stringify(d)));
  for (const row of data.rows) {
    console.log('=== ROW ' + row.id + ' ' + JSON.stringify(row.lines));
    console.log(row.html.replace(/\s+/g, ' ').substring(0, 3500));
  }
  ws.close();
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
