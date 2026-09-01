#!/usr/bin/env python3
"""Create redacted, candidate-grain production ACTIVE audit evidence.

Raw VPS files remain outside the repository because their filenames and rows
contain account identifiers.  This script emits only decision evidence needed
for review and explicitly deduplicates tick-level assertion spam.
"""

import argparse
import csv
from collections import Counter
from datetime import datetime
import json
from pathlib import Path
import re


SERVER_ACTIVE_AT = datetime.strptime("2026.07.14 14:57:48", "%Y.%m.%d %H:%M:%S")
LOCAL_ACTIVE_AT = datetime.strptime("2026.07.14 16:57:48", "%Y.%m.%d %H:%M:%S")


def read_csv(path):
    with path.open("r", encoding="utf-16") as handle:
        return list(csv.DictReader(handle))


def dt(value):
    return datetime.strptime(value.strip(), "%Y.%m.%d %H:%M:%S")


def classify_reason(reason):
    text = reason.upper().strip()
    if "BAD-LOCATION" in text:
        return "LOCATION_BLOCK"
    if "STI_REENTRY" in text:
        return "RESET_NOT_CONFIRMED"
    if "CALIBRATED" in text:
        return "QUALITY_BLOCK"
    if "TREND-CONTINUATION" in text:
        return "CONTINUATION_QUALIFICATION_BLOCK"
    if "EXHAUST" in text:
        return "EXHAUSTION_BLOCK"
    if "VOLKILL" in text:
        return "VOLATILITY_SAFETY_BLOCK"
    if "SMART-GUARD" in text:
        return "LEGACY_CONTEXT_BLOCK"
    return "OTHER_BLOCK"


def parse_assertions(log_path):
    rx = re.compile(
        r"(?P<clock>\d{2}:\d{2}:\d{2})\.\d+.*?\[ACTIVE_FINAL_ENTRY_ASSERTION\] "
        r"mode=(?P<mode>\w+) source=(?P<source>\w+) candidateId=(?P<candidate>\S+) "
        r"direction=(?P<direction>BUY|SELL).*?decision=(?P<decision>\w+)"
    )
    seen = {}
    raw = 0
    with log_path.open("r", encoding="utf-8", errors="replace") as handle:
        for line in handle:
            match = rx.search(line)
            if not match:
                continue
            raw += 1
            row = match.groupdict()
            stamp = datetime.strptime("2026.07.14 " + row.pop("clock"), "%Y.%m.%d %H:%M:%S")
            if stamp < LOCAL_ACTIVE_AT:
                continue
            key = (row["candidate"], row["source"], row["direction"], row["decision"])
            seen.setdefault(key, {**row, "first_local_time": stamp.strftime("%Y-%m-%d %H:%M:%S")})
    return raw, list(seen.values())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--trading", type=Path, required=True)
    parser.add_argument("--blocked", type=Path, required=True)
    parser.add_argument("--experts", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    trading = read_csv(args.trading)
    blocked = read_csv(args.blocked)

    active_blocks = []
    checks_by_id = {}
    for row in trading:
        if not row.get("time"):
            continue
        stamp = dt(row["time"])
        if stamp < SERVER_ACTIVE_AT:
            continue
        if row["event"] == "BLOCKED":
            decision_id = row["decisionId"].strip()
            active_blocks.append(
                {
                    "server_time": stamp.strftime("%Y-%m-%d %H:%M:%S"),
                    "candidate_id": decision_id,
                    "direction": row["dir"],
                    "setup": row["setup"],
                    "grade": row["grade"],
                    "price": float(row["price"] or 0),
                    "reason_group": classify_reason(row["reasonKey"]),
                    "reason_key": row["reasonKey"].strip(),
                }
            )
        elif row["event"] == "BLOCK_CHECK":
            checks_by_id[row["decisionId"].strip()] = {
                "checkpoint_min": int(row["checkpointMin"] or 0),
                "max_favorable_atr": float(row["favATR"] or 0),
                "max_adverse_atr": float(row["advATR"] or 0),
            }

    for candidate in active_blocks:
        candidate.update(checks_by_id.get(candidate["candidate_id"], {
            "checkpoint_min": None,
            "max_favorable_atr": None,
            "max_adverse_atr": None,
        }))

    raw_assertions, unique_assertions = parse_assertions(args.experts)
    block_counts = Counter(row["reason_group"] for row in active_blocks)
    outcomes = Counter(row["decision"] for row in unique_assertions)
    missed_moves = [row for row in active_blocks if (row["max_favorable_atr"] or 0) >= 1.0]
    avoided_losses = [row for row in active_blocks if (row["max_adverse_atr"] or 0) >= 1.0]

    metrics = {
        "grain": "one unique automated candidate/opportunity; tick-level repeated assertions are deduplicated by candidateId+source+direction+decision",
        "observed_window": {
            "active_server_start": SERVER_ACTIVE_AT.isoformat(sep=" "),
            "last_server_event": max(dt(r["time"]) for r in trading if r.get("time")).isoformat(sep=" "),
        },
        "active_candidates": len(active_blocks),
        "active_block_reason_counts": dict(sorted(block_counts.items())),
        "active_unique_final_assertions": len(unique_assertions),
        "active_final_assertion_outcomes": dict(sorted(outcomes.items())),
        "raw_final_assertion_lines_all_modes": raw_assertions,
        "missed_move_candidates_ge_1atr": len(missed_moves),
        "avoided_loss_candidates_ge_1atr": len(avoided_losses),
        "healthy_trend_allow_rate_live": None,
        "healthy_trend_allow_rate_live_reason": "No healthy, low-exhaustion candidate reached final ACTIVE authority in the observed production window.",
        "wait_for_pullback_release_rate_live": None,
        "wait_for_pullback_release_rate_live_reason": "v6.23.1 did not persist a candidate-grain WAIT identity through a market-based value reset.",
        "known_data_limitations": [
            "Experts final assertions were emitted per tick in v6.23.1, not once per candidate.",
            "Several requested lifecycle/location fields were absent from pre-ACTIVE block-memory rows.",
            "Follow-up outcomes are observed price excursion, not simulated order P/L.",
            "The observed ACTIVE period contains too few candidates for a reliable profitability estimate.",
        ],
    }

    with (args.out / "candidate_audit_sanitized.csv").open("w", newline="", encoding="utf-8") as handle:
        fields = list(active_blocks[0].keys()) if active_blocks else ["server_time", "candidate_id"]
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader(); writer.writerows(active_blocks)
    (args.out / "audit_metrics.json").write_text(json.dumps(metrics, indent=2) + "\n", encoding="utf-8")
    (args.out / "unique_final_assertions_sanitized.json").write_text(json.dumps(unique_assertions, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()
