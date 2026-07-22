#!/usr/bin/env python3
"""Extract a redacted, reproducible 72-hour M10/Outlook timeline from MT5 logs.

The extractor never copies request payloads or credentials. It includes only
M10/Outlook lifecycle lines and monitor POST result lines needed to prove the
observed publication path.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
from collections import Counter
from pathlib import Path


RELEVANT_PREFIXES = (
    "M10_", "FINAL_ENTRY_ARBITER", "ENTRY_REVALIDATED", "ENTRY_DELAY_COMPLETED",
    "ENTRY_TIMER_STARTED", "ENTRY_TIMER_COMPLETED", "EXACT_CANDIDATE_FINAL_OUTCOME",
    "OUTLOOK_", "BOT-DECISION activity POST",
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def fields(message: str) -> dict[str, str]:
    return {key: value.rstrip("\r") for key, value in re.findall(r"([A-Za-z][A-Za-z0-9_]*)=([^\s|]+)", message)}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("logs", type=Path, nargs="+")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    analyses: list[dict] = []
    relevant: list[dict] = []
    post_results: list[dict] = []
    counts: Counter[str] = Counter()
    sources = []

    for path in args.logs:
        log_date = path.stem
        sources.append({"path": str(path), "bytes": path.stat().st_size, "sha256": sha256(path)})
        with path.open("r", encoding="utf-16") as handle:
            for number, raw in enumerate(handle, 1):
                parts = raw.rstrip("\n").split("\t", 4)
                if len(parts) != 5:
                    continue
                _code, _severity, device_time, runtime, message = parts
                message = message.rstrip("\r")
                prefix = message.split(" ", 1)[0]
                if not message.startswith(RELEVANT_PREFIXES):
                    continue
                row = {
                    "log_date": log_date,
                    "device_time": device_time,
                    "source_line": number,
                    "runtime": runtime,
                    "event_type": prefix,
                    "message": message,
                }
                relevant.append(row)
                counts[prefix] += 1
                parsed = fields(message)
                if message.startswith("BOT-DECISION activity POST"):
                    post_results.append({**row, "http": parsed.get("http"), "error": parsed.get("err"),
                                         "source_event_type": parsed.get("event")})
                if prefix != "M10_SIGNAL_ANALYSIS":
                    continue
                decision = parsed.get("decision", "")
                direction = parsed.get("preferredDirection", "")
                analyses.append({
                    "ea_event_date": log_date,
                    "device_local_time": device_time,
                    "broker_server_time": "NOT_LOGGED_IN_EVENT",
                    "m10_closed_bar_time": parsed.get("barTime", ""),
                    "latest_bid_ask_time": "NOT_LOGGED_IN_EVENT",
                    "symbol": "XAUUSD" if "(XAUUSD," in runtime else "UNVERIFIED",
                    "spread": "NOT_LOGGED_IN_EVENT",
                    "candidate_direction": direction if direction in {"BUY", "SELL"} else "NONE",
                    "candidate_confidence": parsed.get("confidence", ""),
                    "candidate_freshness": "FRESHNESS_RECORDED_IN_ADJACENT_M10_EVIDENCE_EVENT",
                    "thesis_action": decision,
                    "execution_readiness": "NOT_PROVEN_BY_ANALYSIS_EVENT",
                    "exact_blocker_or_reason": message.partition(" reason=")[2],
                    "hourly_advisory_state": "NOT_PRESENT_IN_MT5_LOG",
                    "database_record": "UNVERIFIED_NO_PRODUCTION_DB_ACCESS",
                    "notification_eligibility": "REQUIRES_EXPLICIT_EXECUTION_READY_EVENT",
                    "notification_result": "UNVERIFIED_NO_PRODUCTION_NOTIFICATION_LOG",
                    "frontend_state": "UNVERIFIED_NO_AUTHENTICATED_OWNER_SESSION",
                    "ea_runtime": runtime,
                    "evidence_id": parsed.get("evidenceId", ""),
                    "source_log": path.name,
                    "source_line": number,
                })

    with (args.out / "M10_ANALYSIS_TIMELINE.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(analyses[0]) if analyses else ["source_log"], lineterminator="\n")
        writer.writeheader()
        writer.writerows(analyses)
    with (args.out / "RELEVANT_LIFECYCLE_EVENTS.tsv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(relevant[0]) if relevant else ["event_type"], delimiter="\t", lineterminator="\n")
        writer.writeheader()
        writer.writerows(relevant)
    with (args.out / "MONITOR_POST_RESULTS.tsv").open("w", newline="", encoding="utf-8") as handle:
        columns = list(post_results[0]) if post_results else ["event_type"]
        writer = csv.DictWriter(handle, fieldnames=columns, delimiter="\t", lineterminator="\n")
        writer.writeheader()
        writer.writerows(post_results)

    decisions = Counter(row["thesis_action"] for row in analyses)
    summary = {
        "scope": "MT5 local logs 2026-07-20 through 2026-07-22",
        "analysis_event_count": len(analyses),
        "decision_counts": dict(sorted(decisions.items())),
        "candidate_count": sum(decisions[name] for name in ("BUY_CANDIDATE", "SELL_CANDIDATE")),
        "relevant_event_counts": dict(sorted(counts.items())),
        "monitor_post_result_count": len(post_results),
        "monitor_post_failure_count": sum(" POST failed" in row["message"] for row in post_results),
        "sources": sources,
        "limitations": [
            "Local MT5 logs do not prove production MongoDB persistence or notification delivery.",
            "The reviewed M10_SIGNAL_ANALYSIS lines do not include Bid/Ask or explicit execution-ready truth.",
            "Multiple EA builds/chart instances appear in the same interval, so repeated bar evidence is retained rather than deduplicated.",
        ],
    }
    (args.out / "SUMMARY.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
