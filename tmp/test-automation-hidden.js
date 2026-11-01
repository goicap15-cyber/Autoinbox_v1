// Test cơ chế "automation Chrome chạy ngầm": launch headful giống
// launchAutomationChrome (bundled Chrome + args) -> đo visibility cửa sổ ->
// hide qua ProcessManager.hideChromeWindowFromScreen -> đo lại -> chứng minh
// CDP vẫn điều khiển được window ẩn (navigate + lấy title) -> đóng sạch.
const path = require('path');

const ROOT = 'C:/Users/Admin/Downloads/Duan/CRM_FB1';
const { resolveChromePath } = require(path.join(ROOT, 'chrome-bundling/resolveChromePath'));
const { resolveBinRoot } = require(path.join(ROOT, 'src/server/utils/appResourceRoot'));
const pm = require(path.join(ROOT, 'src/server/services/ProcessManager'));

function listChromeWindows(pid) {
  return new Promise((resolve) => {
    const script = `
Add-Type -TypeDefinition 'using System; using System.Text; using System.Runtime.InteropServices; public class WinProbe {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lp);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
}' -ErrorAction SilentlyContinue
$out = New-Object System.Collections.ArrayList
[void][WinProbe]::EnumWindows({ param($h, $l)
  $procId = [uint32]0
  [void][WinProbe]::GetWindowThreadProcessId($h, [ref]$procId)
  if ($procId -eq ${pid}) {
    $sb = New-Object System.Text.StringBuilder 128
    [void][WinProbe]::GetClassName($h, $sb, 128)
    $state = 'H'
    if ([WinProbe]::IsWindowVisible($h)) { $state = 'V' }
    [void]$out.Add($sb.ToString() + ':' + $state)
  }
  return $true
}, [IntPtr]::Zero)
$out -join ','`;
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const { execFile } = require('child_process');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { encoding: 'utf8' }, (err, stdout) => resolve(err ? 'ERR:' + err.message : String(stdout).trim() || 'NONE'));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const args = ['--no-sandbox', '--lang=vi-VN', '--window-size=1200,860'];
  const base = { headless: false, args, defaultViewport: null };
  let exe = null;
  try { exe = resolveChromePath({ repoRoot: resolveBinRoot() }); } catch (_) {}
  const candidates = [
    ...(exe ? [{ ...base, executablePath: exe }] : []),
    base,
    { ...base, channel: 'chrome' },
    { ...base, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' },
  ];
  const puppeteer = (await import('puppeteer-core')).default || (await import('puppeteer-core'));

  let browser = null;
  for (const opt of candidates) {
    try { browser = await puppeteer.launch(opt); break; } catch (e) { /* next */ }
  }
  if (!browser) { console.log('LAUNCH_FAIL'); process.exit(1); }

  const pid = browser.process()?.pid;
  const exeUsed = browser.process()?.spawnargs?.[0] || '?';
  const userDataDir = (browser.process()?.spawnargs || []).find((a) => a.startsWith('--user-data-dir=')) || '';
  console.log('PID=' + pid + ' EXE=' + exeUsed);

  // Giống app: khởi watcher ngay sau launch, KHÔNG ẩn tay từng lần
  pm.spawnChromeHideWatcher(pid);
  await sleep(1500); // đợi PS watcher boot xong

  console.log('T1.5s=' + await listChromeWindows(pid));

  // CDP vẫn chạy trên window ẩn: mở tab + navigate + đọc title
  const page = await browser.newPage();
  await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 20000 });
  const title = await page.title();
  console.log('CDP_TITLE=' + title);

  // Popup sinh sau phải bị watcher ẩn trong ~250ms
  await page.evaluate(() => window.open('https://example.com', '_blank', 'width=500,height=600'));
  await sleep(1200);
  console.log('POPUP_+1.2s=' + await listChromeWindows(pid));
  await sleep(2000);
  console.log('POPUP_+3.2s=' + await listChromeWindows(pid));

  await browser.close();
  await sleep(1500);
  const alive = (() => {
    try { require('child_process').execSync(`tasklist /FI "PID eq ${pid}" /NH`, { encoding: 'utf8' }); return true; }
    catch (_) { return false; }
  })();
  const aliveOut = require('child_process').execSync(`tasklist /FI "PID eq ${pid}" /NH`, { encoding: 'utf8' }).includes(pid.toString());
  console.log('CLOSED=' + (aliveOut ? 'STILL_ALIVE' : 'EXITED'));
  process.exit(0);
})().catch((e) => { console.log('HARNESS_ERROR=' + (e.message || e)); process.exit(1); });
