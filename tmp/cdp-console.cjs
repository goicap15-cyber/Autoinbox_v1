// Enable Log + Runtime, reload page, collect console/errors 20s
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
function findAutomationChrome() {
  const out = execSync('powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'chrome.exe\'\\" | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress"', { maxBuffer: 8 * 1024 * 1024 }).toString();
  let list = [];
  try { list = JSON.parse(out); } catch (_) { return null; }
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
async function main() {
  const h = findAutomationChrome();
  if (!h) { console.log('NO CHROME'); return; }
  const [port] = fs.readFileSync(path.join(h.dir, 'DevToolsActivePort'), 'utf8').trim().split(/\r?\n/);
  const targets = await getTargets(port);
  const page = targets.find((t) => t.type === 'page' && /developers\.facebook\.com/.test(t.url)) || targets.find((t) => t.type === 'page' && t.url !== 'about:blank');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const send = (method, params) => ws.send(JSON.stringify({ id: ++id, method, params: params || {} }));
  ws.on('open', () => {
    send('Log.enable');
    send('Runtime.enable');
    send('Page.enable');
    setTimeout(() => send('Page.navigate', { url: 'https://developers.facebook.com/apps/2513578042460915/settings/basic/' }), 500);
  });
  const lines = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.method === 'Log.entryAdded') lines.push('[log] ' + (msg.params.entry.text || '').slice(0, 200));
    if (msg.method === 'Runtime.consoleAPICalled') lines.push('[console.' + msg.params.type + '] ' + msg.params.args.map(a => (a.value !== undefined ? String(a.value) : (a.description || ''))).join(' ').slice(0, 200));
    if (msg.method === 'Runtime.exceptionThrown') lines.push('[exception] ' + JSON.stringify(msg.params.exceptionDetails).slice(0, 400));
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') lines.push('[ERROR] ' + (msg.params.args[0] && msg.params.args[0].value || '').slice(0, 300));
  });
  setTimeout(() => { console.log(lines.slice(-40).join('\n') || 'no console output'); process.exit(0); }, 25000);
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
