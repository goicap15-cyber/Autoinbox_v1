Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" -ErrorAction SilentlyContinue |
  Where-Object { ($_ | Select-Object -ExpandProperty CommandLine) -like '*pending_20261011095655*' } |
  Select-Object -First 1 -ExpandProperty CommandLine
