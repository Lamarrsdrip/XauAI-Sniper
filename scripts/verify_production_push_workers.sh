#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-https://xaucloud.io}"
BASE="${BASE%/}"

echo "Checking XauCloud production push workers at $BASE"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

for path in \
  "/service-worker.js" \
  "/OneSignalSDKWorker.js" \
  "/OneSignalSDKUpdaterWorker.js"
do
  code="$(
    curl -L -sS \
      -o "$tmp/worker.js" \
      -w '%{http_code}' \
      "$BASE$path" || true
  )"

  echo "$path -> HTTP $code"

  if [[ "$code" != "200" && "$code" != "404" ]]; then
    echo "ERROR: unexpected HTTP status for $path"
    exit 1
  fi

  if [[ "$code" == "200" ]] &&
     grep -Eqi \
       'importScripts.*onesignal|cdn\.onesignal|onesignal\.com/sdks' \
       "$tmp/worker.js"
  then
    echo "ERROR: $path still loads the OneSignal SDK"
    exit 1
  fi
done

echo "OK: production has no active OneSignal service-worker authority."
