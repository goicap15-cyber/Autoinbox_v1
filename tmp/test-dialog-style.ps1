Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WDLG {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lp);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
"@
$targetPids = @(31552, 7252)
$found = New-Object System.Collections.ArrayList
$cb = [WDLG+EnumProc]{
  param($h, $l)
  $procId = [uint32]0
  [void][WDLG]::GetWindowThreadProcessId($h, [ref]$procId)
  if ($targetPids -contains [int]$procId) {
    $sbC = New-Object System.Text.StringBuilder 256
    [void][WDLG]::GetClassName($h, $sbC, 256)
    $sbT = New-Object System.Text.StringBuilder 512
    [void][WDLG]::GetWindowText($h, $sbT, 512)
    $r = New-Object WDLG+RECT
    [void][WDLG]::GetWindowRect($h, [ref]$r)
    $vis = [WDLG]::IsWindowVisible($h)
    $style = [WDLG]::GetWindowLong($h, -16)
    $ex = [WDLG]::GetWindowLong($h, -20)
    $app = (($ex -band 0x40000) -ne 0)
    $owner = [WDLG]::GetWindow($h, 4)
    [void]$found.Add("pid=$procId vis=$vis app=$app owner=$owner rect=($($r.L),$($r.T) $($r.R - $r.L)x$($r.B - $r.T)) style=0x$($style.ToString('X')) ex=0x$($ex.ToString('X')) class=$($sbC) title='$($sbT)'")
  }
  return $true
}
[void][WDLG]::EnumWindows($cb, [IntPtr]::Zero)
$found | ForEach-Object { Write-Output $_ }
