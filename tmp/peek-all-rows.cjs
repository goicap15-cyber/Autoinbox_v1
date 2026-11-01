// Dump ALL visible rows in the Hai Anh thread: order, native ids, text.
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const PROFILES_ROOT = path.join(process.env.APPDATA, 'autochatbot-fb-crm', 'data', 'profiles');

(async () => {
  const dir = path.join(PROFILES_ROOT, 'pending_20261014105600_bwtmm');
  const raw = fs.readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8').trim().split(/\r?\n/);
  const browser = await puppeteer.connect({ browserWSEndpoint: `ws://127.0.0.1:${raw[0]}${raw[1] || ''}`, defaultViewport: null });
  try {
    const pages = await browser.pages();
    for (const page of pages) {
      const url = page.url() || '';
      if (!/messages\/t\/61590887756824/.test(url)) continue;
      const rows = await page.evaluate(() => {
        const log = document.querySelector('div[role="main"] [role="log"]');
        if (!log) return { error: 'no log' };
        const list = Array.from(log.querySelectorAll('[role="article"], div[role="row"]'));
        return list.map((row, i) => {
          const native = row.querySelector('[data-message-id]');
          const quote = row.querySelector('[aria-label*="trả lời" i], [aria-label*="gốc" i]');
          return {
            i,
            id: native ? native.getAttribute('data-message-id') : null,
            quote: quote ? (quote.getAttribute('aria-label') || '') : null,
            text: (row.innerText || '').replace(/\s+/g, ' ').slice(0, 220),
          };
        });
      });
      for (const r of rows) {
        console.log(String(r.i).padStart(3), (r.id || '(no-id)').slice(-16).padEnd(18), r.quote ? '[QUOTE:' + r.quote.slice(0, 28) + ']' : '         ', '|', r.text.slice(0, 160));
      }
    }
  } finally { browser.disconnect(); }
})();
