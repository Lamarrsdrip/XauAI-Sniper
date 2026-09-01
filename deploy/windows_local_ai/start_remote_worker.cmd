@echo off
setlocal
set PYTHONPATH=C:\XauCloudLocalAI\service
cd /d C:\XauCloudLocalAI\service
"C:\Program Files\Python313\python.exe" -m local_ai.remote_worker ^
  --public-url https://xaucloud.io ^
  --gateway-url http://127.0.0.1:8765 ^
  --private-key C:\XauCloudLocalAI\secrets\worker_private_key.pem ^
  --idle-seconds 1 --inference-timeout 50 ^
  --log C:\XauCloudLocalAI\logs\remote_worker.log
endlocal
