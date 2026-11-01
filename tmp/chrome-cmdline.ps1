Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" -ErrorAction SilentlyContinue |
  Where-Object { ($_ | Select-Object -ExpandProperty CommandLine) -like '*autochatbot-fb-crm*' -and ($_ | Select-Object -ExpandProperty CommandLine) -like '*user-data-dir*pending_20261011082737*' } |
  Select-Object -First 1 -ExpandProperty CommandLine
