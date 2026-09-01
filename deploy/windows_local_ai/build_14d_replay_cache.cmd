@echo off
setlocal
set PYTHONPATH=C:\XauCloudLocalAI\service
"C:\Program Files\Python313\python.exe" -m local_ai.build_replay_cache ^
  "C:\Users\Administrator\AppData\Roaming\MetaQuotes\Terminal\Common\Files\LOCAL_AI_M10_14D_snapshots_with_owner.tsv" ^
  "C:\Users\Administrator\AppData\Roaming\MetaQuotes\Terminal\Common\Files\LOCAL_AI_M10_14D_snapshots_no_owner.tsv" ^
  --output "C:\Users\Administrator\AppData\Roaming\MetaQuotes\Terminal\Common\Files\XauCloud_local_ai_m10_14d_cache.tsv" ^
  --summary "C:\XauCloudLocalAI\logs\replay_14d_cache_summary.json" ^
  --gateway http://127.0.0.1:8765 ^
  1>>"C:\XauCloudLocalAI\logs\replay_14d_cache_build.out.log" ^
  2>>"C:\XauCloudLocalAI\logs\replay_14d_cache_build.err.log"
endlocal
