@echo off
setlocal
cd /d C:\XauCloudLocalAI\bin
llama-server.exe ^
  -m C:\XauCloudLocalAI\models\Qwen3-0.6B-Q8_0.gguf ^
  --host 127.0.0.1 --port 11434 ^
  --ctx-size 2048 --threads 2 --threads-batch 2 --threads-http 1 ^
  --parallel 1 --batch-size 128 --ubatch-size 64 --prio -1 ^
  --no-webui --metrics ^
  --log-file C:\XauCloudLocalAI\logs\runtime.log
endlocal
