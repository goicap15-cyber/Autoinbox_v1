// Tìm Chrome tự động hóa (cmdline có --no-sandbox --lang=vi-VN), đọc DevToolsActivePort,
// kết nối CDP rồi dump URL + HTML của tab đang mở.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

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
    const WebSocket = require('ws');
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => { try { ws.close(); } catch (_) {} reject(new Error('cdp timeout')); }, 15000);
    ws.on('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
    });
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id === 1) {
        clearTimeout(timer);
        ws.close();
        resolve(msg.result ? msg.result.result : msg);
      }
    });
    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

async function main() {
  const hits = findAutomationChrome();
  console.log('automation chrome procs:', JSON.stringify(hits));
  if (!hits.length) return;
  for (const h of hits) {
    if (!h.dir) continue;
    const portFile = path.join(h.dir, 'DevToolsActivePort');
    if (!fs.existsSync(portFile)) { console.log('no DevToolsActivePort in', h.dir); continue; }
    const [port] = fs.readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
    console.log('dir:', h.dir, 'port:', port);
    let targets;
    try { targets = await getTargets(port); } catch (e) { console.log('targets err', e.message); continue; }
    const pages = targets.filter((t) => t.type === 'page');
    console.log('pages:', pages.map((p) => p.url).join(' | '));
    for (const p of pages) {
      if (!/developers\.facebook\.com/.test(p.url)) continue;
      console.log('=== URL:', p.url);
      const r = await cdpEval(p.webSocketDebuggerUrl, `JSON.stringify({ url: location.href, title: document.title, html: document.documentElement.outerHTML.slice(0, 400000) })`);
      const data = JSON.parse(r.value || '{}');
      console.log('title:', data.title);
      fs.writeFileSync(path.join(__dirname, 'fb-page-dump.html'), data.html || '');
      fs.writeFileSync(path.join(__dirname, 'fb-page-url.txt'), data.url || '');
      console.log('saved fb-page-dump.html', (data.html || '').length, 'chars');
    }
  }
}
main().catch((e) => { console.error('err', e.message); process.exit(1); });
