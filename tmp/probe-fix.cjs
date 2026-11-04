const fs = require('fs');
const path = require('path');

const PROFILE = 'C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/profiles/pending_20261001093516_qiaxz';

async function rafProbe(page) {
  return page.evaluate(() => new Promise((resolve) => {
    let n = 0;
    const start = performance.now();
    const loop = () => { n += 1; if (performance.now() - start < 800) requestAnimationFrame(loop); else resolve(n); };
    requestAnimationFrame(loop);
    setTimeout(() => resolve(n), 1500);
  }));
}

async function main() {
  const puppeteer = (await import('puppeteer-core')).default || (await import('puppeteer-core'));
  const [port, wsPath] = fs.readFileSync(path.join(PROFILE, 'DevToolsActivePort'), 'utf8').trim().split('\n');
  const browser = await puppeteer.connect({ browserWSEndpoint: `ws://127.0.0.1:${port}${wsPath}`, defaultViewport: null });
  const pages = (await browser.pages()).filter((p) => /facebook\.com\/messages/.test(p.url() || ''));
  if (!pages.length) { console.log('no messages tab'); browser.disconnect(); return; }
  const page = pages[0];
  console.log('target:', page.url().replace(/[?#].*/, ''));

  const state = async () => page.evaluate(() => document.visibilityState).catch(() => 'ERR');
  console.log('baseline vis=' + await state() + ' raf=' + await rafProbe(page));

  const sess = await page.createCDPSession();
  try { await sess.send('Page.setWebLifecycleState', { state: 'active' }); console.log('setWebLifecycleState: OK'); } catch (e) { console.log('setWebLifecycleState FAIL: ' + e.message.slice(0, 70)); }
  console.log('after lifecycle vis=' + await state() + ' raf=' + await rafProbe(page));

  try { await sess.send('Emulation.setFocusEmulationEnabled', { enabled: true }); console.log('setFocusEmulationEnabled: OK'); } catch (e) { console.log('setFocusEmulationEnabled FAIL: ' + e.message.slice(0, 70)); }
  console.log('after focus-emul vis=' + await state() + ' raf=' + await rafProbe(page));

  try { await sess.send('Page.setWebLifecycleState', { state: 'active' }); } catch (_) {}
  console.log('after both vis=' + await state() + ' raf=' + await rafProbe(page));
  try { await sess.detach(); } catch (_) {}
  browser.disconnect();
}
main().catch((err) => { console.error('FATAL', err.message); process.exit(1); });
