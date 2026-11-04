// Read-only peek at the live Messenger DOM: dump the reply-row structure
// around "ý à là khách hàng" / "thế là 1 tk" in thread 61590887756824.
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const PROFILES_ROOT = path.join(process.env.APPDATA, 'autochatbot-fb-crm', 'data', 'profiles');

async function readEndpoint(profileDir) {
  try {
    const raw = fs.readFileSync(path.join(profileDir, 'DevToolsActivePort'), 'utf8').trim().split(/\r?\n/);
    if (!raw[0]) return null;
    return { ws: `ws://127.0.0.1:${raw[0]}${raw[1] || ''}`, port: raw[0], profile: path.basename(profileDir) };
  } catch (_) { return null; }
}

(async () => {
  const dirs = fs.readdirSync(PROFILES_ROOT).map((d) => path.join(PROFILES_ROOT, d)).filter((d) => fs.existsSync(path.join(d, 'lockfile')));
  for (const dir of dirs) {
    const ep = await readEndpoint(dir);
    if (!ep) continue;
    let browser;
    try {
      browser = await puppeteer.connect({ browserWSEndpoint: ep.ws, defaultViewport: null });
    } catch (e) { console.log(`[${ep.profile}] connect failed: ${e.message}`); continue; }
    try {
      const pages = await browser.pages();
      for (const page of pages) {
        const url = page.url() || '';
        if (!/facebook\.com\/messages/.test(url)) continue;
        console.log(`\n[${ep.profile}] TAB: ${url.slice(0, 110)}`);
        const info = await page.evaluate(() => {
          const out = { threadHint: location.href, rows: [] };
          const log = document.querySelector('div[role="main"] [role="log"]');
          if (!log) { out.error = 'no log'; return out; }
          const rows = Array.from(log.querySelectorAll('[role="article"], div[role="row"]'));
          const wanted = /ý à là khách hàng|thế là 1 tk|Nói chung là nếu limit|ukii a|Hai đã trả lời/i;
          rows.forEach((row, rowIdx) => {
            const text = (row.innerText || '').replace(/\s+/g, ' ').slice(0, 400);
            if (!wanted.test(text)) return;
            const native = row.querySelector('[data-message-id]');
            const entry = {
              rowIdx,
              tag: row.tagName,
              role: row.getAttribute('role'),
              rowNativeId: native ? native.getAttribute('data-message-id') : null,
              rowAria: (row.getAttribute('aria-label') || '').slice(0, 160),
              text,
              bubbles: [],
              quoteContainers: [],
            };
            // every data-message-id anywhere inside this row
            const allIds = Array.from(row.querySelectorAll('[data-message-id]')).map((el) => ({
              id: el.getAttribute('data-message-id'),
              aria: (el.getAttribute('aria-label') || '').slice(0, 80),
              text: (el.innerText || '').replace(/\s+/g, ' ').slice(0, 120),
              role: el.getAttribute('role'),
            }));
            entry.dataMessageIds = allIds;
            // quote containers by aria-label
            row.querySelectorAll('[aria-label]').forEach((el) => {
              const a = el.getAttribute('aria-label') || '';
              if (/trả lời|gốc|replied|quote|original/i.test(a)) {
                entry.quoteContainers.push({
                  aria: a.slice(0, 120),
                  tag: el.tagName,
                  text: (el.innerText || '').replace(/\s+/g, ' ').slice(0, 200),
                });
              }
            });
            out.rows.push(entry);
          });
          out.totalRows = rows.length;
          return out;
        });
        console.log(JSON.stringify(info, null, 1).slice(0, 12000));
      }
    } catch (e) {
      console.log(`[${ep.profile}] eval error: ${e.message}`);
    } finally {
      browser.disconnect();
    }
  }
  console.log('\nDONE');
})();
