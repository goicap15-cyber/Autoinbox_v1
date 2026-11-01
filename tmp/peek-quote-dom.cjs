const fs = require('fs');
const path = require('path');
const os = require('os');
const profileDir = path.join(os.homedir(), 'AppData', 'Roaming', 'autochatbot-fb-crm', 'data', 'profiles', 'pending_20261014105600_bwtmm');
const portFile = path.join(profileDir, 'DevToolsActivePort');
const lines = fs.readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
const port = lines[0], wsPath = lines[1];
(async () => {
  const puppeteer = require(path.resolve('C:/Users/Admin/Downloads/Duan/CRM_FB1/node_modules/puppeteer-core'));
  const browser = await puppeteer.connect({ browserWSEndpoint: `ws://127.0.0.1:${port}${wsPath}`, defaultViewport: null });
  const pages = await browser.pages();
  let target = null;
  for (const p of pages) {
    const u = p.url() || '';
    if (/messenger|facebook/.test(u)) { target = p; break; }
  }
  if (!target) { console.log('NO_MESSENGER_PAGE'); console.log(pages.map(p => p.url()).join('\n')); process.exit(0); }
  const info = await target.evaluate(() => {
    const arts = Array.from(document.querySelectorAll('article[data-message-id]'));
    const replyArt = arts.find(a => (a.textContent || '').includes('ý à là khách hàng'));
    if (!replyArt) return { found: false, total: arts.length, sample: arts.slice(-3).map(a => (a.textContent || '').substring(0, 60)) };
    const labeled = Array.from(replyArt.querySelectorAll('[aria-label]')).map(el => ({
      tag: el.tagName,
      aria: el.getAttribute('aria-label'),
      text: (el.textContent || '').substring(0, 120),
      cls: (el.className && String(el.className).substring(0, 50)) || ''
    }));
    return {
      found: true,
      mid: replyArt.getAttribute('data-message-id'),
      labeledCount: labeled.length,
      labeled
    };
  });
  console.log(JSON.stringify(info, null, 1));
  browser.disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
