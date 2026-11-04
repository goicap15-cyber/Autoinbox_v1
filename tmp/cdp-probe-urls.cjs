// Probe nhiều URL, báo URL nào KHÔNG redirect về dashboard
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const APP = '2513578042460915';
const CANDIDATES = [
  'https://developers.facebook.com/apps/' + APP + '/messenger/',
  'https://developers.facebook.com/apps/' + APP + '/messenger/settings/',
  'https://developers.facebook.com/apps/' + APP + '/products/messenger/',
  'https://developers.facebook.com/apps/' + APP + '/products/messenger/settings/',
  'https://developers.facebook.com/apps/' + APP + '/products/messenger/messenger_api_settings/',
  'https://developers.facebook.com/apps/' + APP + '/webhooks/',
  'https://developers.facebook.com/apps/' + APP + '/products/webhooks/',
  'https://developers.facebook.com/apps/' + APP + '/settings/',
  'https://developers.facebook.com/apps/' + APP + '/settings/basic/',
  'https://developers.facebook.com/apps/' + APP + '/roles/',
  'https://developers.facebook.com/apps/' + APP + '/live/',
];
function findAutomationChrome() {
  const out = execSync('powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'chrome.exe\'\\" | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress"', { maxBuffer: 8 * 1024 * 1024 }).toString();
  let list = [];
  try { list = JSON.parse(out); } catch (_) { return []; }
  if (!Array.isArray(list)) list = [list];
  for (const p of list) {
    const cmd = p.CommandLine || '';
    if (cmd.includes('--no-sandbox') && cmd.includes('--lang=vi-VN')) {
      const m = cmd.match(/--user-data-dir="?([^"\s]+)"?/);
      if (m) return { pid: p.ProcessId, dir: m[1] };
    }
  }
  return null;
}
function getTargets(port) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/json/list`, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
function cdp(wsUrl, method, params, timeoutMs) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => { try { ws.close(); } catch (_) {} reject(new Error('timeout ' + method)); }, timeoutMs || 30000);
    ws.on('open', () => ws.send(JSON.stringify({ id: 1, method, params: params || {} })));
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id === 1) { clearTimeout(timer); ws.close(); msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result); }
    });
    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function main() {
  const h = findAutomationChrome();
  if (!h) { console.log('NO CHROME'); return; }
  const [port] = fs.readFileSync(path.join(h.dir, 'DevToolsActivePort'), 'utf8').trim().split(/\r?\n/);
  const targets = await getTargets(port);
  const page = targets.find((t) => t.type === 'page' && /developers\.facebook\.com/.test(t.url)) || targets.find((t) => t.type === 'page' && t.url !== 'about:blank');
  if (!page) { console.log('no page'); return; }
  const ws = page.webSocketDebuggerUrl;
  for (const url of CANDIDATES) {
    await cdp(ws, 'Page.navigate', { url });
    await sleep(7000);
    const r = await cdp(ws, 'Runtime.evaluate', { expression: 'location.href + " || " + document.title', returnByValue: true });
    console.log(url.replace('https://developers.facebook.com/apps/' + APP, ''), '=>', r.result.value);
  }
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
