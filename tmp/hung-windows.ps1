Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WE3 {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder t, int c);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder t, int c);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, UIntPtr w, IntPtr l, uint flags, uint timeout, out UIntPtr result);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out int v, int s);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
}
"@

$hung = New-Object System.Collections.ArrayList
$cb = [WE3+EnumWindowsProc]{
  param($h, $l)
  $pid2 = 0
  [WE3]::GetWindowThreadProcessId($h, [ref]$pid2) | Out-Null
  $p = Get-Process -Id $pid2 -ErrorAction SilentlyContinue
  if ($p) {
    $v = [WE3]::IsWindowVisible($h)
    $cloaked = 0
    [WE3]::DwmGetWindowAttribute($h, 14, [ref]$cloaked, 4) | Out-Null
    $ex = [WE3]::GetWindowLong($h, -20)
    $tool = [bool]($ex -band 0x80)
    if ($v -and $cloaked -eq 0 -and -not $tool) {
      $res = [UIntPtr]::Zero
      $ok = [WE3]::SendMessageTimeout($h, 0, [UIntPtr]::Zero, [IntPtr]::Zero, 8, 500, [ref]$res)
      $hungFlag = ($ok -eq [IntPtr]::Zero)
      $t = New-Object System.Text.StringBuilder 256
      [WE3]::GetWindowText($h, $t, 256) | Out-Null
      $cn = New-Object System.Text.StringBuilder 128
      [WE3]::GetClassName($h, $cn, 128) | Out-Null
      $rectOk = $true
      [void]$out.Add([PSCustomObject]@{
        Proc  = $p.ProcessName
        PID   = $pid2
        Hung  = $hungFlag
        Class = $cn.ToString()
        Title = if ($t.ToString()) { $t.ToString().Substring(0, [Math]::Min(70, $t.Length)) } else { '(empty)' }
      })
    }
  }
  return $true
}
$out = New-Object System.Collections.ArrayList
[WE3]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null

Write-Output "=== WINDOW HUNG (k responsive - click khong duoc) ==="
$out | Where-Object { $_.Hung } | Format-Table -AutoSize | Out-String -Width 200

Write-Output "=== Toan bo window visible (loc chrome/CRM/FB) ==="
$out | Where-Object { $_.Proc -match 'chrome|CRM|FB|Messenger|Autoinbox' } | Format-Table -AutoSize | Out-String -Width 200
