$filePath = 'C:\Users\Admin\Downloads\Duan\CRM_FB1\release\win-unpacked.tmp\resources\default_app.asar'

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class RestartManager {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct RM_UNIQUE_PROCESS { public int dwProcessId; public System.Runtime.InteropServices.ComTypes.FILETIME ProcessStartTime; }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct RM_PROCESS_INFO {
    public RM_UNIQUE_PROCESS Process;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string strAppName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string strServiceShortName;
    public int ApplicationType; public uint AppStatus; public uint TSSessionId;
    [MarshalAs(UnmanagedType.Bool)] public bool bRestartable;
  }

  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
  public static extern int RmRegisterResources(uint pSessionHandle, uint nFiles, string[] rgsFilenames, uint nApplications, RM_UNIQUE_PROCESS[] rgApplications, uint nServices, string[] rgsServiceNames);

  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
  public static extern int RmStartSession(out uint pSessionHandle, int dwSessionFlags, string strSessionKey);

  [DllImport("rstrtmgr.dll")]
  public static extern int RmEndSession(uint pSessionHandle);

  [DllImport("rstrtmgr.dll")]
  public static extern int RmGetList(uint dwSessionHandle, out uint pnProcInfoNeeded, ref uint pnProcInfo, [In, Out] RM_PROCESS_INFO[] rgAffectedApps, ref uint lpdwRebootReasons);
}
"@

$session = 0
$key = [Guid]::NewGuid().ToString()
$result = [RestartManager]::RmStartSession([ref]$session, 0, $key)
if ($result -ne 0) { Write-Host "RmStartSession failed: $result"; exit 1 }

$result = [RestartManager]::RmRegisterResources($session, 1, @($filePath), 0, $null, 0, $null)
if ($result -ne 0) { Write-Host "RmRegisterResources failed: $result"; [RestartManager]::RmEndSession($session) | Out-Null; exit 1 }

$needed = 0
$count = 10
$reasons = 0
$info = New-Object RestartManager+RM_PROCESS_INFO[] $count
$result = [RestartManager]::RmGetList($session, [ref]$needed, [ref]$count, $info, [ref]$reasons)
if ($result -ne 0) { Write-Host "RmGetList failed: $result"; [RestartManager]::RmEndSession($session) | Out-Null; exit 1 }

if ($count -eq 0) { Write-Host "NO PROCESS HOLDING FILE (Restart Manager sees none)" }
else {
  for ($i = 0; $i -lt $count; $i++) {
    $procId = $info[$i].Process.dwProcessId
    $appName = $info[$i].strAppName
    Write-Host "HOLDER: PID=$procId App=$appName"
    try { $p = Get-Process -Id $procId -ErrorAction Stop; Write-Host "  Name=$($p.ProcessName) Path=$($p.Path)" } catch { Write-Host "  (process gone)" }
  }
}
[RestartManager]::RmEndSession($session) | Out-Null
