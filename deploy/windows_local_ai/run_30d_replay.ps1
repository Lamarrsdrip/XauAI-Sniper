Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Prefix = "LOCAL_AI_M10_30D"
$ResearchRoot = "C:\XAUResearchMT5"
$Terminal = Join-Path $ResearchRoot "terminal64.exe"
$ConfigRoot = Join-Path $ResearchRoot "Config"
$CommonFiles = "C:\Users\Administrator\AppData\Roaming\MetaQuotes\Terminal\Common\Files"
$ServiceRoot = "C:\XauCloudLocalAI\service"
$Python = "C:\Program Files\Python313\python.exe"
$LogRoot = "C:\XauCloudLocalAI\logs"
$RunLog = Join-Path $LogRoot "replay_30d_orchestrator.log"
$BuildLog = Join-Path $LogRoot "replay_30d_cache_build.log"
$BuildSummary = Join-Path $LogRoot "replay_30d_cache_summary.json"
$Completion = Join-Path $LogRoot "replay_30d_complete.json"
$CacheFileName = "XauCloud_local_ai_m10_30d_cache.tsv"
$CacheFile = Join-Path $CommonFiles $CacheFileName
$SeedCacheFile = Join-Path $CommonFiles "XauCloud_local_ai_m10_14d_cache.tsv"

New-Item -ItemType Directory -Path $LogRoot -Force | Out-Null

function Write-RunLog([string]$Message) {
    $line = "{0:o} {1}" -f (Get-Date), $Message
    Add-Content -LiteralPath $RunLog -Value $line -Encoding UTF8
}

function Get-NonEmptyLineCount([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return 0 }
    return @(
        Get-Content -LiteralPath $Path | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    ).Count
}

function Read-MT5ReportText([string]$Path) {
    $bytes = [IO.File]::ReadAllBytes($Path)
    if ($bytes.Length -ge 2 -and $bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE) {
        return [Text.Encoding]::Unicode.GetString($bytes)
    }
    return [Text.Encoding]::UTF8.GetString($bytes)
}

function Get-RealTickQuality([string]$Report) {
    if (-not (Test-Path -LiteralPath $Report)) { return -1 }
    $qualityMatch = [regex]::Match((Read-MT5ReportText $Report), "(\d+)% real ticks")
    if (-not $qualityMatch.Success) { return -1 }
    return [int]$qualityMatch.Groups[1].Value
}

function Wait-ForInitialCacheJob {
    $task = Get-ScheduledTask -TaskName "XauCloudLocalAI_Replay14DCache" -ErrorAction SilentlyContinue
    while ($null -ne $task -and $task.State -eq "Running") {
        Write-RunLog "WAITING_FOR_14D_CACHE_JOB"
        Start-Sleep -Seconds 15
        $task = Get-ScheduledTask -TaskName "XauCloudLocalAI_Replay14DCache" -ErrorAction SilentlyContinue
    }
}

function Assert-NoResearchTerminal {
    $researchProcesses = @(
        Get-CimInstance Win32_Process -Filter "Name='terminal64.exe'" |
            Where-Object { $_.ExecutablePath -eq $Terminal }
    )
    if ($researchProcesses.Count -gt 0) {
        throw "The isolated research terminal is already running."
    }
}

function Invoke-Tester([string]$JobName) {
    $config = Join-Path $ConfigRoot ("{0}_{1}.ini" -f $Prefix, $JobName)
    $report = Join-Path $ResearchRoot ("{0}_{1}.htm" -f $Prefix, $JobName)
    if (-not (Test-Path -LiteralPath $config)) { throw "Missing tester config: $config" }
    Assert-NoResearchTerminal
    Write-RunLog "TESTER_START job=$JobName config=$config"
    $process = Start-Process -FilePath $Terminal -ArgumentList "/portable", "/config:$config" -PassThru
    try { $process.PriorityClass = "BelowNormal" } catch { Write-RunLog "TESTER_PRIORITY_WARNING job=$JobName error=$($_.Exception.Message)" }
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw "Tester $JobName exited with code $($process.ExitCode)" }
    if (-not (Test-Path -LiteralPath $report)) { throw "Tester report was not created: $report" }
    $reportText = Read-MT5ReportText $report
    $qualityMatch = [regex]::Match($reportText, "(\d+)% real ticks")
    if (-not $qualityMatch.Success -or [int]$qualityMatch.Groups[1].Value -lt 95) {
        throw "Tester report does not prove Model=4 real ticks: $report"
    }
    Write-RunLog "TESTER_COMPLETE job=$JobName report=$report realTickQuality=$($qualityMatch.Groups[1].Value)%"
}

function Invoke-CacheBuild([string[]]$SnapshotFiles, [string]$Stage) {
    $existingInputs = @($SnapshotFiles | Where-Object { (Get-NonEmptyLineCount $_) -gt 0 })
    if ($existingInputs.Count -eq 0) { throw "No snapshots were supplied for cache stage $Stage" }
    $arguments = @(
        "-m", "local_ai.build_replay_cache"
    ) + $existingInputs + @(
        "--output", $CacheFile,
        "--summary", $BuildSummary,
        "--gateway", "http://127.0.0.1:8765"
    )
    Write-RunLog "CACHE_BUILD_START stage=$Stage inputs=$($existingInputs -join ',')"
    $previousPythonPath = $env:PYTHONPATH
    $env:PYTHONPATH = $ServiceRoot
    try {
        & $Python @arguments 2>&1 | Tee-Object -FilePath $BuildLog -Append
        if ($LASTEXITCODE -ne 0) { throw "Cache builder failed at $Stage with code $LASTEXITCODE" }
    }
    finally {
        $env:PYTHONPATH = $previousPythonPath
    }
    Write-RunLog "CACHE_BUILD_COMPLETE stage=$Stage cacheRows=$(Get-NonEmptyLineCount $CacheFile)"
}

try {
    if (Test-Path -LiteralPath $Completion) {
        Write-RunLog "ALREADY_COMPLETE marker=$Completion"
        exit 0
    }

    Write-RunLog "RUN_START prefix=$Prefix from=2026.06.28 to=2026.07.28 model=4 timeframe=M10 paidCalls=0"
    Wait-ForInitialCacheJob

    $withOwnerSnapshots = Join-Path $CommonFiles "${Prefix}_snapshots_with_owner.tsv"
    $noOwnerSnapshots = Join-Path $CommonFiles "${Prefix}_snapshots_no_owner.tsv"
    $withOwnerMissing = Join-Path $CommonFiles "${Prefix}_missing_with_owner.tsv"
    $noOwnerMissing = Join-Path $CommonFiles "${Prefix}_missing_no_owner.tsv"

    # Preserve verified collection artifacts across an orchestrator restart.
    # Cache/missing rows are trajectory-specific and are rebuilt cleanly.
    foreach ($path in @($withOwnerMissing, $noOwnerMissing, $CacheFile, $BuildSummary)) {
        if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
    }

    # Reuse only exact snapshot/decision pairs from the completed 14-day cache.
    # Extra rows are harmless because the EA and builder require full raw-JSON
    # equality; this avoids repeating local inference when the 30-day trajectory
    # reaches an identical market and position state.
    if (Test-Path -LiteralPath $SeedCacheFile) {
        Copy-Item -LiteralPath $SeedCacheFile -Destination $CacheFile -Force
        Write-RunLog "CACHE_SEEDED source=$SeedCacheFile rows=$(Get-NonEmptyLineCount $CacheFile)"
    }

    $baselineReport = Join-Path $ResearchRoot "${Prefix}_BASELINE.htm"
    $baselineQuality = Get-RealTickQuality $baselineReport
    if ($baselineQuality -ge 95) {
        Write-RunLog "TESTER_REUSED job=BASELINE report=$baselineReport reason=VERIFIED_MODEL4_REPORT"
    }
    else {
        Invoke-Tester "BASELINE"
    }

    $withOwnerReport = Join-Path $ResearchRoot "${Prefix}_COLLECT_WITH_OWNER.htm"
    if ((Get-NonEmptyLineCount $withOwnerSnapshots) -gt 0 -and
        (Get-RealTickQuality $withOwnerReport) -ge 95) {
        Write-RunLog "TESTER_REUSED job=COLLECT_WITH_OWNER report=$withOwnerReport snapshots=$(Get-NonEmptyLineCount $withOwnerSnapshots) reason=VERIFIED_MODEL4_REPORT_AND_SNAPSHOTS"
    }
    else {
        if (Test-Path -LiteralPath $withOwnerSnapshots) { Remove-Item -LiteralPath $withOwnerSnapshots -Force }
        Invoke-Tester "COLLECT_WITH_OWNER"
    }

    $noOwnerReport = Join-Path $ResearchRoot "${Prefix}_COLLECT_NO_OWNER.htm"
    if ((Get-NonEmptyLineCount $noOwnerSnapshots) -gt 0 -and
        (Get-RealTickQuality $noOwnerReport) -ge 95) {
        Write-RunLog "TESTER_REUSED job=COLLECT_NO_OWNER report=$noOwnerReport snapshots=$(Get-NonEmptyLineCount $noOwnerSnapshots) reason=VERIFIED_MODEL4_REPORT_AND_SNAPSHOTS"
    }
    else {
        if (Test-Path -LiteralPath $noOwnerSnapshots) { Remove-Item -LiteralPath $noOwnerSnapshots -Force }
        Invoke-Tester "COLLECT_NO_OWNER"
    }
    Invoke-CacheBuild @($withOwnerSnapshots, $noOwnerSnapshots) "INITIAL_30D"

    $resolved = $false
    for ($iteration = 1; $iteration -le 8; $iteration++) {
        foreach ($path in @($withOwnerMissing, $noOwnerMissing)) {
            if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
        }
        Invoke-Tester "AI_WITH_OWNER"
        Invoke-Tester "AI_NO_OWNER"
        $withMisses = Get-NonEmptyLineCount $withOwnerMissing
        $noMisses = Get-NonEmptyLineCount $noOwnerMissing
        Write-RunLog "AI_CACHE_MISSES iteration=$iteration withOwner=$withMisses noOwner=$noMisses"
        if ($withMisses -eq 0 -and $noMisses -eq 0) {
            $resolved = $true
            break
        }
        Invoke-CacheBuild @($withOwnerMissing, $noOwnerMissing) "AI_TRAJECTORY_$iteration"
    }

    if (-not $resolved) { throw "AI replay still had exact-cache misses after eight iterations." }

    $result = [ordered]@{
        status = "COMPLETE"
        completed_at = (Get-Date).ToString("o")
        symbol = "XAUUSD"
        timeframe = "M10"
        model = 4
        from_date = "2026.06.28"
        to_date = "2026.07.28"
        paid_ai_calls = 0
        cache_rows = Get-NonEmptyLineCount $CacheFile
        reports = @(
            (Join-Path $ResearchRoot "${Prefix}_BASELINE.htm"),
            (Join-Path $ResearchRoot "${Prefix}_AI_WITH_OWNER.htm"),
            (Join-Path $ResearchRoot "${Prefix}_AI_NO_OWNER.htm")
        )
    }
    $result | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $Completion -Encoding UTF8
    Write-RunLog "RUN_COMPLETE marker=$Completion"
}
catch {
    Write-RunLog "RUN_FAILED error=$($_.Exception.Message)"
    ($_ | Out-String) | Add-Content -LiteralPath $RunLog -Encoding UTF8
    throw
}
