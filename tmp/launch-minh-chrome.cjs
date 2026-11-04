const puppeteer = require('puppeteer-core');
const fs = require('fs');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = 'C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/profiles/100016772407913';
const EXT = 'C:/Users/Admin/Downloads/Duan/CRM_FB1/release/win-unpacked/resources/extension';

(async () => {
  console.log('launching...');
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: false,
    ignoreDefaultArgs: ['--enable-automation'],
    userDataDir: PROFILE,
    defaultViewport: null,
    enableExtensions: true,
    args: [
      '--hide-crash-restore-bubble',
      '--disable-session-crashed-bubble',
      '--start-maximized',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-mode',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-features=IntensiveWakeUpThrottling',
      '--disable-popup-blocking',
      '--disable-notifications',
      '--autoplay-policy=no-user-gesture-required'
    ]
  });
  console.log('launched, installing extension...');
  try {
    await browser.installExtension(EXT);
    console.log('extension installed');
  } catch (e) {
    console.log('installExtension FAILED:', e.message);
  }
  const proc = browser.process();
  proc.on('exit', (code, sig) => {
    console.log('CHROME EXIT code=', code, 'signal=', sig);
    process.exit(0);
  });
  const pages = await browser.pages();
  const page = pages[0] || await browser.newPage();
  page.goto('https://www.facebook.com/messages/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => console.log('goto err:', e.message));
  console.log('running, waiting 45s...');
  await new Promise(r => setTimeout(r, 45000));
  const alive = proc && !proc.killed;
  console.log('after 45s chrome alive:', alive);
  if (alive) {
    const targets = browser.targets().map(t => t.type() + ':' + String(t.url()).slice(0, 60));
    console.log('TARGETS:', targets.join(' | '));
    console.log('done - leaving chrome open');
    browser.disconnect();
  } else {
    process.exit(0);
  }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
