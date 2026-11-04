// Scroll the Hai Anh thread log up briefly, capture rows + minute labels,
// then restore scroll to bottom. Read-only otherwise (no clicks).
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
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

      // find the scrollable log container
      const found = await page.evaluate(() => {
        const log = document.querySelector('div[role="main"] [role="log"]');
        if (!log) return null;
        let el = log.parentElement;
        while (el) {
          const st = getComputedStyle(el);
          if (/(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight) return true;
          el = el.parentElement;
        }
        return false;
      });
      console.log('scrollable found:', found);

      const before = await page.evaluate(() => {
        const log = document.querySelector('div[role="main"] [role="log"]');
        let el = log && log.parentElement;
        while (el) {
          const st = getComputedStyle(el);
          if (/(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight) return { top: el.scrollTop, sh: el.scrollHeight };
          el = el.parentElement;
        }
        return null;
      });
      console.log('scroll before:', JSON.stringify(before));

      // scroll up 900px to render older rows
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => {
          const log = document.querySelector('div[role="main"] [role="log"]');
          let el = log && log.parentElement;
          while (el) {
            const st = getComputedStyle(el);
            if (/(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight) { el.scrollTop -= 300; return; }
            el = el.parentElement;
          }
        });
        await sleep(1200);
      }
      await sleep(1500);

      const rows = await page.evaluate(() => {
        const log = document.querySelector('div[role="main"] [role="log"]');
        if (!log) return { error: 'no log' };
        const list = Array.from(log.querySelectorAll('[role="article"], div[role="row"]'));
        return list.map((row, i) => {
          const native = row.querySelector('[data-message-id]');
          return {
            i,
            id: native ? native.getAttribute('data-message-id') : null,
            text: (row.innerText || '').replace(/\s+/g, ' ').slice(0, 200),
          };
        });
      });
      for (const r of rows) {
        console.log(String(r.i).padStart(3), (r.id || '(no-id)').slice(-16).padEnd(18), '|', r.text.slice(0, 170));
      }

      // restore scroll to bottom
      await page.evaluate(() => {
        const log = document.querySelector('div[role="main"] [role="log"]');
        let el = log && log.parentElement;
        while (el) {
          const st = getComputedStyle(el);
          if (/(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight) { el.scrollTop = el.scrollHeight; return; }
          el = el.parentElement;
        }
      });
      console.log('scroll restored');
    }
  } finally { browser.disconnect(); }
})();
