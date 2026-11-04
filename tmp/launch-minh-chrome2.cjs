const puppeteer = require('puppeteer-core');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = 'C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/profiles/100016772407913';
const EXT = 'C:/Users/Admin/Downloads/Duan/CRM_FB1/release/win-unpacked/resources/extension';
const t0 = Date.now();
const ts = () => `[T+${((Date.now() - t0) / 1000).toFixed(1)}s]`;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: false, ignoreDefaultArgs: ['--enable-automation'],
    userDataDir: PROFILE, defaultViewport: null, enableExtensions: true,
    args: ['--hide-crash-restore-bubble', '--disable-session-crashed-bubble', '--start-maximized',
      '--no-first-run', '--no-default-browser-check', '--disable-background-mode',
      '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding', '--disable-features=IntensiveWakeUpThrottling',
      '--disable-popup-blocking', '--disable-notifications', '--autoplay-policy=no-user-gesture-required']
  });
  const proc = browser.process();
  proc.on('exit', (code, sig) => { console.log(ts(), 'CHROME EXIT code=', code, 'signal=', sig); process.exit(0); });
  console.log(ts(), 'launched pid=', proc.pid);
  try { await browser.installExtension(EXT); console.log(ts(), 'ext installed'); } catch (e) { console.log(ts(), 'ext FAILED:', e.message); }
  const pages = await browser.pages();
  const page = pages[0] || await browser.newPage();
  page.goto('https://www.facebook.com/messages/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => console.log(ts(), 'goto err:', e.message));
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 1000));
    try { process.kill(proc.pid, 0); } catch { console.log(ts(), 'process gone (poll)'); process.exit(0); }
    if (i % 10 === 9) {
      try {
        const tg = browser.targets().length;
        console.log(ts(), 'alive, targets=', tg, 'pages=', (await browser.pages()).length);
      } catch (e) { console.log(ts(), 'CDP err:', e.message); }
    }
  }
  console.log(ts(), 'survived 60s - leaving open, disconnecting');
  browser.disconnect();
})().catch(e => { console.error(ts(), 'ERR', e.message); process.exit(1); });
