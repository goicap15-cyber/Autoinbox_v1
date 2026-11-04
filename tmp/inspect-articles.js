const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:50783',
    defaultViewport: null
  });
  const pages = await browser.pages();
  const target = pages.find(p => (p.url() || '').includes('/messages/t/2211776809571916'));
  if (!target) { console.log('THREAD_TAB_NOT_FOUND'); await browser.disconnect(); return; }
  const result = await target.evaluate(() => {
    const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const articles = Array.from(document.querySelectorAll('[data-message-id]')).slice(0, 14);
    return articles.map((a) => {
      const h3s = Array.from(a.querySelectorAll('h3')).map(h => norm(h.textContent)).filter(Boolean);
      const imgs = Array.from(a.querySelectorAll('img')).slice(0, 4).map(im => ({
        alt: (im.getAttribute('alt') || '').slice(0, 30),
        w: im.width, h: im.height,
        aria: (im.getAttribute('aria-label') || '').slice(0, 40),
        src: (im.currentSrc || im.src || '').includes('fbcdn') ? 'fbcdn' : (im.src || '').slice(0, 30)
      }));
      const bub = a.querySelector('[role="row"] span, div[dir="auto"]');
      return {
        mid: (a.getAttribute('data-message-id') || '').slice(0, 40),
        articleAria: (a.getAttribute('aria-label') || '').slice(0, 70),
        parentAria: a.parentElement ? (a.parentElement.getAttribute('aria-label') || '').slice(0, 70) : '',
        h3s,
        bubbleText: bub ? norm(bub.textContent).slice(0, 40) : '',
        imgs
      };
    });
  });
  console.log(JSON.stringify(result, null, 1).slice(0, 7000));
  await browser.disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
