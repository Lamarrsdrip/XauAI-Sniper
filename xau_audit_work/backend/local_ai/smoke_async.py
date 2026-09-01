from __future__ import annotations

import argparse
import json
import time
import urllib.parse
import urllib.request

from .benchmark import snapshots


def get_json(url: str, timeout: float = 2.0) -> dict:
    with urllib.request.urlopen(url, timeout=timeout) as response:
        return json.loads(response.read())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gateway", default="http://127.0.0.1:8765")
    parser.add_argument("--model", default="qwen3-0.6b-q8")
    parser.add_argument("--timestamp-offset-bars", type=int, default=1)
    args = parser.parse_args()
    snapshot = snapshots(args.model)[0]
    snapshot["closed_m10_timestamp"] = int(
        time.time() // 600 * 600 - max(1, args.timestamp_offset_bars) * 600
    )
    request = urllib.request.Request(
        f"{args.gateway}/api/local-ai/submit",
        data=json.dumps(snapshot, separators=(",", ":")).encode(),
        headers={"Content-Type": "application/json"}, method="POST",
    )
    started = time.perf_counter()
    with urllib.request.urlopen(request, timeout=2) as response:
        submitted = json.loads(response.read())
    submit_ms = (time.perf_counter() - started) * 1000
    signature = submitted["signature"]
    deadline = time.monotonic() + 25
    result = submitted
    while result.get("status") == "LOCAL_AI_PENDING" and time.monotonic() < deadline:
        time.sleep(0.5)
        result = get_json(
            f"{args.gateway}/api/local-ai/result?{urllib.parse.urlencode({'signature': signature})}"
        )
    print(json.dumps({
        "submit_ms": round(submit_ms, 2), "submit_status": submitted.get("status"),
        "result_status": result.get("status"), "confidence": result.get("decision", {}).get("confidence"),
        "fallback": result.get("fallback"), "signature": signature,
    }, indent=2))
    if submit_ms > 1000:
        raise SystemExit("async submit exceeded the MT5 submit timeout")


if __name__ == "__main__":
    main()
