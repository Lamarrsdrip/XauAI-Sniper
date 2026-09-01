$ErrorActionPreference = "Stop"

$terminalRoot = "C:\Users\Administrator\AppData\Roaming\MetaQuotes\Terminal\D0E8209F77C8CF37AD8BF550E51FF075"
$mql5Root = Join-Path $terminalRoot "MQL5"
$expertsDir = Join-Path $mql5Root "Experts"
$archiveDir = Join-Path $mql5Root "ArchivedExperts\20260809_XauCloud_io_promotion"
$chartPath = Join-Path $mql5Root "Profiles\Charts\Default\chart01.chr"
$expertTemplatePath = Join-Path $mql5Root "Backups\pure_m10_v62530_20260802_175300\chart01.chr"
$presetPath = Join-Path $mql5Root "Presets\XauCloud-M10_12K_TESTED_OFF_OFF.set"
$uploadedSource = "C:\Users\Administrator\XauCloud.io.mq5"
$uploadedBinary = "C:\Users\Administrator\XauCloud.io.ex5"
$expectedSourceHash = "d9f88e626d908b97885c869049a72cffa09adfb89d5749b7c9ce91ac27366d2d"
$expectedBinaryHash = "c4d7cf6f5160388cbbb2be7fa9644ffc6a94677f740a27327def90aec4e1da54"

New-Item -ItemType Directory -Path $archiveDir -Force | Out-Null
Copy-Item $chartPath (Join-Path $archiveDir "chart01.before-XauCloud.io.chr") -Force

foreach ($name in @("XauCloud-Main.ex5", "XauCloud-Main.mq5", "XauCloud_1c2ae64.ex5", "XauCloud_1c2ae64.mq5")) {
    $oldPath = Join-Path $expertsDir $name
    if (Test-Path $oldPath) {
        Move-Item $oldPath (Join-Path $archiveDir $name) -Force
    }
}

Move-Item $uploadedSource (Join-Path $expertsDir "XauCloud.io.mq5") -Force
Move-Item $uploadedBinary (Join-Path $expertsDir "XauCloud.io.ex5") -Force

$sourceHash = (Get-FileHash (Join-Path $expertsDir "XauCloud.io.mq5") -Algorithm SHA256).Hash.ToLower()
$binaryHash = (Get-FileHash (Join-Path $expertsDir "XauCloud.io.ex5") -Algorithm SHA256).Hash.ToLower()
if ($sourceHash -ne $expectedSourceHash) { throw "Deployed source hash mismatch" }
if ($binaryHash -ne $expectedBinaryHash) { throw "Deployed binary hash mismatch" }

$unicodeWithBom = New-Object System.Text.UnicodeEncoding($false, $true)
$baseChart = [System.IO.File]::ReadAllText($chartPath, [System.Text.Encoding]::Unicode)
$templateChart = [System.IO.File]::ReadAllText($expertTemplatePath, [System.Text.Encoding]::Unicode)
$expertMatch = [regex]::Match($templateChart, "(?s)<expert>.*?</expert>")
if (-not $expertMatch.Success) { throw "No expert block found in established VPS chart template" }
$expert = $expertMatch.Value
$expert = [regex]::Replace($expert, "(?m)^name=.*$", "name=XauCloud.io", 1)
$expert = [regex]::Replace($expert, "(?m)^path=.*$", "path=Experts\XauCloud.io.ex5", 1)

$presetKeys = New-Object System.Collections.Generic.List[string]
$presetValues = @{}
foreach ($line in [System.IO.File]::ReadAllLines($presetPath)) {
    if ($line -notmatch "^([^=]+)=(.*)$") { continue }
    $key = $Matches[1]
    $value = ($Matches[2] -split "\|\|", 2)[0]
    if (-not $presetValues.ContainsKey($key)) { $presetKeys.Add($key) }
    $presetValues[$key] = $value
}
if (-not $presetValues.ContainsKey("InpLicensePIN")) { throw "Established VPS preset has no license input" }
if (-not $presetValues.ContainsKey("InpMagicNumber")) { throw "Established VPS preset has no magic-number input" }

foreach ($key in $presetKeys) {
    $pattern = "(?m)^" + [regex]::Escape($key) + "=.*$"
    $replacement = $key + "=" + $presetValues[$key]
    if ([regex]::IsMatch($expert, $pattern)) {
        $expert = [regex]::Replace($expert, $pattern, [System.Text.RegularExpressions.MatchEvaluator]{ param($match) $replacement }, 1)
    } else {
        $expert = $expert.Replace("</inputs>", $replacement + "`r`n</inputs>")
    }
}

$baseChart = [regex]::Replace($baseChart, "(?s)<expert>.*?</expert>\s*", "")
$windowIndex = $baseChart.IndexOf("<window>")
if ($windowIndex -lt 0) { throw "Active VPS chart has no window block" }
$baseChart = $baseChart.Insert($windowIndex, $expert + "`r`n`r`n")
[System.IO.File]::WriteAllText($chartPath, $baseChart, $unicodeWithBom)

$verifiedChart = [System.IO.File]::ReadAllText($chartPath, [System.Text.Encoding]::Unicode)
if ($verifiedChart -notmatch "(?m)^name=XauCloud\.io$") { throw "Chart did not receive XauCloud.io expert name" }
if ($verifiedChart -notmatch "(?m)^path=Experts\\XauCloud\.io\.ex5$") { throw "Chart did not receive XauCloud.io expert path" }
if ($verifiedChart -match "(?m)^path=Experts\\XauCloud-Main\.ex5$") { throw "Superseded EA remains attached" }

Write-Output "DEPLOYED_MQ5_SHA256=$sourceHash"
Write-Output "DEPLOYED_EX5_SHA256=$binaryHash"
Write-Output "PRESET_KEYS_APPLIED=$($presetKeys.Count)"
Write-Output "CHART_SYMBOL=" + (($verifiedChart -split "`r?`n" | Where-Object { $_ -match '^symbol=' } | Select-Object -First 1))
Write-Output "CHART_PERIOD=" + (($verifiedChart -split "`r?`n" | Where-Object { $_ -match '^period=' } | Select-Object -First 1))

Start-Process "C:\Program Files\MetaTrader 5\terminal64.exe"
Write-Output "MT5_START_REQUESTED"
