const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = 'C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/profiles/pending_20261011110034_vs8k8';
const EXT = 'C:/Users/Admin/Downloads/Duan/CRM_FB1/release/win-unpacked/resources/extension';
const EXT_ID = 'kddcebkokjjjchokdlcjmbcdgggmcabl';

function hideWindow(pid) {
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W { [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c); }
"@
$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue
if ($p -and $p.MainWindowHandle -ne 0) { [W]::ShowWindow($p.MainWindowHandle, 0) | Out-Null; Write-Output "HIDDEN $($p.MainWindowHandle)" }
else { Write-Output "NO_WINDOW" }
`;
  const b64 = Buffer.from(script, 'utf16le').toString('base64');
  try { return execSync(`powershell -NoProfile -NonInteractive -EncodedCommand ${b64}`, { encoding: 'utf8', timeout: 20000 }).trim(); }
  catch (e) { return 'HIDE_ERR ' + e.message.slice(0, 60); }
}

(async () => {
  console.log('launching minh chrome (hidden after start)...');
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
  console.log('pid=', proc.pid);
  try { await browser.installExtension(EXT); console.log('ext installed'); } catch (e) { console.log('ext FAILED:', e.message); }
  const pages = await browser.pages();
  const page = pages[0] || await browser.newPage();
  page.goto('https://www.facebook.com/messages/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 5000));
  console.log('hide:', hideWindow(proc.pid));
  // wait for SW + WS
  let wsOk = false;
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 5000));
    try {
      const sw = browser.targets().find(t => t.type() === 'service_worker' && String(t.url()).includes(EXT_ID));
      if (sw) {
        const st = await (await sw.worker()).evaluate(() => ({ hasWs: typeof ws !== 'undefined' && !!ws, rs: (typeof ws !== 'undefined' && ws) ? ws.readyState : -1 })).catch(() => null);
        console.log(`T+${(i + 1) * 5}s SW ok, ws=`, JSON.stringify(st));
        if (st && st.rs === 1) { wsOk = true; break; }
      } else {
        // wake it
        const p2 = await browser.newPage().catch(() => null);
        if (p2) { await p2.goto(`chrome-extension://${EXT_ID}/manifest.json`, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {}); await p2.close(); }
        console.log(`T+${(i + 1) * 5}s no SW target yet`);
      }
    } catch (e) { console.log(`T+${(i + 1) * 5}s probe err:`, e.message.slice(0, 50)); }
  }
  console.log('WS connected:', wsOk);
  console.log('hide again:', hideWindow(proc.pid));
  browser.disconnect();
  console.log('done - chrome left running (hidden)');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
