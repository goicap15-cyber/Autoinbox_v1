const puppeteer = require('puppeteer-core');
const BROWSER_URL = 'http://127.0.0.1:53565';

(async () => {
  const browser = await puppeteer.connect({ browserURL: BROWSER_URL, defaultViewport: null });
  let page = null;
  for (const p of await browser.pages()) {
    const u = String(p.url());
    if (u.includes('facebook.com/messages/t/') && !u.includes('login')) { page = p; break; }
  }
  if (!page) { console.log('NO FB TAB'); browser.disconnect(); return; }

  const dump = await page.evaluate(() => {
    const articles = Array.from(document.querySelectorAll('[data-message-id]'));
    const out = { total: articles.length, samples: [] };
    // find a reply article and a normal article
    for (const a of articles.slice(0, 30)) {
      const h3s = Array.from(a.querySelectorAll('h3')).map(h => (h.textContent || '').trim());
      const isReply = h3s.some(t => /trả lời|replied/i.test(t));
      if (out.samples.length >= 2 && !isReply) continue;
      // walk ALL leaf text nodes' element ancestors up to article
      const leaves = [];
      const walker = document.createTreeWalker(a, NodeFilter.SHOW_TEXT);
      const seen = new Set();
      while (walker.nextNode()) {
        const t = (walker.currentNode.textContent || '').trim();
        if (!t || t.length < 2) continue;
        let el = walker.currentNode.parentElement;
        let covered = false;
        for (const L of leaves) if (el && L.el.contains(el)) covered = true;
        if (covered || seen.has(el)) continue;
        seen.add(el);
        // ancestor chain up to article
        const chain = [];
        let n = el;
        while (n && n !== a) {
          chain.push({
            tag: n.tagName,
            aria: (n.getAttribute && n.getAttribute('aria-label')) || '',
            role: (n.getAttribute && n.getAttribute('role')) || '',
            dataId: (n.getAttribute && (n.getAttribute('data-id') || n.getAttribute('data-message-id'))) || '',
            cls: (n.className || '').toString().slice(0, 60),
          });
          n = n.parentElement;
        }
        leaves.push({ el, text: t.slice(0, 70), chain: chain.slice(0, 8) });
      }
      out.samples.push({ mid: a.getAttribute('data-message-id'), label: (a.getAttribute('aria-label')||'').slice(0,100), h3s: h3s.slice(0,2), isReply, leaves: leaves.slice(0, 8) });
      if (out.samples.length >= 3) break;
    }
    return out;
  });
  console.log(JSON.stringify(dump, null, 1).slice(0, 9000));
  browser.disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
