const puppeteer = require('puppeteer-core');
const BROWSER_URL = 'http://127.0.0.1:56319';
const THREAD = '2211776809571916';

(async () => {
  const browser = await puppeteer.connect({ browserURL: BROWSER_URL, defaultViewport: null });
  const pages = await browser.pages();
  console.log('PAGES:', pages.map(p => String(p.url()).slice(0, 70)).join('\n'));
  let page = pages.find(p => String(p.url()).includes('facebook.com/messages'));
  if (!page) page = pages[0];
  await page.goto(`https://www.facebook.com/messages/t/${THREAD}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise(r => setTimeout(r, 15000));
  console.log('OPENED:', String(page.url()).slice(0, 80));

  const dump = await page.evaluate(() => {
    const articles = Array.from(document.querySelectorAll('[data-message-id]'));
    const out = { total: articles.length, quoteContainers: 0, replyArticles: 0, sample: [] };
    for (const a of articles) {
      const h3s = Array.from(a.querySelectorAll('h3')).map(h => (h.textContent || '').trim());
      const quoteBtns = a.querySelectorAll('div[aria-label="Đi đến tin nhắn đã trả lời"]').length;
      if (quoteBtns) { out.quoteContainers += quoteBtns; out.replyArticles++; }
      if (out.sample.length < 3 && quoteBtns) {
        out.sample.push({
          mid: a.getAttribute('data-message-id'),
          label: (a.getAttribute('aria-label') || '').slice(0, 90),
          h3s: h3s.slice(0, 2),
          quoteBtns,
        });
      }
    }
    return out;
  });
  console.log('THREAD DUMP:', JSON.stringify(dump, null, 1));
  // keep tab open 40s for history sync round to complete
  await new Promise(r => setTimeout(r, 40000));
  console.log('done');
  browser.disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
