const puppeteer = require('puppeteer-core');
const BROWSER_URL = 'http://127.0.0.1:64638';
const EXT_ID = 'kddcebkokjjjchokdlcjmbcdgggmcabl';

(async () => {
  const browser = await puppeteer.connect({ browserURL: BROWSER_URL, defaultViewport: null });
  // wake SW via a throwaway tab hitting the extension origin
  const p = await browser.newPage();
  await p.goto(`chrome-extension://${EXT_ID}/manifest.json`, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 2500));
  await p.close();

  const targets = browser.targets();
  const sw = targets.find(t => t.type() === 'service_worker' && String(t.url()).includes(EXT_ID));
  if (!sw) {
    console.log('NO SW TARGET. All targets:');
    for (const t of targets) console.log(' -', t.type(), String(t.url()).slice(0, 90));
    browser.disconnect(); return;
  }
  const w = await sw.worker();
  const info = await w.evaluate(async () => {
    const src = await (await fetch(self.location.href)).text();
    return {
      url: self.location.href.slice(0, 70),
      bgVersionTag: src.includes('group-h3-article-label-fix 2026-10-11c'),
      h3Closest: (src.match(/closest\('h3'\)/g) || []).length,
      articleRegex: /Lúc\\s\+\.,\\s\*\(\[\^:\]\+\?\):\\s\+\(\.\+\)/.test(src) || src.includes('Lúc\\s+.*,\\s*([^:]+?):\\s+(.+)'),
      mediaOverride: src.includes('mediaArticleSender'),
      quoteSkip: src.includes('inReplyQuote'),
    };
  });
  console.log('SW INFO:', JSON.stringify(info, null, 1));
  const wsState = await w.evaluate(() => ({ hasWs: typeof ws !== 'undefined' && !!ws, readyState: (typeof ws !== 'undefined' && ws) ? ws.readyState : -1 }));
  console.log('WS STATE:', JSON.stringify(wsState));
  browser.disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
