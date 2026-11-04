Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
$procs = Get-Process | Where-Object { $_.MainWindowTitle -match 'Messenger CRM' -and $_.MainWindowHandle -ne 0 }
if (-not $procs) { Write-Output "khong tim thay window CRM"; exit 1 }
foreach ($p in $procs) {
  Write-Output ("CRM window: PID {0} :: {1}" -f $p.Id, $p.MainWindowTitle)
  [Win32]::ShowWindow($p.MainWindowHandle, 9) | Out-Null
  [Win32]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
}
Write-Output "done - CRM window len tren"
