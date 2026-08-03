#!/usr/bin/env bash
set -euo pipefail

SITE="${1:-https://xauaisniper.com}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

verify_worker() {
  local path="$1"
  local name
  name="$(basename "$path")"
  local headers="$TMP/${name}.headers"
  local body="$TMP/${name}.body"
  curl -sS --max-time 20 -D "$headers" -o "$body" "$SITE$path"
  local status
  status="$(awk 'toupper($1) ~ /^HTTP\// {code=$2} END {print code}' "$headers")"
  local ctype
  ctype="$(awk 'BEGIN{IGNORECASE=1} /^content-type:/ {sub(/\r$/,""); print $0}' "$headers" | tail -1)"
  [[ "$status" == "200" ]] || { echo "FAIL $path status=$status"; exit 1; }
  echo "$ctype" | grep -Eqi 'javascript|ecmascript' || {
    echo "FAIL $path bad content type: ${ctype:-missing}"; exit 1;
  }
  ! grep -Eqi '<!doctype html|<html' "$body" || {
    echo "FAIL $path returned HTML"; exit 1;
  }
  grep -q 'OneSignalSDK.sw.js' "$body" || {
    echo "FAIL $path does not import the OneSignal worker"; exit 1;
  }
  echo "PASS $path status=200 content-type=${ctype#*: }"
}

verify_worker /service-worker.js
verify_worker /OneSignalSDKWorker.js

init_count="$(grep -R --include='*.js' --include='*.jsx' -F 'OneSignal.init(' frontend/src | wc -l | tr -d ' ')"
register_count="$(grep -R --include='*.js' --include='*.jsx' -F 'navigator.serviceWorker.register(' frontend/src | wc -l | tr -d ' ')"
[[ "$init_count" == "1" ]] || { echo "FAIL expected one OneSignal.init authority, found $init_count"; exit 1; }
[[ "$register_count" == "1" ]] || { echo "FAIL expected one service-worker registration authority, found $register_count"; exit 1; }
echo "PASS source authority counts: OneSignal.init=$init_count serviceWorker.register=$register_count"
