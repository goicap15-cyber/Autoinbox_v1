// End-to-end test of the ON/OFF toggle mechanism:
// OFF (hideAccountProcess) -> window invisible + taskbar button gone + process ALIVE
// ON  (unhideWindow)       -> window visible again + taskbar button back
// close                    -> graceful, no ghost button
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const processManagerModule = require('../src/server/services/ProcessManager');
const { ProcessManager, closeChromePidsGracefullySync } = processManagerModule;

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const UDD = path.join(process.env.TEMP, `crm-hide-test-${Date.now()}`);
fs.mkdirSync(UDD, { recursive: true });

function winState(pid) {
  const ps = `
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WS {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lp);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
}
'@
$found = New-Object System.Collections.ArrayList
$cb = [WS+EnumProc]{
  param($h, $l)
  $procId = [uint32]0
  [void][WS]::GetWindowThreadProcessId($h, [ref]$procId)
  if ($procId -eq ${pid}) {
    $sbC = New-Object System.Text.StringBuilder 128
    [void][WS]::GetClassName($h, $sbC, 128)
    if ($sbC.ToString().StartsWith('Chrome_WidgetWin')) {
      $sbT = New-Object System.Text.StringBuilder 256
      [void][WS]::GetWindowText($h, $sbT, 256)
      [void]$found.Add('cls=' + $sbC + ' vis=' + [WS]::IsWindowVisible($h) + " title='" + $sbT + "'")
    }
  }
  return $true
}
[void][WS]::EnumWindows($cb, [IntPtr]::Zero)
$found | ForEach-Object { Write-Output $_ }
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, 'Shell_TrayWnd')
$tray = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
$btnCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
$buttons = $tray.FindAll([System.Windows.Automation.TreeScope]::Descendants, $btnCond)
foreach ($b in $buttons) { if ($b.Current.AutomationId -like '*crm-hide-test*') { Write-Output ('TASKBAR: ' + $b.Current.Name + ' | ' + $b.Current.AutomationId) } }
`;
  const encoded = Buffer.from(ps, 'utf16le').toString('base64');
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { encoding: 'utf8', timeout: 30000, windowsHide: true });
  return String(r.stdout || '').trim() || '(nothing)';
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (_) { return false; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const child = spawn(CHROME, [`--user-data-dir=${UDD}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { detached: true, stdio: 'ignore' });
  child.unref();
  const pid = child.pid;
  console.log('scratch chrome pid:', pid);
  await sleep(5000);
  console.log('\n=== AFTER OPEN (expect vis=True + taskbar button) ===');
  console.log(winState(pid));

  const manager = new ProcessManager();
  manager.processes = new Map();
  manager.processes.set('acc-scratch', { pid, profileDir: UDD, status: 'RUNNING', displayMode: 'VISIBLE' });

  console.log('\n=== TOGGLE OFF (hideAccountProcess) ===');
  const hideRes = await manager.hideAccountProcess('acc-scratch');
  console.log('hide result:', hideRes);
  await sleep(2500);
  console.log('alive after OFF:', alive(pid));
  console.log(winState(pid));

  console.log('\n=== TOGGLE ON (unhideWindow) ===');
  const unhideRes = await manager.unhideWindow('acc-scratch');
  console.log('unhide result:', unhideRes);
  await sleep(3000);
  console.log(winState(pid));

  console.log('\n=== CLOSE gracefully ===');
  const still = closeChromePidsGracefullySync([pid], 4000);
  console.log('still alive:', still);
  await sleep(1500);
  console.log(winState(pid));
  spawnSync('cmd.exe', ['/c', 'rd', '/s', '/q', UDD], { timeout: 15000 });
  console.log('done');
  process.exit(0);
})();
