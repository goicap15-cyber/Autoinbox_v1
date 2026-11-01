$procs = Get-Process chrome,chrome_proxy -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*CRM_FB1*' -or $_.Path -like '*win-unpacked*' -or $_.Path -like '*autochatbot-fb-crm*' }
if (-not $procs) {
  Write-Output 'NO_CRM_CHROME_ORPHANS'
} else {
  foreach ($p in $procs) {
    Write-Output "Killing chrome orphan: $($p.Id) $($p.Path)"
    Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Seconds 2
  Write-Output 'DONE'
}
