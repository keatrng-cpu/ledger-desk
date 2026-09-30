# Register (or refresh) the Windows Task Scheduler job that runs the live
# gateway. This PC is America/Chicago, and CT/ET shift DST together.
#
# Run once from an elevated or normal PowerShell:
#   powershell -ExecutionPolicy Bypass -File gateway\install-task.ps1
#
# Remove with:
#   Unregister-ScheduledTask -TaskName "LedgerDesk Live Gateway" -Confirm:$false
#
# LogonType Interactive = runs only while you are logged in (no password
# prompt, no stored credential).
#
# 2026-09-30: two triggers, one long ExecutionTimeLimit, primary+self-heal —
# NOT two independent schedules. databento_live_gateway.py defaults to
# streaming whenever Globex is open (in_ny_am_window -> globex_open when
# GATEWAY_NY_AM_ONLY is unset, which run-local.ps1 never sets), and that
# costs nothing extra (Databento Live Standard is $199/mo FLAT — see the
# gateway's own module docstring). The blocker was never the code, it was
# this task: a single weekday trigger with a short kill-limit meant the
# process was dead ~15 hours of every 24, and Saturday/Sunday had no trigger
# at all for the week's 17:00 ET Sunday reopen.
#
#   - Sunday 15:45 CT (16:45 ET) trigger: connects 15 minutes before the
#     week's Globex reopen (17:00 ET) — the same "socket up before the event"
#     reasoning already used for the weekday 08:15 ET / 08:30 ET release gap.
#   - Weekday 07:10 CT trigger: unchanged from before. With the Sunday
#     instance normally still alive and streaming, MultipleInstances
#     IgnoreNew makes this a harmless no-op on an ordinary week — it only
#     matters as a same-morning SELF-HEAL if that instance died earlier.
#   - ExecutionTimeLimit 6d12h: long enough that ONE instance, started either
#     Sunday evening or by a weekday self-heal, comfortably spans to the next
#     Sunday trigger without being killed mid-week (which is what a short
#     limit + IgnoreNew would otherwise do — kill the live instance NEXT to a
#     trigger that then gets swallowed, going dark until the following
#     morning). It is intentionally short of "no limit" so a missed Sunday
#     trigger (PC off) still self-clears within the week rather than a
#     connection quietly living for months.
#
# Why not just remove the limit or run two independent daily triggers: an
# indefinite process risks the desk never noticing a slow-degrading
# connection; two same-day triggers close in time would each try to open a
# SECOND concurrent Databento Live session on one API key while the first is
# still up, which is unverified territory (Databento does not document
# multi-session behaviour on the Standard plan) — better to avoid it than to
# find out live.

$ErrorActionPreference = "Stop"
$taskName = "LedgerDesk Live Gateway"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$runner = Join-Path $here "run-local.ps1"

if (-not (Test-Path $runner)) { throw "run-local.ps1 not found next to this script." }

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Minimized -File `"$runner`"" `
    -WorkingDirectory $here

$weekdayTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At 07:10
$sundayTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 15:45

# -AllowStartIfOnBatteries / -DontStopIfGoingOnBatteries: this is a laptop.
# The Task Scheduler defaults (AC-only) left the task permanently "Queued"
# on 2026-09-14 and would kill a live stream the moment the cord came out.
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -WakeToRun `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Days 6 -Hours 12) `
    -MultipleInstances IgnoreNew `
    -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 1)

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$description = "ledger-desk Databento live tick gateway. Sunday 15:45 CT primary trigger (streams whenever Globex is open); weekday 07:10 CT is a same-morning self-heal if that instance died."

# Register-ScheduledTask -Force both creates and overwrites-in-place. Past
# versions of this script used Set-ScheduledTask to update an existing task,
# which on this PowerShell has no -Description parameter at all (confirmed
# 2026-09-30: "A parameter cannot be found that matches parameter name
# 'Description'") - that is exactly how the task's own Comment field went
# stale, still reading "weekdays 09:20-11:00 ET" after the window had moved
# twice since. One call path for both cases avoids that drift recurring.
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $weekdayTrigger, $sundayTrigger -Settings $settings -Principal $principal -Description $description -Force | Out-Null
Write-Host "Registered/updated task '$taskName'."

$t = Get-ScheduledTask -TaskName $taskName
$info = $t | Get-ScheduledTaskInfo
Write-Host ("State: {0}   Next run: {1}" -f $t.State, $info.NextRunTime)
Write-Host "Test now:  Start-ScheduledTask -TaskName '$taskName'   (then check gateway\logs\)"
