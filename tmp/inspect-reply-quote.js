const puppeteer = require('puppeteer-core');

const BROWSER_URL = 'http://127.0.0.1:53565';
const THREAD = '2211776809571916';

(async () => {
  const browser = await puppeteer.connect({ browserURL: BROWSER_URL, defaultViewport: null });
  const targets = browser.targets();
  console.log('TARGETS:', targets.map(t => `${t.type()}: ${String(t.url()).slice(0, 90)}`).join('\n'));

  // 1) SW probe — check version marker + h3/article fixes present
  for (const t of targets) {
    if (t.type() !== 'service_worker') continue;
    const url = String(t.url());
    if (!url.includes('chrome-extension')) continue;
    const w = await t.worker();
    const info = await w.evaluate(async () => {
      const src = await (await fetch(self.location.href)).text();
      return {
        bgVersionTag: src.includes('group-h3-article-label-fix 2026-10-11b'),
        h3Closest: (src.match(/closest\('h3'\)/g) || []).length,
        articleRegex: src.includes('Lúc\\s+.*,\\s*([^:]+?):\\s+(.+)'),
        mediaOverride: src.includes('mediaArticleSender'),
      };
    });
    console.log('SW:', url.slice(0, 60), JSON.stringify(info));
  }

  // 2) Find or open thread page
  let page = null;
  for (const p of await browser.pages()) {
    if (String(p.url()).includes(`/messages/t/${THREAD}`)) { page = p; break; }
  }
  if (!page) {
    const pages = await browser.pages();
    page = pages[0];
    console.log('Navigating page to thread...', String(page.url()).slice(0, 60));
    await page.goto(`https://www.messenger.com/t/${THREAD}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise(r => setTimeout(r, 8000));
  }
  console.log('PAGE:', String(page.url()).slice(0, 80));

  // 3) Dump reply-message structure: articles whose h3 contains "đã trả lời"
  const dump = await page.evaluate(() => {
    const articles = Array.from(document.querySelectorAll('[data-message-id]'));
    const out = { total: articles.length, replies: [] };
    for (const a of articles) {
      const h3s = Array.from(a.querySelectorAll('h3')).map(h => (h.textContent || '').trim()).filter(Boolean);
      const isReply = h3s.some(t => /trả lời|replied/i.test(t));
      if (!isReply) continue;
      const label = a.getAttribute('aria-label') || '';
      // dump the quote container: find descendant with different data-message-id or quote-ish class
      const nested = Array.from(a.querySelectorAll('[data-message-id]')).map(n => ({
        mid: n.getAttribute('data-message-id'),
        aria: (n.getAttribute('aria-label') || '').slice(0, 80),
      }));
      // look for quote block: div with class containing quote/reply, or aria-label "Trả lời"
      const quoteNodes = Array.from(a.querySelectorAll('div[aria-label]'))
        .map(n => ({ aria: (n.getAttribute('aria-label') || ''), cls: (n.className || '').toString().slice(0, 100), text: (n.textContent || '').trim().slice(0, 60) }))
        .filter(x => /trả lời|replied|quote/i.test(x.aria) || /quote/i.test(x.cls))
        .slice(0, 5);
      out.replies.push({
        mid: a.getAttribute('data-message-id'),
        label: label.slice(0, 120),
        h3s,
        nested,
        quoteNodes,
        text: (a.textContent || '').trim().slice(0, 160),
      });
      if (out.replies.length >= 4) break;
    }
    return out;
  });
  console.log('REPLY ARTICLES:', JSON.stringify(dump, null, 1).slice(0, 4000));

  browser.disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
