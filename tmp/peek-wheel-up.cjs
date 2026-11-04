// Mouse-wheel scroll up over the message log to force virtualized rows to
// render, dump rows, restore scroll. No clicks, no keys.
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const PROFILES_ROOT = path.join(process.env.APPDATA, 'autochatbot-fb-crm', 'data', 'profiles');

(async () => {
  const dir = path.join(PROFILES_ROOT, 'pending_20261014105600_bwtmm');
  const raw = fs.readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8').trim().split(/\r?\n/);
  const browser = await puppeteer.connect({ browserWSEndpoint: `ws://127.0.0.1:${raw[0]}${raw[1] || ''}`, defaultViewport: null });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    const pages = await browser.pages();
    for (const page of pages) {
      const url = page.url() || '';
      if (!/messages\/t\/61590887756824/.test(url)) continue;
      const box = await page.evaluate(() => {
        const log = document.querySelector('div[role="main"] [role="log"]');
        if (!log) return null;
        const r = log.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height * 0.4), w: r.width, h: r.height };
      });
      if (!box) { console.log('no log box'); continue; }
      console.log('log box:', JSON.stringify(box));
      await page.mouse.move(box.x, box.y);
      for (let i = 0; i < 12; i++) {
        await page.mouse.wheel({ deltaY: -400 });
        await sleep(350);
      }
      await sleep(2000);
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
      const list = Array.isArray(rows) ? rows : [];
      console.log('rows captured:', list.length);
      for (const r of list) {
        console.log(String(r.i).padStart(3), (r.id || '(no-id)').slice(-16).padEnd(18), '|', r.text.slice(0, 170));
      }
      // restore to bottom
      for (let i = 0; i < 20; i++) {
        await page.mouse.wheel({ deltaY: 1200 });
        await sleep(120);
      }
      console.log('scroll restored');
    }
  } finally { browser.disconnect(); }
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
