const puppeteer = require('puppeteer-core');
const BROWSER_URL = 'http://127.0.0.1:53565';
const THREAD = '2211776809571916';

(async () => {
  const browser = await puppeteer.connect({ browserURL: BROWSER_URL, defaultViewport: null });
  // 1) all targets incl. extension
  const targets = browser.targets();
  console.log('EXT TARGETS:', targets.filter(t => String(t.url()).includes('chrome-extension')).map(t => `${t.type()} ${String(t.url()).slice(0,80)}`).join(' | ') || 'NONE');

  // 2) navigate a facebook.com tab to the group thread
  let page = null;
  for (const p of await browser.pages()) {
    const u = String(p.url());
    if (u.includes('facebook.com/messages') && !u.includes('login')) { page = p; break; }
  }
  if (!page) { console.log('NO FB TAB'); browser.disconnect(); return; }
  await page.goto(`https://www.facebook.com/messages/t/${THREAD}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise(r => setTimeout(r, 10000));
  console.log('PAGE:', String(page.url()).slice(0, 80));

  const dump = await page.evaluate(() => {
    const articles = Array.from(document.querySelectorAll('[data-message-id]'));
    const out = { total: articles.length, replies: [] };
    for (const a of articles) {
      const h3s = Array.from(a.querySelectorAll('h3')).map(h => (h.textContent || '').trim()).filter(Boolean);
      const isReply = h3s.some(t => /trả lời|replied/i.test(t));
      if (!isReply) continue;
      const nested = Array.from(a.querySelectorAll('[data-message-id]')).map(n => ({
        mid: n.getAttribute('data-message-id'),
        aria: (n.getAttribute('aria-label') || '').slice(0, 80),
      }));
      const quoteNodes = Array.from(a.querySelectorAll('div[aria-label]'))
        .map(n => ({ aria: (n.getAttribute('aria-label') || ''), cls: (n.className || '').toString().slice(0, 90), text: (n.textContent || '').trim().slice(0, 60) }))
        .filter(x => /trả lời|replied|quote/i.test(x.aria) || /quote/i.test(x.cls))
        .slice(0, 5);
      out.replies.push({
        mid: a.getAttribute('data-message-id'),
        label: (a.getAttribute('aria-label') || '').slice(0, 120),
        h3s, nested, quoteNodes,
        text: (a.textContent || '').trim().slice(0, 160),
      });
      if (out.replies.length >= 4) break;
    }
    return out;
  });
  console.log('REPLY ARTICLES:', JSON.stringify(dump, null, 1).slice(0, 5000));
  browser.disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
