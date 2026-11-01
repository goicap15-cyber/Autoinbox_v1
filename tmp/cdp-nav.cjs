// Navigate automation chrome page: node tmp/cdp-nav.cjs <url> [--dump 'expr']
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
function findAutomationChrome() {
  const out = execSync('powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'chrome.exe\'\\" | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress"', { maxBuffer: 8 * 1024 * 1024 }).toString();
  let list = [];
  try { list = JSON.parse(out); } catch (_) { return []; }
  if (!Array.isArray(list)) list = [list];
  const hits = [];
  for (const p of list) {
    const cmd = p.CommandLine || '';
    if (cmd.includes('--no-sandbox') && cmd.includes('--lang=vi-VN')) {
      const m = cmd.match(/--user-data-dir="?([^"\s]+)"?/);
      hits.push({ pid: p.ProcessId, dir: m ? m[1] : null });
    }
  }
  return hits;
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
  const url = process.argv[2];
  const hits = findAutomationChrome();
  if (!hits.length) { console.error('NO AUTOMATION CHROME'); process.exit(1); }
  const h = hits[0];
  const portFile = path.join(h.dir, 'DevToolsActivePort');
  const [port] = fs.readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
  const targets = await getTargets(port);
  const page = targets.find((t) => t.type === 'page' && /developers\.facebook\.com/.test(t.url)) || targets.find((t) => t.type === 'page' && t.url !== 'about:blank');
  if (!page) { console.error('no page target'); process.exit(1); }
  const ws = page.webSocketDebuggerUrl;
  console.error('navigating to', url);
  await cdp(ws, 'Page.navigate', { url });
  for (let i = 0; i < 14; i++) {
    await sleep(2500);
    const r = await cdp(ws, 'Runtime.evaluate', { expression: 'location.href', returnByValue: true });
    const u = r.result && r.result.value;
    console.error('t+' + (i + 1) * 2.5 + 's:', u);
    if (/messenger_api_settings/.test(u)) { await sleep(4000); break; }
  }
  const r = await cdp(ws, 'Runtime.evaluate', { expression: 'location.href', returnByValue: true });
  console.log(r.result && r.result.value);
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
