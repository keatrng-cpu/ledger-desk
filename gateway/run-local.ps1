# Run the live tick gateway on this PC for one NY AM window, then exit.
#
# Reads gateway/.env.local (gitignored) for:
#   DATABASE_URL       - the SAME Session Pooler string Netlify uses
#   DATABENTO_API_KEY  - key on a Standard plan (live CME entitlement)
#   DATABENTO_DATASET  - optional, defaults to GLBX.MDP3
#
# Sets GATEWAY_EXIT_AFTER_WINDOW=1 so the process ends at 11:00 ET instead of
# idling until tomorrow. Task Scheduler (see install-task.ps1) launches this
# at 08:15 CT / 09:15 ET on weekdays; the script itself waits for 09:20.
#
# Logs: gateway/logs/YYYY-MM-DD.log (gitignored via *.log)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile = Join-Path $here ".env.local"
$logDir = Join-Path $here "logs"

if (-not (Test-Path $envFile)) {
    Write-Error "Missing $envFile - create it with DATABASE_URL and DATABENTO_API_KEY (one KEY=VALUE per line)."
    exit 1
}

# Minimal .env parser: KEY=VALUE, ignores blanks and # comments, strips optional quotes.
Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -eq "" -or $line.StartsWith("#")) { return }
    $idx = $line.IndexOf("=")
    if ($idx -lt 1) { return }
    $key = $line.Substring(0, $idx).Trim()
    $val = $line.Substring($idx + 1).Trim().Trim('"').Trim("'")
    [Environment]::SetEnvironmentVariable($key, $val, "Process")
}

$env:GATEWAY_EXIT_AFTER_WINDOW = "1"
$env:PYTHONUNBUFFERED = "1"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir ((Get-Date).ToString("yyyy-MM-dd") + ".log")

"=== run-local start $((Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz')) ===" | Tee-Object -FilePath $logFile -Append
& python (Join-Path $here "databento_live_gateway.py") 2>&1 | Tee-Object -FilePath $logFile -Append
$code = $LASTEXITCODE
"=== run-local exit $code $((Get-Date).ToString('HH:mm:ss')) ===" | Tee-Object -FilePath $logFile -Append
exit $code
