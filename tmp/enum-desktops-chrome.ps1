Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class DeskEnum2 {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  public delegate bool EnumDesktopProc(string name, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumDesktops(IntPtr hwinsta, EnumDesktopProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern IntPtr GetProcessWindowStation();
  [DllImport("user32.dll")] public static extern IntPtr OpenDesktop(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);
  [DllImport("user32.dll")] public static extern bool EnumDesktopWindows(IntPtr hDesktop, EnumWindowsProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder t, int c);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder t, int c);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
"@

$script:rows = New-Object System.Collections.ArrayList
$deskCb = [DeskEnum2+EnumDesktopProc]{
  param($deskName, $lp)
  $hD = [DeskEnum2]::OpenDesktop($deskName, 0, $false, 0x01FF)
  if ($hD -ne [IntPtr]::Zero) {
    $winCb = [DeskEnum2+EnumWindowsProc]{
      param($h, $l2)
      $pid2 = 0
      [DeskEnum2]::GetWindowThreadProcessId($h, [ref]$pid2) | Out-Null
      $p = Get-Process -Id $pid2 -ErrorAction SilentlyContinue
      if ($p -and $p.ProcessName -eq 'chrome') {
        $r = New-Object DeskEnum2+RECT
        [DeskEnum2]::GetWindowRect($h, [ref]$r) | Out-Null
        $w = $r.R - $r.L; $hh = $r.B - $r.T
        $t = New-Object System.Text.StringBuilder 256
        [DeskEnum2]::GetWindowText($h, $t, 256) | Out-Null
        $cn = New-Object System.Text.StringBuilder 128
        [DeskEnum2]::GetClassName($h, $cn, 128) | Out-Null
        $v = [DeskEnum2]::IsWindowVisible($h)
        [void]$script:rows.Add([PSCustomObject]@{
          Desktop = $deskName
          PID     = $pid2
          Vis     = $v
          Rect    = "$($r.L),$($r.T) ${w}x$hh"
          Class   = $cn.ToString()
          Title   = $t.ToString()
        })
      }
      return $true
    }
    [DeskEnum2]::EnumDesktopWindows($hD, $winCb, [IntPtr]::Zero) | Out-Null
    [DeskEnum2]::CloseDesktop($hD) | Out-Null
  }
  return $true
}
[DeskEnum2]::EnumDesktops([DeskEnum2]::GetProcessWindowStation(), $deskCb, [IntPtr]::Zero) | Out-Null
$script:rows | Format-Table -AutoSize | Out-String -Width 260
