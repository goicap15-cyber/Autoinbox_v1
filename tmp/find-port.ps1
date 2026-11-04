$appPids = (Get-Process 'FB Messenger CRM' -ErrorAction SilentlyContinue).Id
$conns = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $appPids -contains $_.OwningProcess }
foreach ($c in $conns) { Write-Output ("LISTEN pid=" + $c.OwningProcess + " port=" + $c.LocalPort) }
