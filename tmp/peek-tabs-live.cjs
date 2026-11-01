const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const root = 'C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/profiles';
const only = process.argv[2] || null;

(async () => {
  const dirs = fs.readdirSync(root).filter((d) => /^\d{10,}$/.test(d));
  for (const dir of dirs) {
    if (only && !dir.includes(only)) continue;
    const portFile = path.join(root, dir, 'DevToolsActivePort');
    if (!fs.existsSync(portFile)) { console.log('NO_PORT', dir); continue; }
    const [port, browserPath] = fs.readFileSync(portFile, 'utf8').trim().split('\n');
    try {
      const browser = await puppeteer.connect({
        browserWSEndpoint: `ws://127.0.0.1:${port}${browserPath}`,
        defaultViewport: null,
        connectionTimeout: 5000
      });
      const pages = await browser.pages();
      console.log(`=== PROFILE ${dir} (${pages.length} tabs) ===`);
      for (const p of pages) {
        let url = '';
        try { url = p.url(); } catch (_) {}
        if (!/facebook\.com|messenger\.com/.test(url)) { console.log('  SKIP', url.substring(0, 90)); continue; }
        let extra = '';
        try {
          const info = await p.evaluate(() => {
            const marker = document.querySelector('[data-crm-tab-role]');
            const links = document.querySelectorAll('a[href*="/messages/t/"]').length;
            return { role: marker ? marker.getAttribute('data-crm-tab-role') : null, links };
          });
          extra = ` role=${info.role} sidebarLinks=${info.links}`;
        } catch (e) { extra = ` (eval: ${e.message.substring(0, 40)})`; }
        console.log('  TAB', url.substring(0, 100) + extra);
      }
      browser.disconnect();
    } catch (e) {
      console.log('CONNECT_FAIL', dir, e.message.substring(0, 60));
    }
  }
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
