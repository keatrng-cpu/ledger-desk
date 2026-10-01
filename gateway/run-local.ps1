# Run the live tick gateway on this PC. Task Scheduler (install-task.ps1)
# launches this at sign-in and re-checks every minute (a no-op while it is
# already running - MultipleInstances IgnoreNew), with no execution limit,
# so it streams whenever the trader is signed in to this PC.
#
# Reads gateway/.env.local (gitignored) for:
#   DATABASE_URL       - the SAME Session Pooler string Netlify uses
#   DATABENTO_API_KEY  - key on a Standard plan (live CME entitlement)
#   DATABENTO_DATASET  - optional, defaults to GLBX.MDP3
#
# GATEWAY_EXIT_AFTER_WINDOW=1 is set below but is a NO-OP in the gateway's
# default mode: databento_live_gateway.py only exits early when
# GATEWAY_NY_AM_ONLY=1 (not set here), otherwise it streams for as long as
# Globex is open and idles quietly through closures/halts rather than exiting
# - nothing ends a run on purpose; the keep-alive restarts it if it dies. Left set
# so the old narrow-window fallback (GATEWAY_NY_AM_ONLY=1) still behaves.
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
function Log-Line([string]$line) { Write-Host $line; Add-Content -Path $logFile -Value $line -Encoding UTF8 }
$logFile = Join-Path $logDir ((Get-Date).ToString("yyyy-MM-dd") + ".log")

# Resolve a REAL interpreter. Under Task Scheduler the Microsoft Store alias
# (...\WindowsApps\python.exe) can fail silently; prefer the concrete install.
$python = $env:GATEWAY_PYTHON
if (-not $python) {
    $candidates = @(
        (Get-ChildItem "$env:LOCALAPPDATA\Python\pythoncore-*\python.exe" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName),
        (Get-ChildItem "$env:LOCALAPPDATA\Programs\Python\Python3*\python.exe" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName),
        ((Get-Command python -ErrorAction SilentlyContinue | Where-Object { $_.Source -notlike '*WindowsApps*' }).Source),
        ((Get-Command python -ErrorAction SilentlyContinue).Source)
    ) | Where-Object { $_ }
    $python = $candidates | Select-Object -First 1
}
if (-not $python -or -not (Test-Path $python)) {
    Log-Line "=== run-local FATAL $((Get-Date).ToString('HH:mm:ss')): no python interpreter found ==="
    exit 1
}

Log-Line "=== run-local start $((Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz')) | python=$python ==="

# A native command's stderr must not terminate this script (Windows PowerShell
# 5.1 wraps it in NativeCommandError under "Stop"). The gateway logs to stdout
# now, but anything the databento client prints to stderr still lands here.
$ErrorActionPreference = "Continue"
& $python (Join-Path $here "databento_live_gateway.py") 2>&1 | ForEach-Object { Log-Line "$_" }
$code = $LASTEXITCODE
$ErrorActionPreference = "Stop"
Log-Line "=== run-local exit $code $((Get-Date).ToString('HH:mm:ss')) ==="
exit $code
