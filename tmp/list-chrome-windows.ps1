Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinEnum {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out int attrValue, int attrSize);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

$script:results = New-Object System.Collections.ArrayList
$cb = [WinEnum+EnumWindowsProc]{
  param($hWnd, $lParam)
  $procId = 0
  [WinEnum]::GetWindowThreadProcessId($hWnd, [ref]$procId) | Out-Null
  $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
  if ($proc -and $proc.ProcessName -match 'chrome') {
    $sb = New-Object System.Text.StringBuilder 512
    [WinEnum]::GetWindowText($hWnd, $sb, 512) | Out-Null
    $title = $sb.ToString()
    $cb2 = New-Object System.Text.StringBuilder 256
    [WinEnum]::GetClassName($hWnd, $cb2, 256) | Out-Null
    $cls = $cb2.ToString()
    $visible = [WinEnum]::IsWindowVisible($hWnd)
    $rect = New-Object WinEnum+RECT
    [WinEnum]::GetWindowRect($hWnd, [ref]$rect) | Out-Null
    $cloaked = 0
    [WinEnum]::DwmGetWindowAttribute($hWnd, 14, [ref]$cloaked, 4) | Out-Null
    $ex = [WinEnum]::GetWindowLong($hWnd, -20)
    $exNoActivate = [bool]($ex -band 0x08000000)
    $exToolWindow = [bool]($ex -band 0x00000080)
    [void]$script:results.Add([PSCustomObject]@{
      PID      = $procId
      Path     = if ($proc.Path) { $proc.Path } else { '?' }
      Title    = if ($title) { $title.Substring(0, [Math]::Min(60, $title.Length)) } else { '(empty)' }
      Visible  = $visible
      Cloaked  = $cloaked
      NoAct    = $exNoActivate
      Tool     = $exToolWindow
      Rect     = "$($rect.Left),$($rect.Top) $($rect.Right-$rect.Left)x$($rect.Bottom-$rect.Top)"
    })
  }
  return $true
}
[WinEnum]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null

Write-Output "=== TOP-LEVEL WINDOWS cua chrome.exe ==="
$script:results | Format-Table -AutoSize | Out-String -Width 240

Write-Output "=== PROCESS chrome.exe ==="
Get-Process chrome -ErrorAction SilentlyContinue | Group-Object Path | ForEach-Object {
  $g = $_.Group
  Write-Output ("{0}  x{1}  mem={2}MB" -f $_.Name, $g.Count, [int](($g | Measure-Object WorkingSet64 -Sum).Sum / 1MB))
  $main = $g | Where-Object { $_.MainWindowHandle -ne 0 }
  foreach ($m in $main) { Write-Output ("    PID {0} MainWindowTitle: {1}" -f $m.Id, $m.MainWindowTitle) }
}
