# Register (or refresh) the Windows Task Scheduler job that runs the live
# gateway every weekday at 08:15 local. This PC is America/Chicago, and CT/ET
# shift DST together, so 08:15 CT is always 09:15 ET - five minutes before the
# gateway's own 09:20 ET window opens.
#
# Run once from an elevated or normal PowerShell:
#   powershell -ExecutionPolicy Bypass -File gateway\install-task.ps1
#
# Remove with:
#   Unregister-ScheduledTask -TaskName "LedgerDesk Live Gateway" -Confirm:$false
#
# LogonType Interactive = runs only while you are logged in (no password
# prompt, no stored credential). You are at the desk at 08:15 CT anyway.
# ExecutionTimeLimit 3h is a hard backstop; the script exits itself at 11:00 ET.

$ErrorActionPreference = "Stop"
$taskName = "LedgerDesk Live Gateway"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$runner = Join-Path $here "run-local.ps1"

if (-not (Test-Path $runner)) { throw "run-local.ps1 not found next to this script." }

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Minimized -File `"$runner`"" `
    -WorkingDirectory $here

$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At 08:15

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -WakeToRun `
    -ExecutionTimeLimit (New-TimeSpan -Hours 3) `
    -MultipleInstances IgnoreNew `
    -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 1)

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Set-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal | Out-Null
    Write-Host "Updated task '$taskName'."
} else {
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "ledger-desk Databento live tick gateway, weekdays 09:20-11:00 ET" | Out-Null
    Write-Host "Registered task '$taskName'."
}

$t = Get-ScheduledTask -TaskName $taskName
$info = $t | Get-ScheduledTaskInfo
Write-Host ("State: {0}   Next run: {1}" -f $t.State, $info.NextRunTime)
Write-Host "Test now:  Start-ScheduledTask -TaskName '$taskName'   (then check gateway\logs\)"
