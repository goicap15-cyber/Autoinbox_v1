Get-Process | Where-Object { $_.Path -like '*CRM_FB1\release\win-unpacked*' } |
  ForEach-Object { Stop-Process -Id $_.Id -Force; Write-Output ("killed " + $_.Id + " " + $_.ProcessName) }
