const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:50783',
    defaultViewport: null
  });
  const pages = await browser.pages();
  const target = pages.find(p => (p.url() || '').includes('/messages/t/2211776809571916'));
  if (!target) {
    console.log('THREAD_TAB_NOT_FOUND');
    await browser.disconnect();
    return;
  }
  const result = await target.evaluate(() => {
    const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const wanted = new Set(['Linh', 'T\u00E8o', 'Ti\u1EBFn Quang']);
    const leaves = Array.from(document.querySelectorAll('div[role="row"] *, [role="main"] *'))
      .filter(el => el.children.length === 0 && wanted.has(norm(el.textContent)));
    const out = [];
    for (const el of leaves.slice(0, 8)) {
      const chain = [];
      let cur = el;
      for (let i = 0; i < 10 && cur; i++) {
        chain.push({
          i,
          tag: cur.tagName,
          role: cur.getAttribute && cur.getAttribute('role'),
          ariaLabel: cur.getAttribute ? (cur.getAttribute('aria-label') || '').slice(0, 90) : '',
          msgId: cur.getAttribute && (cur.getAttribute('data-message-id') || ''),
          dataId: cur.getAttribute && (cur.getAttribute('data-id') || '').slice(0, 40),
          cls: (cur.className && typeof cur.className === 'string') ? cur.className.slice(0, 60) : ''
        });
        cur = cur.parentElement;
      }
      const midCarrier = el.closest('[data-message-id]');
      out.push({
        text: norm(el.textContent),
        midCarrier: midCarrier ? (midCarrier.getAttribute('data-message-id') || '').slice(0, 50) : null,
        chain
      });
    }
    const swTargets = 'see-separate';
    return { count: leaves.length, samples: out };
  });
  console.log(JSON.stringify(result, null, 1).slice(0, 6000));
  await browser.disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
