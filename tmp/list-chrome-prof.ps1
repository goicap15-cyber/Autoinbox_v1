Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" -ErrorAction SilentlyContinue |
  Where-Object { ($_ | Select-Object -ExpandProperty CommandLine) -like '*autochatbot-fb-crm*' -and ($_ | Select-Object -ExpandProperty CommandLine) -like '*user-data-dir*' } |
  ForEach-Object {
    if ($_.CommandLine -match '--user-data-dir=("[^"]+"|\S+)') { Write-Output $Matches[1] }
  } | Sort-Object -Unique
