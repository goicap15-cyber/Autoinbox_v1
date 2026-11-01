const fs = require('fs');
const path = require('path');
const PROFILE = 'C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/profiles/pending_20261001093516_qiaxz';
async function main() {
  const puppeteer = (await import('puppeteer-core')).default;
  const [port, wsPath] = fs.readFileSync(path.join(PROFILE, 'DevToolsActivePort'), 'utf8').trim().split('\n');
  const browser = await puppeteer.connect({ browserWSEndpoint: `ws://127.0.0.1:${port}${wsPath}`, defaultViewport: null });
  const page = await browser.newPage();
  await page.goto('chrome://policy', { waitUntil: 'load', timeout: 20000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 2500));
  const text = await page.evaluate(() => {
    let out = '';
    const walk = (root) => {
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) walk(el.shadowRoot);
      }
      out += (root.textContent || '') + '\n';
    };
    walk(document);
    return out;
  }).catch((e) => 'EVAL_ERR: ' + e.message.slice(0, 60));
  const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
  const hits = lines.filter((s) => /WindowOcclusionEnabled/i.test(s));
  console.log('hits=' + hits.length);
  for (const h of hits.slice(0, 3)) console.log('>>', h.slice(0, 120));
  const errCtx = (text.split(/(?=WindowOcclusionEnabled)/i)[1] || '').slice(0, 200);
  console.log('ctx:', errCtx.replace(/\s+/g, ' ').slice(0, 180));
  await page.close();
  browser.disconnect();
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
