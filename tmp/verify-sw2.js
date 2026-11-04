const puppeteer = require('puppeteer-core');
const fs = require('fs');

(async () => {
  const profDir = 'C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/profiles/pending_20261011095655_using';
  const port = fs.readFileSync(profDir + '/DevToolsActivePort', 'utf8').split('\n')[0].trim();
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:' + port, defaultViewport: null });
  const targets = browser.targets();
  const sw = targets.find(t => t.type() === 'service_worker' && (t.url() || '').includes('background'));
  if (!sw) {
    console.log('NO_SW_TARGET |', targets.map(t => t.type() + ':' + (t.url() || '').slice(0, 50)).join(' ; '));
    await browser.disconnect(); return;
  }
  const worker = await sw.worker();
  const res = await worker.evaluate(async () => {
    const src = await fetch(self.location.href).then(r => r.text());
    return {
      url: (self.location && self.location.href).slice(0, 60),
      len: src.length,
      h3Closest: (src.match(/\(\s*"h3"\s*\)/g) || []).length,
      memberName: src.includes('member_name'),
      bgVersionTag: src.includes('group-h3-article-label-fix'),
      articleRegex: /L\u00fac/.test(src)
    };
  });
  console.log('SW_PROBE', JSON.stringify(res, null, 1));
  await browser.disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
