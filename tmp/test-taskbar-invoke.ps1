Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FG {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder sb, int max);
}
"@

function Get-FgTitle {
  $h = [FG]::GetForegroundWindow()
  $sb = New-Object System.Text.StringBuilder 512
  [void][FG]::GetWindowText($h, $sb, 512)
  return $sb.ToString()
}

$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, 'Shell_TrayWnd')
$tray = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
$btnCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
$buttons = $tray.FindAll([System.Windows.Automation.TreeScope]::Descendants, $btnCond)

$idx = 0
foreach ($b in $buttons) {
  $name = $b.Current.Name
  if ($name -like 'Google Chrome*') {
    $idx++
    Write-Output ("=== Chrome button #$idx name='$name' autoId='" + $b.Current.AutomationId + "' runtimeId='" + (($b.GetRuntimeId()) -join ',') + "' ===")
    $before = Get-FgTitle
    Write-Output ("  foreground BEFORE: '$before'")
    try {
      $inv = $b.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
      $inv.Invoke()
    } catch {
      Write-Output ("  INVOKE FAILED: " + $_.Exception.Message)
      continue
    }
    Start-Sleep -Milliseconds 1500
    $after = Get-FgTitle
    Write-Output ("  foreground AFTER : '$after'")
    if ($after -ne $before) { Write-Output "  => BUTTON IS LIVE (window came up)" }
    else { Write-Output "  => BUTTON DID NOTHING (possible ghost)" }
  }
}
Write-Output "done"
