#Requires -Version 5
# ============================================================================
#  XauAi Cloud Worker — one-line installer for Windows
#  Usage (PowerShell as Administrator):
#    iwr -useb https://xauaisniper.com/install-worker.ps1 | iex
# ============================================================================
$ErrorActionPreference = "Stop"
$InstallDir = "$env:USERPROFILE\xauai-worker"
$ZipUrl     = "https://xauaisniper.com/xauai_worker_agent_v1.5.3.zip"

function Say($msg) { Write-Host "[xauai] $msg" -ForegroundColor Cyan }
function Ok($msg)  { Write-Host "[ok]    $msg" -ForegroundColor Green }
function Die($msg) { Write-Host "[fail]  $msg" -ForegroundColor Red; exit 1 }

Say "Installing XauAi Cloud Worker -> $InstallDir"

# 1. Python check (auto-install via winget on desktop, or python.org direct download on Server)
$py = Get-Command python -ErrorAction SilentlyContinue
if (-not $py) {
    Say "Python not found. Attempting auto-install..."
    $installed = $false
    # Try winget (Windows 10/11 desktop)
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        try {
            winget install --id Python.Python.3.11 -e --silent --accept-source-agreements --accept-package-agreements
            $installed = $true
        } catch { Say "winget install failed, falling back to python.org direct download." }
    } else {
        Say "winget not available (likely Windows Server). Downloading Python 3.11 directly..."
    }
    if (-not $installed) {
        # Direct download from python.org — works on every Windows version
        $pyUrl = "https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe"
        $pyInstaller = "$env:TEMP\python-3.11.9-installer.exe"
        try {
            Invoke-WebRequest -Uri $pyUrl -OutFile $pyInstaller -UseBasicParsing
            Say "Running silent Python installer (PrependPath=1, InstallAllUsers=1)..."
            $proc = Start-Process -FilePath $pyInstaller -ArgumentList "/quiet","InstallAllUsers=1","PrependPath=1","Include_launcher=1","Include_test=0" -Wait -PassThru
            if ($proc.ExitCode -ne 0) { Die "Python installer exited with code $($proc.ExitCode)." }
            Remove-Item $pyInstaller -Force -ErrorAction SilentlyContinue
            $installed = $true
        } catch { Die "Direct Python install failed: $_" }
    }
    # Refresh PATH so we can find python.exe in this same session
    $env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
    if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
        # Try common install paths
        $candidates = @(
            "C:\Program Files\Python311\python.exe",
            "C:\Program Files\Python312\python.exe",
            "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe",
            "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe"
        )
        foreach ($c in $candidates) {
            if (Test-Path $c) { $env:Path = (Split-Path $c) + ";" + $env:Path; break }
        }
    }
    if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
        Die "Python installed but not found on PATH. Close + re-open PowerShell as Administrator, then re-run the installer."
    }
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
POLL_SEC=1
HEARTBEAT_SEC=30
EQUITY_SEC=30
HTTP_TIMEOUT=8
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
