@echo off
setlocal
set PYTHONPATH=C:\XauCloudLocalAI\service
cd /d C:\XauCloudLocalAI\service
"C:\Program Files\Python313\python.exe" -m local_ai.service ^
  --host 127.0.0.1 --port 8765 ^
  --runtime-url http://127.0.0.1:11434 ^
  --model-name qwen3-0.6b-q8 --model-path C:\XauCloudLocalAI\models\Qwen3-0.6B-Q8_0.gguf ^
  --cache C:\XauCloudLocalAI\cache\decisions.sqlite3 ^
  --timeout 20 --confidence-threshold 70 ^
  --max-cpu-percent 70 --min-free-ram-gb 2 ^
  --log C:\XauCloudLocalAI\logs\gateway.log
endlocal
