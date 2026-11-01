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
  if (!sw) { console.log('KHONG THAY SW'); return; }
  const ws = new WebSocket(sw.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (m, p) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  await new Promise((r) => (ws.onopen = r));

  const evalIn = async (label, expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) { console.log(label + ' :: EXC ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return; }
    console.log(label + ' :: ' + String(JSON.stringify(r.result?.result?.value)).slice(0, 2000));
  };

  await evalIn('local', 'chrome.storage.local.get(null).then(r=>JSON.stringify(r))');
  await evalIn('session', '(chrome.storage.session ? chrome.storage.session.get(null).then(r=>JSON.stringify(r)) : "no session area")');
  await evalIn('sync', 'chrome.storage.sync.get(null).then(r=>JSON.stringify(r))');
  await evalIn('tabs', 'chrome.tabs.query({}).then(ts=>JSON.stringify(ts.map(t=>({id:t.id,a:t.active,u:(t.url||"").slice(0,80)})).filter(t=>!/chrome-extension/.test(t.u))))');
  ws.close();
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
