const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const puppeteer = require('puppeteer-core');

const dir = 'C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/profiles/pending_20261008025237_olq7v';
const [port, wsPath] = fs.readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8').trim().split('\n');

(async () => {
  const browser = await puppeteer.connect({
    browserWSEndpoint: `ws://127.0.0.1:${port}${wsPath}`,
    defaultViewport: null
  });
  const pages = await browser.pages();
  for (const p of pages) {
    let url = '';
    try { url = p.url(); } catch (_) { continue; }
    if (!/\/messages\/t\/100040996505718/.test(url)) continue;
    const data = await p.evaluate(() => {
      const arts = Array.from(document.querySelectorAll('[data-message-id]'));
      return arts.map((a) => {
        const mid = String(a.getAttribute('data-message-id') || a.getAttribute('data-id') || a.id || '');
        const leaves = Array.from(a.querySelectorAll('div[dir="auto"], span[dir="auto"]'))
          .filter((b) => !b.querySelector('div[dir="auto"], span[dir="auto"]'))
          .map((b) => {
            const r = b.getBoundingClientRect();
            const s = getComputedStyle(b);
            return { t: (b.textContent || '').trim().slice(0, 60), v: r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0' };
          }).filter((l) => l.t);
        return { mid: mid.slice(0, 55), n: leaves.length, leaves };
      });
    }).catch((e) => ({ evalErr: e.message.slice(0, 100) }));
    console.log('ARTICLES:', data.length);
    for (const a of data) {
      console.log(a.mid, '| n=' + a.n, '|', JSON.stringify(a.leaves.map((l) => (l.v ? '' : 'HIDDEN:') + l.t)));
    }
  }
  browser.disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
