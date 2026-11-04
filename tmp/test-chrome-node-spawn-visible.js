// Đối chứng: spawn chrome.exe trực tiếp bằng Node (không qua puppeteer) cùng
// args automation -> probe visibility. Nếu VISIBLE mà qua puppeteer thì HIDDEN
// thì thủ phạm nằm ở cách puppeteer spawn (env/flags/stdio).
const { spawn } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:\\Users\\Admin\\Downloads\\Duan\\CRM_FB1\\bin\\chrome-win\\chrome.exe';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ctrl-chrome-'));

function listChromeWindows(pid) {
  return new Promise((resolve) => {
    const script = `
Add-Type -TypeDefinition 'using System; using System.Text; using System.Runtime.InteropServices; public class WinProbe2 {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lp);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
}' -ErrorAction SilentlyContinue
$out = New-Object System.Collections.ArrayList
[void][WinProbe2]::EnumWindows({ param($h, $l)
  $procId = [uint32]0
  [void][WinProbe2]::GetWindowThreadProcessId($h, [ref]$procId)
  if ($procId -eq ${pid}) {
    $sb = New-Object System.Text.StringBuilder 128
    [void][WinProbe2]::GetClassName($h, $sb, 128)
    $state = 'H'
    if ([WinProbe2]::IsWindowVisible($h)) { $state = 'V' }
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
  const child = spawn(CHROME, [
    '--no-sandbox', '--lang=vi-VN', '--window-size=1200,860',
    `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore'] });
  console.log('PID=' + child.pid);
  await sleep(4000);
  console.log('NODE_SPAWN_T4s=' + await listChromeWindows(child.pid));
  const { execSync } = require('child_process');
  try { execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' }); } catch (_) {}
  process.exit(0);
})().catch((e) => { console.log('ERR=' + e.message); process.exit(1); });
