const fs = require('fs');
const path = require('path');

const PROFILES = 'C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/profiles';

async function main() {
  const puppeteer = (await import('puppeteer-core')).default || (await import('puppeteer-core'));
  const dirs = fs.readdirSync(PROFILES).filter((d) => {
    try { return fs.statSync(path.join(PROFILES, d)).isDirectory() && fs.existsSync(path.join(PROFILES, d, 'DevToolsActivePort')); } catch (_) { return false; }
  });
  for (const dir of dirs) {
    const portFile = path.join(PROFILES, dir, 'DevToolsActivePort');
    const [port, wsPath] = fs.readFileSync(portFile, 'utf8').trim().split('\n');
    const wsUrl = `ws://127.0.0.1:${port}${wsPath}`;
    let browser = null;
    try {
      browser = await puppeteer.connect({ browserWSEndpoint: wsUrl, defaultViewport: null });
    } catch (err) {
      console.log(`[profile ${dir}] CONNECT_FAIL ${err.message}`);
      continue;
    }
    try {
      const pages = await browser.pages();
      for (const page of pages) {
        const url = page.url() || '';
        if (!/facebook\.com\/messages|business\.facebook\.com/.test(url)) continue;
        const label = url.replace(/\?.*/, '').slice(0, 90);
        try {
          const probe = await page.evaluate(async () => {
            const t0 = performance.now();
            for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 100));
            const timerElapsed = performance.now() - t0;
            let raf = -1;
            await new Promise((resolve) => {
              let n = 0;
              const start = performance.now();
              const loop = () => {
                n += 1;
                if (performance.now() - start < 600) requestAnimationFrame(loop);
                else { raf = n; resolve(); }
              };
              requestAnimationFrame(loop);
              setTimeout(() => { if (raf === -1) { raf = n; resolve(); } }, 1200);
            });
            return { vis: document.visibilityState, timerElapsed: Math.round(timerElapsed), rafIn600ms: raf, hasFocus: document.hasFocus() };
          });
          console.log(`[profile ${dir}] ${label} :: vis=${probe.vis} timer10x100ms=${probe.timerElapsed}ms raf600=${probe.rafIn600ms} focus=${probe.hasFocus}`);
        } catch (err) {
          console.log(`[profile ${dir}] ${label} :: EVAL_FAIL ${err.message.slice(0, 80)}`);
        }
      }
    } finally {
      browser.disconnect();
    }
  }
}
main().catch((err) => { console.error('FATAL', err.message); process.exit(1); });
