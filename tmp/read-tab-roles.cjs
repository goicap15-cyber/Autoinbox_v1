// Doc bang vai trò tab tu chrome.storage cua extension CRM (chi doc).
const http = require('http');

const EXT_ID = 'kddcebkokjjjchokdlcjmbcdgggmcabl';
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

async function main() {
  const targets = await getJson('/json/list');
  const sw = targets.find((t) => t.type === 'service_worker' && String(t.url).includes(EXT_ID));
  if (!sw) { console.log('KHONG THAY service worker extension'); return; }
  const ws = new WebSocket(sw.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params) => new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  await new Promise((r) => (ws.onopen = r));

  const evalIn = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    return r.result?.result?.value;
  };

  const raw = await evalIn('chrome.storage.local.get(null).then(r => JSON.stringify(r))');
  const store = JSON.parse(raw || '{}');
  const keys = Object.keys(store);
  console.log('=== STORAGE KEYS (' + keys.length + ') ===');
  const interesting = keys.filter((k) =>
    /role|tab|nav|lock|personal|page:|chat|history|discovery|request|campaign|send/i.test(k));
  for (const k of interesting) {
    const v = store[k];
    const vs = typeof v === 'object' ? JSON.stringify(v) : String(v);
    console.log(k + ' = ' + (vs.length > 300 ? vs.slice(0, 300) + '...' : vs));
  }

  const tabs = await evalIn('chrome.tabs.query({}).then(ts => ts.map(t => ({ id: t.id, active: t.active, url: (t.url||"").slice(0,90), title: (t.title||"").slice(0,30) })).filter(t => !/chrome-extension/.test(t.url)).map(t => JSON.stringify(t))).join("\\n"))');
  console.log('=== TABS (tu extension) ===');
  console.log(tabs);
  ws.close();
}

main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
