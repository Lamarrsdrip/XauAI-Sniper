#Requires -Version 5
# ============================================================================
#  XauAi Cloud Worker — one-line installer for Windows
#  Usage (PowerShell as Administrator):
#    iwr -useb https://xauaisniper.com/install-worker.ps1 | iex
# ============================================================================
$ErrorActionPreference = "Stop"
$InstallDir = "$env:USERPROFILE\xauai-worker"
$ZipUrl     = "https://xauaisniper.com/xauai_worker_agent_v1.0.0.zip"

function Say($msg) { Write-Host "[xauai] $msg" -ForegroundColor Cyan }
function Ok($msg)  { Write-Host "[ok]    $msg" -ForegroundColor Green }
function Die($msg) { Write-Host "[fail]  $msg" -ForegroundColor Red; exit 1 }

Say "Installing XauAi Cloud Worker -> $InstallDir"

# 1. Python check (auto-install via winget if missing)
$py = Get-Command python -ErrorAction SilentlyContinue
if (-not $py) {
    Say "Python not found. Installing via winget..."
    try { winget install --id Python.Python.3.11 -e --silent --accept-source-agreements --accept-package-agreements } catch { Die "winget Python install failed. Install Python 3.11+ from python.org and re-run." }
    $env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
}
$pyv = & python --version 2>&1
Ok "Python: $pyv"

# 2. Download worker
Say "Downloading worker agent..."
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Set-Location $InstallDir
Invoke-WebRequest -Uri $ZipUrl -OutFile "worker.zip"
if (Test-Path "worker_agent") { Remove-Item -Recurse -Force "worker_agent" }
Expand-Archive -Path "worker.zip" -DestinationPath . -Force
Remove-Item "worker.zip"
Set-Location "worker_agent"
Ok "Downloaded"

# 3. Virtualenv + deps
Say "Installing Python dependencies..."
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt
Ok "Dependencies installed"

# 4. Pair (interactive)
Write-Host ""
Write-Host "------------------------------------------------------------"
Write-Host "  PAIRING - open xauaisniper.com/admin -> Cloud -> Infrastructure"
Write-Host "  Click '+ Generate Pairing Code' and paste the 6 digits below."
Write-Host "------------------------------------------------------------"
$cloud = Read-Host "Cloud URL [https://xauaisniper.com]"
if ([string]::IsNullOrWhiteSpace($cloud)) { $cloud = "https://xauaisniper.com" }
$code = Read-Host "6-digit pairing code"
if (-not ($code -match "^\d{6}$")) { Die "Code must be 6 digits." }

$body = @{ code = $code; hostname = $env:COMPUTERNAME } | ConvertTo-Json
try {
    $resp = Invoke-RestMethod -Method Post -Uri "$cloud/api/cloud/agent/pair" -Body $body -ContentType "application/json"
} catch { Die "Pair failed: $_" }
$mock = if ($env:MOCK_MT5) { $env:MOCK_MT5 } else { "0" }   # Windows -> real MT5 by default
@"
CLOUD_URL=$cloud
CLOUD_AGENT_TOKEN=$($resp.agent_token)
WORKER_ID=$($resp.worker_id)
POLL_SEC=10
HEARTBEAT_SEC=60
EQUITY_SEC=120
HTTP_TIMEOUT=15
MOCK_MT5=$mock
"@ | Set-Content -Path ".env" -Encoding ASCII
Ok "Paired as worker: $($resp.worker_name)"

# 5. Install as Windows Service via NSSM
Say "Installing auto-start service via NSSM..."
$nssmDir = "$InstallDir\nssm"
if (-not (Test-Path "$nssmDir\nssm.exe")) {
    New-Item -ItemType Directory -Force -Path $nssmDir | Out-Null
    Invoke-WebRequest -Uri "https://nssm.cc/release/nssm-2.24.zip" -OutFile "$nssmDir\nssm.zip"
    Expand-Archive -Path "$nssmDir\nssm.zip" -DestinationPath $nssmDir -Force
    Remove-Item "$nssmDir\nssm.zip"
}
$nssm = Get-ChildItem -Path $nssmDir -Recurse -Filter "nssm.exe" | Where-Object { $_.FullName -match "win64" } | Select-Object -First 1 -ExpandProperty FullName
if (-not $nssm) { Die "NSSM not found after download." }

# Remove existing service if any
& $nssm stop XauAiWorker 2>$null | Out-Null
& $nssm remove XauAiWorker confirm 2>$null | Out-Null

$pyExe   = "$InstallDir\worker_agent\.venv\Scripts\python.exe"
$workerPy = "$InstallDir\worker_agent\worker_agent.py"
$workDir  = "$InstallDir\worker_agent"

& $nssm install XauAiWorker $pyExe $workerPy
& $nssm set XauAiWorker AppDirectory $workDir
& $nssm set XauAiWorker AppStdout "$InstallDir\worker.log"
& $nssm set XauAiWorker AppStderr "$InstallDir\worker.err"
& $nssm set XauAiWorker Start SERVICE_AUTO_START
& $nssm set XauAiWorker AppEnvironmentExtra "XAUAI_NO_PAIR=1"
& $nssm start XauAiWorker
Ok "Service XauAiWorker installed and running"

Write-Host ""
Write-Host "------------------------------------------------------------"
Write-Host "  DONE. Refresh xauaisniper.com/admin - your worker is now ONLINE."
Write-Host "  Logs:   notepad $InstallDir\worker.log"
Write-Host "  Stop:   nssm stop XauAiWorker"
Write-Host "  Status: nssm status XauAiWorker"
Write-Host "------------------------------------------------------------"
