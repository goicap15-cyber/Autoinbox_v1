const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({
    browserWSEndpoint: 'ws://127.0.0.1:50546/devtools/browser/381e1a4a-9b67-4056-b89d-528cb0a254e3',
    defaultViewport: null
  });
  const pages = await browser.pages();
  for (const p of pages) {
    let url = '';
    try { url = p.url(); } catch (_) {}
    if (!/facebook\.com|messenger\.com/.test(url)) { console.log('SKIP', url.substring(0, 80)); continue; }
    console.log('PAGE', url.substring(0, 110));
    try {
      const info = await p.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a[href*="/messages/t/"]'));
        return {
          path: location.pathname,
          title: document.title.substring(0, 50),
          sidebarLinks: links.length,
          firstLinks: links.slice(0, 3).map(a => (a.getAttribute('href') || '').substring(0, 60)),
          hasViewport: Boolean(document.querySelector('div[role="main"]'))
        };
      });
      console.log('  INFO', JSON.stringify(info));
    } catch (e) { console.log('  EVAL_ERR', e.message.substring(0, 80)); }
  }
  browser.disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
