# Kill CHỈ process của CRM: "FB Messenger CRM.exe" + chrome.exe do CRM bundle
# (bin\chrome-win). KHÔNG match Path/Title chung chung "FB|CRM|Messenger" -
# bản cũ từng giết nhầm IDE khác (Antigravity) và Chrome trình duyệt của user.
Get-Process | Where-Object { $_.ProcessName -eq 'FB Messenger CRM' } | ForEach-Object {
    Write-Host "Killing: $($_.Id) - $($_.ProcessName)"
    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
}
Get-Process | Where-Object { $_.ProcessName -eq 'chrome' -and $_.Path -like '*win-unpacked*chrome-win*' } | ForEach-Object {
    Write-Host "Killing bundled chrome: $($_.Id)"
    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 3
Write-Host "Done"
