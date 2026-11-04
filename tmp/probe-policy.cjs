const fs = require('fs');
const path = require('path');

const PROFILE = 'C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/profiles/pending_20261001093516_qiaxz';

async function main() {
  const puppeteer = (await import('puppeteer-core')).default || (await import('puppeteer-core'));
  const [port, wsPath] = fs.readFileSync(path.join(PROFILE, 'DevToolsActivePort'), 'utf8').trim().split('\n');
  const browser = await puppeteer.connect({ browserWSEndpoint: `ws://127.0.0.1:${port}${wsPath}`, defaultViewport: null });

  // 1) Read chrome://policy
  let policyTab = null;
  try {
    policyTab = await browser.newPage();
    await policyTab.goto('chrome://policy', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));
    const text = await policyTab.evaluate(() => document.body.innerText).catch(() => '');
    const hasOccl = /WindowOcclusionEnabled/i.test(text);
    const valueOk = /WindowOcclusionEnabled[\s\S]{0,80}?0(?!\d)/i.test(text);
    const errorFree = !/error|conflict/i.test(text.split('WindowOcclusionEnabled')[1] || '');
    console.log(`POLICY: present=${hasOccl} value0=${valueOk} clean=${errorFree}`);
  } catch (err) {
    console.log('POLICY read FAIL: ' + err.message.slice(0, 80));
  } finally {
    if (policyTab) await policyTab.close().catch(() => {});
  }

  // 2) Probe messages tabs with retries (dodge sweep navigation)
  const pages = (await browser.pages()).filter((p) => /facebook\.com\/messages/.test(p.url() || ''));
  for (const page of pages) {
    const url = page.url().replace(/[?#].*/, '').slice(0, 60);
    let got = null;
    for (let i = 0; i < 4 && !got; i += 1) {
      got = await page.evaluate(async () => {
        const t0 = performance.now();
        for (let k = 0; k < 10; k += 1) await new Promise((r) => setTimeout(r, 100));
        let raf = -1;
        await new Promise((resolve) => {
          let n = 0; const start = performance.now();
          const loop = () => { n += 1; if (performance.now() - start < 600) requestAnimationFrame(loop); else { raf = n; resolve(); } };
          requestAnimationFrame(loop);
          setTimeout(() => { if (raf === -1) { raf = n; resolve(); } }, 1200);
        });
        return { vis: document.visibilityState, timer: Math.round(performance.now() - t0), raf };
      }).catch(() => null);
      if (!got) await new Promise((r) => setTimeout(r, 1500));
    }
    if (got) console.log(`${url} :: vis=${got.vis} timer=${got.timer}ms raf600=${got.raf}`);
    else console.log(`${url} :: EVAL_FAIL x4 (tab đang bị navigate liên tục)`);
  }
  browser.disconnect();
}
main().catch((err) => { console.error('FATAL', err.message); process.exit(1); });
