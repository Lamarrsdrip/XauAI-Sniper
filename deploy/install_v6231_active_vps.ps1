param(
  [Parameter(Mandatory=$true)][string]$DataRoot,
  [Parameter(Mandatory=$true)][string]$StageDirectory,
  [Parameter(Mandatory=$true)][string]$ExpectedCurrentEx5Sha256,
  [switch]$StartTerminal
)

$ErrorActionPreference = "Stop"
$eaName = "XAUUSD_AI_Sniper_EA_v6.23.1"
$presetName = "XAUUSD_AI_Sniper_EA_v6.23.1_ACTIVE.set"
$expertDir = Join-Path $DataRoot "MQL5\Experts"
$presetDir = Join-Path $DataRoot "MQL5\Presets"
$chartPath = Join-Path $DataRoot "MQL5\Profiles\Charts\Default\chart01.chr"
$journalPath = Join-Path $DataRoot ("MQL5\Logs\" + (Get-Date -Format "yyyyMMdd") + ".log")
$terminalPath = "C:\Program Files\MetaTrader 5\terminal64.exe"

$terminalProcesses = @(Get-Process terminal64 -ErrorAction SilentlyContinue)
if($terminalProcesses.Count -gt 1) { throw "Refusing deployment: more than one terminal64 process is running." }
if($terminalProcesses.Count -eq 1) { throw "Stop terminal64 cleanly before running this installer so the active chart is persisted." }
if(!(Test-Path $journalPath) -or !(Select-String -Path $journalPath -SimpleMatch "(DEMO, USD)" -Quiet)) {
  throw "Refusing deployment: the current Journal does not prove this is the intended demo account."
}

$currentEx5 = Join-Path $expertDir ($eaName + ".ex5")
$currentHash = (Get-FileHash $currentEx5 -Algorithm SHA256).Hash
if($currentHash -ne $ExpectedCurrentEx5Sha256) {
  throw "Refusing deployment: current EX5 hash differs from the reviewed rollback baseline."
}

$stagedEx5 = Join-Path $StageDirectory ($eaName + ".ex5")
$stagedMq5 = Join-Path $StageDirectory ($eaName + ".mq5")
$stagedPreset = Join-Path $StageDirectory $presetName
foreach($required in @($stagedEx5,$stagedMq5,$stagedPreset)) {
  if(!(Test-Path $required)) { throw "Missing staged artifact: $required" }
}

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$rollback = Join-Path $DataRoot ("MQL5\Backups\v6231_active_deploy_" + $stamp)
New-Item -ItemType Directory -Path $rollback -Force | Out-Null
Copy-Item $currentEx5,$chartPath,$journalPath -Destination $rollback -Force
$currentMq5 = Join-Path $expertDir ($eaName + ".mq5")
if(Test-Path $currentMq5) { Copy-Item $currentMq5 -Destination $rollback -Force }

$chart = Get-Content $chartPath -Raw -Encoding Unicode
if($chart -notmatch "name=$([regex]::Escape($eaName))") {
  throw "Refusing deployment: persisted chart is not attached to $eaName."
}
if($chart -notmatch "InpAdaptiveTransitionMode=[012]") {
  throw "Refusing deployment: persisted chart has no adaptive transition mode input."
}
$chart = [regex]::Replace($chart,"InpAdaptiveTransitionMode=[012]","InpAdaptiveTransitionMode=2",1)
if($chart -match "InpAdaptiveTransitionPresetId=.*") {
  $chart = [regex]::Replace($chart,"InpAdaptiveTransitionPresetId=.*","InpAdaptiveTransitionPresetId=$presetName",1)
} else {
  $chart = $chart -replace "InpAdaptiveTransitionMode=2",("InpAdaptiveTransitionMode=2`r`nInpAdaptiveTransitionPresetId=" + $presetName)
}
Set-Content $chartPath -Value $chart -Encoding Unicode -NoNewline

New-Item -ItemType Directory -Path $presetDir -Force | Out-Null
Copy-Item $stagedEx5 -Destination $currentEx5 -Force
Copy-Item $stagedMq5 -Destination $currentMq5 -Force
Copy-Item $stagedPreset -Destination (Join-Path $presetDir $presetName) -Force

$installedHash = (Get-FileHash $currentEx5 -Algorithm SHA256).Hash
Write-Output "ROLLBACK_PATH=$rollback"
Write-Output "INSTALLED_EX5_SHA256=$installedHash"
Write-Output "CHART_MODE=ACTIVE"
Write-Output "PRESET_PATH=$(Join-Path $presetDir $presetName)"
if($StartTerminal) { Start-Process $terminalPath }
