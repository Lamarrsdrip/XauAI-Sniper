from __future__ import annotations

import argparse
import json
import os
import statistics
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path
from typing import Any

from .schema import Snapshot, snapshot_signature


def _request_json(request: urllib.request.Request | str, timeout: float) -> dict[str, Any]:
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read())


def _compact(value: dict[str, Any]) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def _fallback(snapshot: Snapshot, reason: str) -> dict[str, Any]:
    return {
        "fallback": "DETERMINISTIC",
        "reason": reason,
        "signature": snapshot_signature(snapshot),
        "status": "LOCAL_AI_FALLBACK",
    }


def _load_pairs(path: Path) -> dict[str, str]:
    pairs: dict[str, str] = {}
    if not path.exists():
        return pairs
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line:
            continue
        snapshot, separator, response = line.partition("\t")
        if not separator:
            raise ValueError(f"{path}:{number}: expected snapshot<TAB>response")
        json.loads(snapshot)
        json.loads(response)
        pairs.setdefault(snapshot, response)
    return pairs


def _load_snapshots(paths: list[Path]) -> list[str]:
    ordered: dict[str, None] = {}
    for path in paths:
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            snapshot = line.strip()
            if not snapshot:
                continue
            try:
                Snapshot.parse(json.loads(snapshot))
            except Exception as exc:
                raise ValueError(f"{path}:{number}: invalid snapshot: {exc}") from exc
            ordered.setdefault(snapshot, None)
    return list(ordered)


def build_cache(
    snapshot_paths: list[Path],
    output: Path,
    gateway: str,
    request_timeout: float,
    result_timeout: float,
    poll_seconds: float,
    retry_transport_once: bool,
) -> dict[str, Any]:
    snapshots = _load_snapshots(snapshot_paths)
    existing = _load_pairs(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    statuses: Counter[str] = Counter()
    latencies: list[float] = []
    requested = 0
    transport_retries = 0
    gateway = gateway.rstrip("/")

    with output.open("a", encoding="utf-8", newline="\n") as handle:
        for index, raw_snapshot in enumerate(snapshots, 1):
            if raw_snapshot in existing:
                statuses[json.loads(existing[raw_snapshot]).get("status", "UNKNOWN")] += 1
                continue
            snapshot = Snapshot.parse(json.loads(raw_snapshot))
            started = time.perf_counter()
            result: dict[str, Any] | None = None
            attempts = 2 if retry_transport_once else 1
            for attempt in range(attempts):
                try:
                    request = urllib.request.Request(
                        f"{gateway}/api/local-ai/submit",
                        data=raw_snapshot.encode("utf-8"),
                        headers={"Content-Type": "application/json"},
                        method="POST",
                    )
                    result = _request_json(request, request_timeout)
                    requested += 1
                    break
                except (OSError, urllib.error.URLError, urllib.error.HTTPError, TimeoutError):
                    if attempt + 1 < attempts:
                        transport_retries += 1
                        time.sleep(0.5)
            if result is None:
                result = _fallback(snapshot, "OFFLINE_DATASET_TRANSPORT_FAILED")

            deadline = time.monotonic() + result_timeout
            while result.get("status") == "LOCAL_AI_PENDING" and time.monotonic() < deadline:
                time.sleep(poll_seconds)
                query = urllib.parse.urlencode({"signature": result["signature"]})
                try:
                    result = _request_json(
                        f"{gateway}/api/local-ai/result?{query}", request_timeout
                    )
                except (OSError, urllib.error.URLError, urllib.error.HTTPError, TimeoutError):
                    result = _fallback(snapshot, "OFFLINE_DATASET_RESULT_TRANSPORT_FAILED")
                    break
            if result.get("status") == "LOCAL_AI_PENDING":
                result = _fallback(snapshot, "OFFLINE_DATASET_RESULT_TIMEOUT")

            rendered = _compact(result)
            handle.write(f"{raw_snapshot}\t{rendered}\n")
            handle.flush()
            os.fsync(handle.fileno())
            existing[raw_snapshot] = rendered
            statuses[result.get("status", "UNKNOWN")] += 1
            latencies.append((time.perf_counter() - started) * 1000.0)
            print(
                f"[{index}/{len(snapshots)}] {result.get('status', 'UNKNOWN')} "
                f"closed_m10={snapshot.closed_m10_timestamp}",
                flush=True,
            )

    ordered = sorted(latencies)
    p95 = ordered[min(len(ordered) - 1, int(len(ordered) * 0.95))] if ordered else 0.0
    return {
        "snapshot_files": [str(path) for path in snapshot_paths],
        "unique_snapshots": len(snapshots),
        "preexisting_cache_rows": len(snapshots) - len(latencies),
        "new_rows": len(latencies),
        "gateway_submissions": requested,
        "transport_retries": transport_retries,
        "statuses": dict(sorted(statuses.items())),
        "average_wall_ms": round(statistics.fmean(latencies), 2) if latencies else 0.0,
        "p95_wall_ms": round(p95, 2),
        "paid_ai_calls": 0,
        "output": str(output),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a resumable local-AI cache for MT5 replay")
    parser.add_argument("snapshots", nargs="+", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--summary", type=Path)
    parser.add_argument("--gateway", default="http://127.0.0.1:8765")
    parser.add_argument("--request-timeout", type=float, default=2.0)
    parser.add_argument("--result-timeout", type=float, default=25.0)
    parser.add_argument("--poll-seconds", type=float, default=0.5)
    parser.add_argument("--no-transport-retry", action="store_true")
    args = parser.parse_args()
    summary = build_cache(
        args.snapshots,
        args.output,
        args.gateway,
        args.request_timeout,
        args.result_timeout,
        args.poll_seconds,
        not args.no_transport_retry,
    )
    rendered = json.dumps(summary, indent=2, sort_keys=True)
    print(rendered)
    if args.summary:
        args.summary.parent.mkdir(parents=True, exist_ok=True)
        args.summary.write_text(rendered + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
