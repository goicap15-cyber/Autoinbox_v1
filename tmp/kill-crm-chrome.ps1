$targets = Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*bin\chrome-win\chrome.exe*' -or $_.Path -like '*CRM_FB1*' }
$targets | ForEach-Object { Write-Output ("KILL " + $_.Id + " " + $_.Path) ; Stop-Process -Id $_.Id -Force }
Write-Output ("KILLED=" + $targets.Count)
$remaining = Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*bin\chrome-win\chrome.exe*' -or $_.Path -like '*CRM_FB1*' }
Write-Output ("REMAINING_CRM_CHROME=" + $remaining.Count)
