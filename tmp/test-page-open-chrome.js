// Test that simulates the mechanism of the CRM app opening a Page:
// 1) spawn chrome with a scratch profile (as openBusinessTabForPage does when puppeteer is disconnected)
// 2) spawn more times with the SAME profile (each Page opens once)
// 3) measure the number of ROOT instances + taskbar buttons at each step
// 4) gracefully close, measure the taskbar again (should leave no ghost buttons)
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { closeChromePidsGracefullySync } = require('../src/server/services/ProcessManager');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const UDD = path.join(process.env.TEMP, `crm-scratch-udd-${Date.now()}`);
fs.mkdirSync(UDD, { recursive: true });

function snapshot() {
  const ps = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, 'Shell_TrayWnd')
$tray = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
$btnCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
$buttons = $tray.FindAll([System.Windows.Automation.TreeScope]::Descendants, $btnCond)
foreach ($b in $buttons) { if ($b.Current.Name -like '*Chrome*') { Write-Output ('BTN: ' + $b.Current.Name + ' | ' + $b.Current.AutomationId) } }
$procs = Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'"
$all = @{}; foreach ($p in $procs) { $all[[uint32]$p.ProcessId] = $true }
$roots = $procs | Where-Object { -not $all.ContainsKey([uint32]$_.ParentProcessId) -and $_.CommandLine -match 'crm-scratch-udd' }
foreach ($r in $roots) { Write-Output ('SCRATCH_ROOT: ' + $r.ProcessId) }
$w = $roots | Where-Object { $_.CommandLine -notmatch '--type=' }
Write-Output ('SCRATCH_MAIN_COUNT: ' + ($w | Measure-Object).Count)
`;
  const encoded = Buffer.from(ps, 'utf16le').toString('base64');
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { encoding: 'utf8', timeout: 30000, windowsHide: true });
  return String(r.stdout || '').trim();
}

function spawnChrome(url) {
  const child = spawn(CHROME, [`--user-data-dir=${UDD}`, '--no-first-run', '--no-default-browser-check', '--hide-crash-restore-bubble', url], { detached: true, stdio: 'ignore' });
  child.unref();
  return child.pid;
}

(async () => {
  console.log('=== STEP 0: taskbar BEFORE ===');
  console.log(snapshot());

  const pid1 = spawnChrome('https://example.com/page-A');
  console.log('\n=== STEP 1: opened chrome (scratch profile) pid=' + pid1 + ' - wait 4s ===');
  await new Promise(r => setTimeout(r, 4000));
  console.log(snapshot());

  const pid2 = spawnChrome('https://example.com/page-B');
  console.log('\n=== STEP 2: "opened Page B" (same profile) pid=' + pid2 + ' - wait 4s ===');
  await new Promise(r => setTimeout(r, 4000));
  console.log(snapshot());

  const pid3 = spawnChrome('https://example.com/page-C');
  console.log('\n=== STEP 3: "opened Page C" (same profile) pid=' + pid3 + ' - wait 4s ===');
  await new Promise(r => setTimeout(r, 4000));
  console.log(snapshot());

  console.log('\n=== STEP 4: gracefully close the root (WM_CLOSE, as the new stopAccountProcess does) ===');
  const alive = closeChromePidsGracefullySync([pid1], 5000);
  console.log('alive after graceful close:', alive);
  await new Promise(r => setTimeout(r, 2000));
  console.log(snapshot());

  console.log('\nSTEP5: cleanup scratch dir');
  spawnSync('cmd.exe', ['/c', 'rd', '/s', '/q', UDD], { timeout: 15000 });
  console.log('done');
  process.exit(0);
})();
