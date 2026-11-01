// CDP eval tổng quát: node tmp/cdp-eval.cjs '<js expression>' [--file out.html]
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
function cdpEval(wsUrl, expression) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => { try { ws.close(); } catch (_) {} reject(new Error('cdp timeout')); }, 60000);
    ws.on('open', () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } })));
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id === 1) { clearTimeout(timer); ws.close(); resolve(msg.result); }
    });
    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}
async function main() {
  const expr = process.argv[2];
  const hits = findAutomationChrome();
  if (!hits.length) { console.error('NO AUTOMATION CHROME'); process.exit(1); }
  const h = hits[0];
  const portFile = path.join(h.dir, 'DevToolsActivePort');
  if (!fs.existsSync(portFile)) { console.error('no DevToolsActivePort'); process.exit(1); }
  const [port] = fs.readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
  const targets = await getTargets(port);
  const page = targets.find((t) => t.type === 'page' && /developers\.facebook\.com/.test(t.url)) || targets.find((t) => t.type === 'page' && t.url !== 'about:blank');
  if (!page) { console.error('no fb page target; pages:', targets.map(t => t.url).join(' | ')); process.exit(1); }
  console.error('page url:', page.url);
  const r = await cdpEval(page.webSocketDebuggerUrl, expr);
  if (r && r.exceptionDetails) console.log('EXC:', JSON.stringify(r.exceptionDetails.exception).slice(0, 500));
  else if (r && r.result && r.result.type === 'object') console.log(JSON.stringify(r.result.value, null, 1).slice(0, 30000));
  else console.log(String(r && r.result && r.result.value).slice(0, 30000));
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
