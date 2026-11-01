const http = require('http');

function getJson(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: 59267, path }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function main() {
  const list = await getJson('/json/list');
  const tab = list.find((t) => t.type === 'page' && /\/messages\//.test(t.url || ''));
  if (!tab) { console.log('NO MESSENGER TAB'); return; }
  console.log('TAB:', tab.title, '|', tab.url);
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  const pending = new Map();
  let idc = 0;
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  await new Promise((res) => ws.on('open', res));
  const send = (method, params) => new Promise((resolve) => {
    const id = ++idc;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

  const expr = `
  (() => {
    function detectRowUnread(row) {
      if (row.querySelector('[data-testid="unread-count"], .unread')) return 'sel';
      for (const el of row.querySelectorAll('[aria-label]')) {
        if (/chưa đọc|unread|tin nhắn mới|new message/i.test(el.getAttribute('aria-label') || '')) return 'aria';
      }
      for (const el of row.querySelectorAll('div, span, i')) {
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        if (w < 6 || w > 16 || h < 6 || h > 16) continue;
        const st = getComputedStyle(el);
        const radius = parseFloat(st.borderTopLeftRadius);
        if (!(Number.isFinite(radius) && radius >= Math.min(w, h) / 2)) continue;
        const m = /rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/.exec(st.backgroundColor);
        if (!m) continue;
        const alpha = m[4] === undefined ? 1 : Number(m[4]);
        if (alpha < 0.2) continue;
        if (+m[3] >= 180 && +m[1] <= 90 && +m[2] >= 50 && +m[2] <= 170) return 'dot';
      }
      return null;
    }
    const rows = [...document.querySelectorAll('[role="row"], [role="listitem"]')].filter((r) => {
      const a = r.querySelector('a[href*="/messages/"]');
      return a && r.getBoundingClientRect().height > 0;
    });
    const out = { total: rows.length, unread: [] };
    for (const row of rows.slice(0, 120)) {
      const how = detectRowUnread(row);
      if (how) {
        const a = row.querySelector('a[href*="/messages/"]');
        out.unread.push({ how, href: (a.getAttribute('href') || '').slice(0, 60), text: String(row.innerText || '').replace(/\\s+/g, ' ').slice(0, 50) });
      }
    }
    return out;
  })()`;
  const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXC:', JSON.stringify(res.result.exceptionDetails).slice(0, 500));
  } else {
    const v = res.result?.result?.value;
    console.log('TOTAL ROWS:', v?.total);
    console.log('DETECTED UNREAD:', v?.unread?.length);
    for (const u of (v?.unread || []).slice(0, 40)) console.log(' ', u.how, '|', u.href, '|', u.text);
  }
  ws.close();
}

main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
