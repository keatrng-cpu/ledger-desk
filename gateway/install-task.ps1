# Register (or refresh) the Windows Task Scheduler job that runs the live
# gateway on this PC.
#
# Run once from a normal PowerShell (no admin needed):
#   powershell -ExecutionPolicy Bypass -File gateway\install-task.ps1
#
# Remove with:
#   Unregister-ScheduledTask -TaskName "LedgerDesk Live Gateway" -Confirm:$false
#
# GOAL (trader's call 2026-10-01): the gateway stays on THIS PC, and whenever
# the trader is signed in - i.e. whenever the desk can be open on this
# computer - it must be streaming. Not "at a scheduled hour", not "until the
# next trigger": always, within a minute of anything killing it.
#
# DESIGN: sign-in start + a one-minute keep-alive, no kill limit.
#
#   - At sign-in: starts the instant the trader signs in. 2026-10-01 is why:
#     Windows Update rebooted at 04:27 CT, the old 07:10 trigger was skipped
#     at the sign-in screen, and the trader signed in at 08:24 to a desk on
#     Yahoo (lag ~600s) into the NY open.
#   - Every minute: re-checks. MultipleInstances IgnoreNew makes this a no-op
#     while the gateway is alive, so there is never a second Databento Live
#     session on the key. If it died for ANY reason - crash, a clean exit, a
#     killed process - the next tick restarts it, at most ~60s later.
#   - ExecutionTimeLimit = none (PT0S). The old 6d12h limit existed only to
#     bridge the gap between a Sunday and a weekday trigger. With a one-minute
#     keep-alive there is no gap to bridge, and the limit itself was a
#     scheduled outage: an instance started Thu 2026-10-01 08:31 would have
#     been killed Wed 2026-10-07 20:31 CT and stayed dark until Thursday's
#     07:10 trigger - through the London session. Long-run health is the
#     gateway's own job and it does it: the Databento client drops a silent
#     socket after 40s (heartbeat 30s + 10s margin, databento live/session.py
#     _heartbeat_monitor) and run_forever() reconnects; a dead Postgres
#     connection is marked closed by psycopg and _db() reopens it.
#   - No WakeToRun. A trigger that repeats every minute with WakeToRun would
#     wake a sleeping laptop every minute. Asleep means the desk is not open
#     here; on wake the suspended gateway's socket times out within ~40s and
#     reconnects on its own, and the keep-alive covers anything worse.
#
# Scope, stated plainly: LogonType Interactive = runs only while signed in
# (no stored password). Signed out, asleep, or off = no live data, and the
# desk falls back to Databento historical / Yahoo with the lag shown. That is
# the agreed boundary - a cloud host was considered and declined 2026-10-01.

$ErrorActionPreference = "Stop"
$taskName = "LedgerDesk Live Gateway"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$runner = Join-Path $here "run-local.ps1"

if (-not (Test-Path $runner)) { throw "run-local.ps1 not found next to this script." }

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Minimized -File `"$runner`"" `
    -WorkingDirectory $here

$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
# -Once with a repetition and no -RepetitionDuration = repeat indefinitely.
$keepAliveTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 1)

# -AllowStartIfOnBatteries / -DontStopIfGoingOnBatteries: this is a laptop.
# The Task Scheduler defaults (AC-only) left the task permanently "Queued"
# on 2026-09-14 and would kill a live stream the moment the cord came out.
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
    -MultipleInstances IgnoreNew

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$description = "ledger-desk Databento live tick gateway. Starts at sign-in and is re-checked every minute (no-op while running), so it is streaming whenever you are signed in to this PC."

# Register-ScheduledTask -Force both creates and overwrites-in-place. Do not
# switch to Set-ScheduledTask: on this PowerShell it has no -Description
# parameter (confirmed 2026-09-30), which is how the Comment field went stale.
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $logonTrigger, $keepAliveTrigger -Settings $settings -Principal $principal -Description $description -Force | Out-Null
Write-Host "Registered/updated task '$taskName'."

$t = Get-ScheduledTask -TaskName $taskName
$info = $t | Get-ScheduledTaskInfo
Write-Host ("State: {0}   Next run: {1}" -f $t.State, $info.NextRunTime)
Write-Host "Test now:  Start-ScheduledTask -TaskName '$taskName'   (then check gateway\logs\)"
