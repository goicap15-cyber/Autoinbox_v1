Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*win-unpacked*' -or $_.Path -like '*CRM_FB1*' } | ForEach-Object {
  Write-Output ('ORPHAN=' + $_.Id + ' ' + $_.Path)
  Stop-Process -Id $_.Id -Force
}
Write-Output 'SCAN_DONE'
