$p = Get-CimInstance Win32_Process -Filter "ProcessId=7244"
if ($p) { Write-Output "7244 ALIVE name=$($p.Name)" } else { Write-Output "7244 GONE" }
$shell = New-Object -ComObject Shell.Application
foreach ($win in $shell.Windows()) {
  try { $loc = $win.LocationURL; if ($loc -and $loc -like '*win-unpacked*') { Write-Output ("STILL OPEN: {0}" -f $loc) } } catch { }
}
Write-Output "explorer scan done"
