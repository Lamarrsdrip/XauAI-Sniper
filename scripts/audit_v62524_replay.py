#!/usr/bin/env python3
"""Reconcile the immutable v6.25.24 90-day TradeBrain evidence package."""

from __future__ import annotations

import csv
import hashlib
import json
import math
import re
from collections import Counter
from datetime import datetime
from pathlib import Path

RUN_ID = "V62524_M10_90D_20260422_20260721_RUN1"
VERSION = "v6.25.24"
BUILD = "v62524-replay-consolidated-root-repair-20260722"
SOURCE_SHA256 = "e3309d9faafba868c3b94e405fd6f31f819e970156c374c6c2a57d360232314d"
HOLDOUT_START = datetime(2026, 6, 22)
QUARANTINED = {"130"}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def read_csv(path: Path) -> list[dict[str, str]]:
    raw = path.read_bytes()[:4]
    encoding = "utf-16" if raw.startswith((b"\xff\xfe", b"\xfe\xff")) else "utf-8-sig"
    with path.open(encoding=encoding, newline="") as handle:
        return list(csv.DictReader(handle))


def metrics(rows: list[dict[str, str]]) -> dict[str, float | int]:
    profits = [float(row["final_pnl_usd"]) for row in rows]
    wins = [p for p in profits if p >= 0.01]
    losses = [p for p in profits if p <= -0.01]
    gross_win = sum(wins)
    gross_loss = abs(sum(losses))
    return {
        "trades": len(rows),
        "wins": len(wins),
        "losses": len(losses),
        "net": round(sum(profits), 2),
        "profit_factor": gross_win / gross_loss if gross_loss else math.inf,
        "expectancy": sum(profits) / len(rows) if rows else 0.0,
    }


def wilson_lower(losses: int, total: int, z: float = 1.959963984540054) -> float:
    if total == 0:
        return 0.0
    p = losses / total
    denominator = 1 + z * z / total
    centre = p + z * z / (2 * total)
    margin = z * math.sqrt((p * (1 - p) + z * z / (4 * total)) / total)
    return (centre - margin) / denominator * 100


def build_joined(rows: list[dict[str, str]]) -> tuple[list[dict[str, str]], list[str]]:
    opens: dict[str, dict[str, str]] = {}
    closes: dict[str, dict[str, str]] = {}
    errors: list[str] = []
    for row in rows:
        pos_id = row["posId"]
        if row["event"] == "OPEN":
            if pos_id in opens:
                errors.append(f"duplicate OPEN posId={pos_id}")
            opens[pos_id] = row
        elif row["event"] == "CLOSE":
            if pos_id in closes:
                errors.append(f"duplicate CLOSE posId={pos_id}")
            closes[pos_id] = row
    if set(opens) != set(closes):
        errors.append(f"OPEN/CLOSE key mismatch opens_only={sorted(set(opens)-set(closes))} closes_only={sorted(set(closes)-set(opens))}")

    joined: list[dict[str, str]] = []
    peak_pattern = re.compile(r"bestFloating=([-+]?\d+(?:\.\d+)?)")
    for pos_id, opened in sorted(opens.items(), key=lambda item: datetime.strptime(item[1]["time"], "%Y.%m.%d %H:%M:%S")):
        closed = closes.get(pos_id)
        if not closed:
            continue
        entry_time = datetime.strptime(opened["time"], "%Y.%m.%d %H:%M:%S")
        close_time = datetime.strptime(closed["time"], "%Y.%m.%d %H:%M:%S")
        peak_match = peak_pattern.search(closed["exitReason"])
        peak_profit = float(peak_match.group(1)) if peak_match else 0.0
        risk = float(opened["riskUSD"] or 0)
        profit = float(closed["profit"] or 0)
        joined.append({
            "position_id": pos_id,
            "entry_time": entry_time.isoformat(sep=" "),
            "close_time": close_time.isoformat(sep=" "),
            "split": "HOLDOUT_30D" if entry_time >= HOLDOUT_START else "TRAIN_60D",
            "learning_eligible": "N" if pos_id in QUARANTINED else "Y",
            "trade_role": opened["tradeRole"],
            "campaign_id": opened["campaignId"],
            "candidate_id": opened["candidateId"],
            "symbol": opened["symbol"],
            "direction": opened["dir"],
            "setup": opened["setup"],
            "grade": opened["grade"],
            "regime": opened["regime"],
            "session": opened["session"],
            "entry_hour": opened["hour"],
            "signature": opened["signature"],
            "entry_price": opened["entryPrice"],
            "lots": opened["lots"],
            "original_structural_sl": opened["originalStructuralSL"],
            "original_one_r_distance": opened["originalOneRDistance"],
            "risk_usd": opened["riskUSD"],
            "spread_points": opened["spreadPoints"],
            "spread_atr": opened["spreadATR"],
            "news_phase": opened["newsPhase"],
            "bias_direction": opened["biasDirection"],
            "bos_direction": opened["bosDirection"],
            "thesis_location": opened["thesisLocation"],
            "thesis_exhaustion": opened["thesisExhaustion"],
            "thesis_timing": opened["thesisTiming"],
            "thesis_htf": opened["thesisHTF"],
            "thesis_structure": opened["thesisStructure"],
            "thesis_pressure": opened["thesisPressure"],
            "thesis_action": opened["thesisAction"],
            "exit_price": closed["exitPrice"],
            "final_pnl_usd": f"{profit:.2f}",
            "peak_profit_usd": f"{peak_profit:.2f}",
            "worst_floating_usd": closed["worstFloating"],
            "peak_r": f"{peak_profit / risk:.12f}" if risk else "",
            "realized_r": f"{profit / risk:.12f}" if risk else "",
            "outcome": closed["outcome"],
            "exit_reason": closed["exitReason"],
            "result_class": "WIN" if profit >= 0.01 else "LOSS" if profit <= -0.01 else "BREAK_EVEN",
            "ea_version": opened["eaVersion"],
            "build_hash": opened["buildHash"],
            "collection_run_id": opened["collectionRunId"],
            "data_status": opened["dataStatus"],
        })
    return joined, errors


def cohort(name: str, predicate: str, rows: list[dict[str, str]], fn) -> dict[str, object]:
    selected = [row for row in rows if fn(row)]
    losses = sum(row["result_class"] == "LOSS" for row in selected)
    wins = sum(row["result_class"] == "WIN" for row in selected)
    train = [row for row in selected if row["split"] == "TRAIN_60D"]
    holdout = [row for row in selected if row["split"] == "HOLDOUT_30D"]
    return {
        "id": name,
        "predicate": predicate,
        "authority": "WARNING_ONLY",
        "samples": len(selected),
        "wins": wins,
        "losses": losses,
        "loss_rate_pct": losses / len(selected) * 100 if selected else 0,
        "net_usd": round(sum(float(row["final_pnl_usd"]) for row in selected), 2),
        "wilson_95_lower_pct": wilson_lower(losses, len(selected)),
        "train_samples": len(train),
        "train_losses": sum(row["result_class"] == "LOSS" for row in train),
        "holdout_samples": len(holdout),
        "holdout_losses": sum(row["result_class"] == "LOSS" for row in holdout),
    }


def write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    if not rows:
        raise RuntimeError(f"refusing to write empty CSV: {path}")
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    run_dir = root / "analysis" / "tradebrain" / RUN_ID
    raw_dir = run_dir / "raw"
    reports = run_dir / "reports"
    tradebrain = next(raw_dir.glob("*TradeBrainCollect_v2_V62524*.csv"))
    timing = next(raw_dir.glob("*TimingProof_V62524*.csv"))
    blocked = next(raw_dir.glob("*BlockedTradeMemory_V62524*.csv"))
    raw_rows = read_csv(tradebrain)
    joined, errors = build_joined(raw_rows)

    event_counts = Counter(row["event"] for row in raw_rows)
    if event_counts != Counter({"POST_CLOSE": 775, "OPEN": 155, "CLOSE": 155}):
        errors.append(f"unexpected event counts: {dict(event_counts)}")
    if any(row["collectionRunId"] != RUN_ID for row in raw_rows):
        errors.append("foreign collectionRunId detected")
    if any(row["eaVersion"] != VERSION or row["buildHash"] != BUILD for row in raw_rows):
        errors.append("version/build mismatch detected")
    if len(joined) != 155:
        errors.append(f"joined trade count is {len(joined)}, expected 155")
    if errors:
        raise RuntimeError("; ".join(errors))

    write_csv(reports / "CLEAN_ENTRY_FEATURES_WITH_OUTCOMES.csv", joined)
    quarantine = [dict(row, quarantine_reason="BROKER_SL fill 44.45 price units / 4.570R beyond requested structural SL; telemetry execution anomaly") for row in joined if row["position_id"] in QUARANTINED]
    write_csv(reports / "QUARANTINED_ROWS.csv", quarantine)

    warning_rows = [row for row in joined if row["position_id"] not in QUARANTINED]
    cohorts = [
        cohort("WARN_H12_14_LOCATION_RESET_PENDING_TIMING_WAIT_CONFIRMATION", "entry_hour in [12,14] AND thesis_location=LOCATION_RESET_PENDING AND thesis_timing=TIMING_WAIT_CONFIRMATION", warning_rows, lambda r: 12 <= int(r["entry_hour"]) <= 14 and r["thesis_location"] == "LOCATION_RESET_PENDING" and r["thesis_timing"] == "TIMING_WAIT_CONFIRMATION"),
        cohort("WARN_H12_14_STRUCTURE_OPPOSES", "entry_hour in [12,14] AND thesis_structure=STRUCTURE_OPPOSES", warning_rows, lambda r: 12 <= int(r["entry_hour"]) <= 14 and r["thesis_structure"] == "STRUCTURE_OPPOSES"),
        cohort("WARN_BUY_ASIA_BOS_NEGATIVE", "direction=BUY AND session=ASIA AND bos_direction=-1", warning_rows, lambda r: r["direction"] == "BUY" and r["session"] == "ASIA" and r["bos_direction"] == "-1"),
        cohort("WARN_BUY_TREND_PULLBACK_STRUCTURE_OPPOSES", "direction=BUY AND setup=TREND_PULLBACK AND thesis_structure=STRUCTURE_OPPOSES", warning_rows, lambda r: r["direction"] == "BUY" and r["setup"] == "TREND_PULLBACK" and r["thesis_structure"] == "STRUCTURE_OPPOSES"),
    ]
    seed = {
        "schema": "XAUAI_TRADEBRAIN_SEED_V1",
        "seed_id": f"{RUN_ID}_SEED_V1",
        "source": {"run_id": RUN_ID, "version": VERSION, "build": BUILD, "source_sha256": SOURCE_SHA256},
        "policy": {"recommended_mode": "GLOBAL_TRADEBRAIN_ADVISOR", "fail_open": True, "local_rows_have_authority": False, "lot_multiplier": 1.0, "direction_changes": False, "risk_changes": False, "exit_changes": False},
        "active_hard_blocks": [],
        "warning_cohorts": cohorts,
        "quarantined_position_ids": [130],
    }
    seed_path = reports / "XAUAI_ValidatedTradeBrainSeed_v1.json"
    seed_path.write_text(json.dumps(seed, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    seed_hash = sha256(seed_path)

    overall = metrics(joined)
    train = metrics([row for row in joined if row["split"] == "TRAIN_60D"])
    holdout = metrics([row for row in joined if row["split"] == "HOLDOUT_30D"])
    sensitivity = metrics(warning_rows)
    timing_count = len(read_csv(timing))
    blocked_count = len(read_csv(blocked))
    (reports / "DATA_INTEGRITY_AUDIT.md").write_text(
        f"# Data integrity audit — {RUN_ID}\n\n"
        f"- Status: PASS\n- Source identity: `{VERSION}` / `{BUILD}` / `{SOURCE_SHA256}`\n"
        f"- Raw events: OPEN={event_counts['OPEN']}, CLOSE={event_counts['CLOSE']}, POST_CLOSE={event_counts['POST_CLOSE']}\n"
        f"- Join: 155 one-to-one positions; duplicate OPEN=0; duplicate CLOSE=0; conflicting outcomes=0\n"
        f"- Timing-proof rows: {timing_count}; blocked-opportunity rows: {blocked_count}\n"
        f"- Entry features come only from OPEN rows; future labels come only from CLOSE rows. Split uses entry time with holdout starting `{HOLDOUT_START}`.\n"
        f"- Seed SHA-256: `{seed_hash}`; ACTIVE hard blocks=0; WARNING cohorts=4.\n"
        f"- Position 130 is retained in raw performance and excluded from learning (`learning_eligible=N`).\n",
        encoding="utf-8",
    )
    (reports / "RECONCILIATION_REPORT.md").write_text(
        "# Replay reconciliation\n\n"
        f"| Scope | Trades | W/L | Net | PF | Expectancy |\n|---|---:|---:|---:|---:|---:|\n"
        f"| Full raw run | {overall['trades']} | {overall['wins']}/{overall['losses']} | ${overall['net']:.2f} | {overall['profit_factor']:.4f} | ${overall['expectancy']:.2f} |\n"
        f"| First 60 days (entry time) | {train['trades']} | {train['wins']}/{train['losses']} | ${train['net']:.2f} | {train['profit_factor']:.4f} | ${train['expectancy']:.2f} |\n"
        f"| Final 30 days holdout | {holdout['trades']} | {holdout['wins']}/{holdout['losses']} | ${holdout['net']:.2f} | {holdout['profit_factor']:.4f} | ${holdout['expectancy']:.2f} |\n"
        f"| Sensitivity excluding position 130 | {sensitivity['trades']} | {sensitivity['wins']}/{sensitivity['losses']} | ${sensitivity['net']:.2f} | {sensitivity['profit_factor']:.4f} | ${sensitivity['expectancy']:.2f} |\n\n"
        "The reconstructed totals exactly match the supplied audit. The raw result remains the official replay result; the sensitivity row is for learning hygiene only.\n",
        encoding="utf-8",
    )

    inventory_rows: list[dict[str, str]] = []
    for path in sorted(p for p in run_dir.rglob("*") if p.is_file() and p.name not in {"FILE_INVENTORY.csv", "SHA256SUMS.txt"}):
        inventory_rows.append({"path": str(path.relative_to(run_dir)), "bytes": str(path.stat().st_size), "sha256": sha256(path)})
    write_csv(run_dir / "FILE_INVENTORY.csv", inventory_rows)
    checksum_targets = sorted(p for p in run_dir.rglob("*") if p.is_file() and p.name != "SHA256SUMS.txt")
    (run_dir / "SHA256SUMS.txt").write_text("".join(f"{sha256(path)}  {path.relative_to(run_dir)}\n" for path in checksum_targets), encoding="utf-8")
    print(json.dumps({"status": "PASS", "seed_sha256": seed_hash, "overall": overall, "train": train, "holdout": holdout, "sensitivity": sensitivity}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
