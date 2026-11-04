$procs = Get-Process | Where-Object { $_.Path -like '*CRM_FB1*' } | Select-Object Id, ProcessName, Path
$procs | Format-Table -AutoSize | Out-String
foreach ($p in $procs) {
  try { Stop-Process -Id $p.Id -Force -ErrorAction Stop; Write-Output "KILLED $($p.Id) $($p.ProcessName)" } catch { Write-Output "FAIL $($p.Id) $($_.Exception.Message)" }
}
