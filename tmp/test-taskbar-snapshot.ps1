Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinEnum {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lp);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int n);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
"@

$chromePids = @(Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" | Select-Object -ExpandProperty ProcessId)
$pidSet = @{}
foreach ($p in $chromePids) { $pidSet[[uint32]$p] = $true }
Write-Output ("CHROME_PIDS: " + ($chromePids -join ','))

$found = New-Object System.Collections.ArrayList
$cb = [WinEnum+EnumProc]{
  param($h, $l)
  $procId = [uint32]0
  [void][WinEnum]::GetWindowThreadProcessId($h, [ref]$procId)
  if ($pidSet.ContainsKey($procId)) {
    $sbT = New-Object System.Text.StringBuilder 512
    $sbC = New-Object System.Text.StringBuilder 256
    [void][WinEnum]::GetWindowText($h, $sbT, 512)
    [void][WinEnum]::GetClassName($h, $sbC, 256)
    $r = New-Object WinEnum+RECT
    [void][WinEnum]::GetWindowRect($h, [ref]$r)
    $style = [WinEnum]::GetWindowLong($h, -16)
    $exStyle = [WinEnum]::GetWindowLong($h, -20)
    $visible = [WinEnum]::IsWindowVisible($h)
    $isAppWin = ($exStyle -band 0x00040000) -ne 0
    $isTool = ($exStyle -band 0x00000080) -ne 0
    $offscreen = ($r.L -lt -20000 -or $r.T -lt -20000)
    [void]$found.Add("pid=$procId vis=$visible app=$isAppWin tool=$isTool off=$offscreen rect=($($r.L),$($r.T),$($r.R - $r.L)x$($r.B - $r.T)) class=$($sbC) title='$($sbT)'")
  }
  return $true
}
[void][WinEnum]::EnumWindows($cb, [IntPtr]::Zero)
Write-Output "--- chrome-owned top-level windows ---"
$found | ForEach-Object { Write-Output $_ }

Write-Output "--- taskbar buttons (UIA Shell_TrayWnd -> children with AutomationId running) ---"
$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, 'Shell_TrayWnd')
$tray = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
if ($tray) {
  $btnCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
  $buttons = $tray.FindAll([System.Windows.Automation.TreeScope]::Descendants, $btnCond)
  foreach ($b in $buttons) {
    $name = $b.Current.Name
    if ($name -and $name -ne '') { Write-Output ("BTN: " + $name) }
  }
} else { Write-Output "NO Shell_TrayWnd" }
