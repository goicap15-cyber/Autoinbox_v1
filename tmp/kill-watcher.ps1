$kids = Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq 12776 }
foreach ($k in $kids) { Write-Output ("child pid=" + $k.ProcessId + " name=" + $k.Name) }
$kids | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Stop-Process -Id 12776 -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500
$alive = Get-Process -Id 12776 -ErrorAction SilentlyContinue
Write-Output ("bash12776 alive: " + [bool]$alive)
