$procs = Get-Process | Where-Object { $_.Path -like '*CRM_FB1*' }
if ($procs) {
  foreach ($p in $procs) {
    Write-Host "Killing: $($p.Id) - $($p.ProcessName) - $($p.Path)"
    Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Seconds 2
} else {
  Write-Host "No CRM_FB1 processes found"
}
