// Điều hướng Chrome tự động tới trang webhooks, theo dõi redirect, báo cáo DOM chính.
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
    let id = 0;
    const timer = setTimeout(() => { try { ws.close(); } catch (_) {} reject(new Error('timeout ' + method)); }, timeoutMs || 30000);
    const pending = new Map();
    ws.on('open', () => {
      id++;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id && pending.has(msg.id)) {
        const r = pending.get(msg.id);
        pending.delete(msg.id);
        if (!pending.size) clearTimeout(timer);
        if (msg.error) reject(new Error(method + ': ' + JSON.stringify(msg.error)));
        else r(msg.result);
      }
    });
    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const hits = findAutomationChrome();
  if (!hits.length) { console.log('KHONG tim thay automation chrome'); return; }
  const h = hits[0];
  const portFile = path.join(h.dir, 'DevToolsActivePort');
  if (!fs.existsSync(portFile)) { console.log('no DevToolsActivePort'); return; }
  const [port] = fs.readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
  const targets = await getTargets(port);
  const page = targets.find((t) => t.type === 'page' && /developers\.facebook\.com/.test(t.url)) || targets.find((t) => t.type === 'page');
  console.log('before:', page.url);
  const ws = page.webSocketDebuggerUrl;
  const urlNow = async () => {
    const r = await cdp(ws, 'Runtime.evaluate', { expression: 'location.href', returnByValue: true });
    return r.result && r.result.value;
  };
  // B1: thử URL trực tiếp ?view=page
  await cdp(ws, 'Page.navigate', { url: 'https://developers.facebook.com/apps/2513578042460915/webhooks/?view=page' });
  for (let i = 0; i < 12; i++) {
    await sleep(2500);
    const u = await urlNow();
    console.log('t+' + (i + 1) * 2.5 + 's:', u);
    if (/webhooks/.test(u) && !/login/i.test(u)) { await sleep(5000); break; }
  }
  const finalUrl = await urlNow();
  console.log('final:', finalUrl);
  const r = await cdp(ws, 'Runtime.evaluate', {
    expression: `JSON.stringify({
      url: location.href,
      title: document.title,
      h1s: [...document.querySelectorAll('h1,h2,h3')].slice(0,10).map(x => (x.innerText||'').trim()).filter(Boolean),
      hasConfigureWebhooks: document.body.innerText.includes('cấu hình webhook') || document.body.innerText.includes('Configure webhooks'),
      bodyTextHead: document.body.innerText.slice(0, 600),
      html: document.documentElement.outerHTML.slice(0, 500000)
    })`,
    returnByValue: true,
  }, 30000);
  const d = JSON.parse(r.result.value || '{}');
  console.log('title:', d.title);
  console.log('h1s:', JSON.stringify(d.h1s));
  console.log('hasConfigureWebhooks:', d.hasConfigureWebhooks);
  console.log('bodyTextHead:', d.bodyTextHead.replace(/\n+/g, ' | '));
  if (d.html) fs.writeFileSync(path.join(__dirname, 'fb-webhooks-dump.html'), d.html);
  console.log('saved html', (d.html || '').length);
}
main().catch((e) => { console.error('err', e.message); process.exit(1); });
