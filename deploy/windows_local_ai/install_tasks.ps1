$ErrorActionPreference = "Stop"

$root = "C:\XauCloudLocalAI"
$required = @(
    "$root\bin\llama-server.exe",
    "$root\models\Qwen3-0.6B-Q8_0.gguf",
    "$root\service\local_ai\service.py",
    "$root\service\local_ai\remote_worker.py",
    "$root\start_runtime.cmd",
    "$root\start_gateway.cmd",
    "$root\start_remote_worker.cmd",
    "$root\secrets\worker_private_key.pem"
)
foreach ($path in $required) {
    if (-not (Test-Path $path)) { throw "Missing required local-AI file: $path" }
}

$runtimeAction = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/d /c `"$root\start_runtime.cmd`""
$gatewayAction = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/d /c `"$root\start_gateway.cmd`""
$workerAction = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/d /c `"$root\start_remote_worker.cmd`""
$runtimeTrigger = New-ScheduledTaskTrigger -AtStartup
$gatewayTrigger = New-ScheduledTaskTrigger -AtStartup
$gatewayTrigger.Delay = "PT20S"
$workerTrigger = New-ScheduledTaskTrigger -AtStartup
$workerTrigger.Delay = "PT35S"
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Days 3650) `
    -RestartCount 5 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName "XauCloudLocalAI_Runtime" -Action $runtimeAction `
    -Trigger $runtimeTrigger -Principal $principal -Settings $settings -Force | Out-Null
Register-ScheduledTask -TaskName "XauCloudLocalAI_Gateway" -Action $gatewayAction `
    -Trigger $gatewayTrigger -Principal $principal -Settings $settings -Force | Out-Null
Register-ScheduledTask -TaskName "XauCloudLocalAI_RemoteWorker" -Action $workerAction `
    -Trigger $workerTrigger -Principal $principal -Settings $settings -Force | Out-Null

Start-ScheduledTask -TaskName "XauCloudLocalAI_Runtime"
$deadline = (Get-Date).AddSeconds(45)
do {
    Start-Sleep -Milliseconds 500
    try { $runtimeHealth = Invoke-RestMethod -TimeoutSec 2 -Uri "http://127.0.0.1:11434/health" }
    catch { $runtimeHealth = $null }
} until ($runtimeHealth.status -eq "ok" -or (Get-Date) -ge $deadline)
if ($runtimeHealth.status -ne "ok") { throw "Local model runtime failed its loopback health check" }

Start-ScheduledTask -TaskName "XauCloudLocalAI_Gateway"
$deadline = (Get-Date).AddSeconds(30)
do {
    Start-Sleep -Milliseconds 500
    try { $gatewayHealth = Invoke-RestMethod -TimeoutSec 2 -Uri "http://127.0.0.1:8765/api/local-ai/health" }
    catch { $gatewayHealth = $null }
} until ($gatewayHealth.status -eq "green" -or (Get-Date) -ge $deadline)
if ($gatewayHealth.status -ne "green") { throw "Local AI gateway failed its loopback health check" }

Start-ScheduledTask -TaskName "XauCloudLocalAI_RemoteWorker"

[pscustomobject]@{
    runtimeTask = (Get-ScheduledTask -TaskName "XauCloudLocalAI_Runtime").State.ToString()
    gatewayTask = (Get-ScheduledTask -TaskName "XauCloudLocalAI_Gateway").State.ToString()
    remoteWorkerTask = (Get-ScheduledTask -TaskName "XauCloudLocalAI_RemoteWorker").State.ToString()
    runtimeListener = Get-NetTCPConnection -State Listen -LocalPort 11434 | Select-Object LocalAddress, LocalPort
    gatewayListener = Get-NetTCPConnection -State Listen -LocalPort 8765 | Select-Object LocalAddress, LocalPort
    health = $gatewayHealth
} | ConvertTo-Json -Depth 5
