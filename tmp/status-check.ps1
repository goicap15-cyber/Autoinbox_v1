$app = Get-Process "FB Messenger CRM" -ErrorAction SilentlyContinue
Write-Output ("APP_PROCESSES=" + @($app).Count)
$chrome = Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" -ErrorAction SilentlyContinue |
  Where-Object { ([string]($_ | Select-Object -ExpandProperty CommandLine)) -like '*autochatbot*' }
Write-Output ("CRM_CHROME=" + @($chrome).Count)
$latest = Get-ChildItem "C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/profiles" -Directory |
  Sort-Object LastWriteTime -Descending | Select-Object -First 3
foreach ($d in $latest) { Write-Output ("PROFILE " + $d.Name + " | " + $d.LastWriteTime) }
$sw = Test-Path "C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/profiles/pending_20261011095655_using/DevToolsActivePort"
Write-Output ("SW_PORT_FILE=" + $sw)
