$crm = Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*autochatbot-fb-crm*' }
Write-Output ("CRM_CHROME=" + @($crm).Count)
