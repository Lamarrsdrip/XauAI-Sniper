#!/usr/bin/env python3
"""Extract exact executable-tick post-exit evidence from the v6.25.8
90-day forensic Strategy Tester journal.

The EA emits one FORENSIC_POST_EXIT_START row per broker-confirmed full close
and cumulative checkpoint rows at 5/10/15/20/30/60 minutes. BUY paths use Bid;
SELL paths use Ask. Checkpoints are emitted before a tick beyond the deadline
is incorporated, so market gaps cannot contaminate a shorter window.
"""

from __future__ import annotations

import argparse
import csv
import math
import re
import statistics
from collections import defaultdict
from datetime import datetime
from pathlib import Path


CHECKPOINTS = (5, 10, 15, 20, 30, 60)
REGIMES = {
    0: "TREND_UP",
    1: "TREND_DN",
    2: "RANGING",
    3: "BRKT_UP",
    4: "BRKT_DN",
    5: "LOW_VOL",
    6: "CHOPPY",
    7: "DEAD",
}
RUN_START = datetime(2026, 4, 19)
RECENT_START = datetime(2026, 6, 18)
RUN_END = datetime(2026, 7, 18)
TS_RE = re.compile(r"(?P<ts>2026\.\d{2}\.\d{2} \d{2}:\d{2}:\d{2})\s+(?P<body>.*)$")
ENTRY_RE = re.compile(r"R_EXIT_ENTRY_CAPTURE_CONFIRMED .*?positionId=(\d+)")
TIMING_RE = re.compile(r"TIMING_PROOF: .*?thesisId=(\d+) .*?sourcePath=([A-Z_]+)")


def parse_ts(value: str) -> datetime:
    return datetime.strptime(value, "%Y.%m.%d %H:%M:%S")


def parse_segments(body: str, marker: str) -> dict[str, str]:
    payload = body.split(marker, 1)[1]
    result: dict[str, str] = {}
    for segment in payload.split(" | "):
        segment = segment.strip()
        if "=" not in segment:
            continue
        key, value = segment.split("=", 1)
        result[key.strip()] = value.strip()
    return result


def as_float(value: str | None) -> float | None:
    if value in (None, "", "NONE", "NO_POST_EXIT_TICK"):
        return None
    try:
        return float(value)
    except ValueError:
        return None


def as_bool(value: str | None) -> bool | None:
    if value == "true":
        return True
    if value == "false":
        return False
    return None


def scan_journal(path: Path) -> tuple[dict[str, dict], dict[str, dict[int, dict]], dict[str, str], dict[str, str]]:
    starts: dict[str, dict] = {}
    checkpoints: dict[str, dict[int, dict]] = defaultdict(dict)
    entry_times: dict[str, str] = {}
    source_paths: dict[str, str] = {}

    with path.open("r", encoding="utf-16le", errors="ignore") as handle:
        for line in handle:
            if not any(token in line for token in (
                "FORENSIC_POST_EXIT_", "R_EXIT_ENTRY_CAPTURE_CONFIRMED", "TIMING_PROOF:"
            )):
                continue
            matched = TS_RE.search(line.rstrip("\r\n"))
            if not matched:
                continue
            log_ts, body = matched.group("ts"), matched.group("body")
            if "FORENSIC_POST_EXIT_START" in body:
                row = parse_segments(body, "FORENSIC_POST_EXIT_START")
                position_id = row.get("positionId")
                if position_id:
                    starts[position_id] = row
            elif "FORENSIC_POST_EXIT_CHECKPOINT" in body:
                row = parse_segments(body, "FORENSIC_POST_EXIT_CHECKPOINT")
                position_id = row.get("positionId")
                minute = int(row.get("checkpointMin", "0") or 0)
                if position_id and minute in CHECKPOINTS:
                    checkpoints[position_id][minute] = row
            elif "R_EXIT_ENTRY_CAPTURE_CONFIRMED" in body:
                m = ENTRY_RE.search(body)
                if m and m.group(1) not in entry_times:
                    entry_times[m.group(1)] = log_ts
            elif "TIMING_PROOF:" in body:
                m = TIMING_RE.search(body)
                if m:
                    source_paths[m.group(1)] = m.group(2)
    return starts, checkpoints, entry_times, source_paths


def period_names(close_dt: datetime) -> list[str]:
    names = ["FULL_90_DAYS"]
    if RUN_START <= close_dt < RECENT_START:
        names.append("FIRST_60_DAYS")
    elif RECENT_START <= close_dt < RUN_END:
        names.append("LATEST_30_DAYS")
    return names


def build_rows(starts: dict[str, dict], checkpoints: dict[str, dict[int, dict]],
               entry_times: dict[str, str], source_paths: dict[str, str]) -> list[dict]:
    rows: list[dict] = []
    for position_id, start in starts.items():
        close_dt = parse_ts(start["closeTime"])
        source_path = source_paths.get(position_id, "")
        leg_role = start.get("legRole", "UNKNOWN")
        if source_path == "REENTRY" and leg_role == "CORE":
            leg_role = "RE_ENTRY"
        regime_value = int(start.get("entryRegime", "-1"))
        row: dict = {
            "position_id": position_id,
            "campaign_id": start.get("campaignId", ""),
            "leg_role": leg_role,
            "entry_source_path": source_path or ("PYRAMID" if leg_role == "PYRAMID" else "FRESH"),
            "direction": start.get("direction", ""),
            "entry_time": entry_times.get(position_id, ""),
            "entry_regime": REGIMES.get(regime_value, f"UNKNOWN_{regime_value}"),
            "frozen_owner_exit_profile": start.get("ownerExitProfile", ""),
            "entry_price": as_float(start.get("entryPrice")),
            "original_sl": as_float(start.get("originalSL")),
            "risk_distance": as_float(start.get("riskDistance")),
            "risk_usd": as_float(start.get("riskUSD")),
            "exit_time": start.get("closeTime", ""),
            "exit_price": as_float(start.get("exitPrice")),
            "exit_authority": start.get("exitAuthority", ""),
            "realized_profit_usd": as_float(start.get("realizedProfitUSD")),
            "realized_r_at_exit": as_float(start.get("realizedR")),
            "peak_r_while_open": as_float(start.get("peakRWhileOpen")),
            "period_membership": "+".join(period_names(close_dt)),
        }
        for minute in CHECKPOINTS:
            cp = checkpoints.get(position_id, {}).get(minute, {})
            suffix = f"_{minute}m"
            row[f"total_favorable_r_at{suffix}"] = as_float(cp.get("totalFavorableR"))
            row[f"missed_r{suffix}"] = as_float(cp.get("missedR"))
            row[f"maximum_adverse_r_after_exit{suffix}"] = as_float(cp.get("maximumAdverseRAfterExit"))
            row[f"returned_to_entry{suffix}"] = as_bool(cp.get("returnedToEntry"))
            row[f"crossed_original_sl{suffix}"] = as_bool(cp.get("crossedOriginalSL"))
            row[f"path_classification{suffix}"] = cp.get("classification", "HISTORICAL_DATA_UNAVAILABLE")
            row[f"observed_through{suffix}"] = cp.get("observedThrough", "")
        row["clean_continuation_or_immediate_reversal"] = row["path_classification_60m"]
        rows.append(row)
    rows.sort(key=lambda r: (r["exit_time"], int(r["position_id"])))
    return rows


def mean(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def rounded(value: float | None) -> str | float:
    return "" if value is None or not math.isfinite(value) else round(value, 6)


def summarize_group(rows: list[dict], period: str, dimension: str, value: str) -> dict:
    selected = [r for r in rows if period in r["period_membership"].split("+")]
    if dimension != "all":
        selected = [r for r in selected if str(r.get(dimension, "")) == value]
    out: dict = {"period": period, "dimension": dimension, "value": value, "trades": len(selected)}
    realized = [r["realized_r_at_exit"] for r in selected if r["realized_r_at_exit"] is not None]
    peaks = [r["peak_r_while_open"] for r in selected if r["peak_r_while_open"] is not None]
    out["avg_realized_r"] = rounded(mean(realized))
    out["avg_peak_r_while_open"] = rounded(mean(peaks))
    for minute in CHECKPOINTS:
        missed = [r[f"missed_r_{minute}m"] for r in selected if r[f"missed_r_{minute}m"] is not None]
        adverse = [r[f"maximum_adverse_r_after_exit_{minute}m"] for r in selected
                   if r[f"maximum_adverse_r_after_exit_{minute}m"] is not None]
        total = [r[f"total_favorable_r_at_{minute}m"] for r in selected
                 if r[f"total_favorable_r_at_{minute}m"] is not None]
        out[f"trades_with_{minute}m_data"] = len(missed)
        out[f"historical_data_unavailable_{minute}m"] = len(selected) - len(missed)
        out[f"avg_total_favorable_r_{minute}m"] = rounded(mean(total))
        out[f"avg_missed_r_{minute}m"] = rounded(mean(missed))
        out[f"median_missed_r_{minute}m"] = rounded(statistics.median(missed) if missed else None)
        out[f"total_missed_r_{minute}m"] = rounded(sum(missed) if missed else None)
        out[f"avg_max_adverse_r_{minute}m"] = rounded(mean(adverse))
        out[f"returned_to_entry_count_{minute}m"] = sum(r[f"returned_to_entry_{minute}m"] is True for r in selected)
        out[f"crossed_original_sl_count_{minute}m"] = sum(r[f"crossed_original_sl_{minute}m"] is True for r in selected)
        out[f"clean_continuation_count_{minute}m"] = sum(
            r[f"path_classification_{minute}m"] == "CLEAN_CONTINUATION" for r in selected)
        out[f"immediate_reversal_count_{minute}m"] = sum(
            r[f"path_classification_{minute}m"] == "IMMEDIATE_REVERSAL" for r in selected)
    return out


def dimension_summaries(rows: list[dict], dimension: str) -> list[dict]:
    values = sorted({str(r.get(dimension, "")) for r in rows})
    return [summarize_group(rows, period, dimension, value)
            for period in ("FIRST_60_DAYS", "LATEST_30_DAYS", "FULL_90_DAYS")
            for value in values]


def write_csv(path: Path, rows: list[dict]) -> None:
    if not rows:
        raise RuntimeError(f"refusing to write empty report: {path}")
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def markdown_table(rows: list[dict], columns: list[str]) -> list[str]:
    lines = ["| " + " | ".join(columns) + " |", "|" + "|".join("---" for _ in columns) + "|"]
    for row in rows:
        lines.append("| " + " | ".join(str(row.get(column, "")) for column in columns) + " |")
    return lines


def write_summary(path: Path, rows: list[dict]) -> None:
    overall = [summarize_group(rows, p, "all", "ALL")
               for p in ("FIRST_60_DAYS", "LATEST_30_DAYS", "FULL_90_DAYS")]
    lines = [
        "# 90-Day Post-Exit 5/10/15/20/30/60-Minute Summary",
        "",
        "## Method",
        "",
        "- Exact replay window: 2026-04-19 00:00 through 2026-07-18 00:00 (90 days).",
        "- First 60 days: 2026-04-19 through 2026-06-18; latest 30 days: 2026-06-18 through 2026-07-18.",
        "- Every broker-confirmed full close is anchored to its immutable original entry/SL/R state.",
        "- BUY post-exit chronology uses executable Bid; SELL uses executable Ask.",
        "- `missed_r` is the maximum additional favorable price movement after the actual exit divided by original risk distance.",
        "- `total_favorable_r` is realized R at exit plus missed R.",
        "- Clean continuation means +0.10R post-exit was reached before -0.10R; immediate reversal means -0.10R was reached first.",
        "- TRANSITION/NO_TRADE messages are absent because this dataset contains executed closed positions only.",
        "",
        "## Overall",
        "",
    ]
    cols = ["period", "trades", "avg_realized_r", "avg_peak_r_while_open"]
    for minute in CHECKPOINTS:
        cols += [f"avg_missed_r_{minute}m", f"avg_max_adverse_r_{minute}m"]
    lines += markdown_table(overall, cols)
    lines += ["", "## Checkpoint coverage", ""]
    coverage_cols = ["period", "trades"]
    for minute in CHECKPOINTS:
        coverage_cols += [f"trades_with_{minute}m_data", f"historical_data_unavailable_{minute}m"]
    lines += markdown_table(overall, coverage_cols)

    for title, dimension in (
        ("By regime", "entry_regime"),
        ("By exit authority", "exit_authority"),
        ("By frozen owner-exit profile", "frozen_owner_exit_profile"),
        ("By leg role", "leg_role"),
    ):
        summaries = dimension_summaries(rows, dimension)
        lines += ["", f"## {title}", ""]
        lines += markdown_table(summaries, [
            "period", "value", "trades", "avg_realized_r", "avg_peak_r_while_open",
            "avg_missed_r_5m", "avg_missed_r_10m", "avg_missed_r_15m",
            "avg_missed_r_20m", "avg_missed_r_30m", "avg_missed_r_60m",
            "clean_continuation_count_60m", "immediate_reversal_count_60m",
        ])
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--journal", required=True, type=Path)
    parser.add_argument("--out-dir", required=True, type=Path)
    parser.add_argument("--prefix", default="90DAY")
    args = parser.parse_args()
    args.out_dir.mkdir(parents=True, exist_ok=True)

    starts, checkpoints, entry_times, source_paths = scan_journal(args.journal)
    rows = build_rows(starts, checkpoints, entry_times, source_paths)
    if not rows:
        raise RuntimeError("no FORENSIC_POST_EXIT_START rows found")

    prefix = args.prefix
    write_csv(args.out_dir / f"{prefix}_POST_EXIT_ALL_TRADES.csv", rows)
    write_csv(args.out_dir / f"{prefix}_POST_EXIT_BY_REGIME.csv", dimension_summaries(rows, "entry_regime"))
    write_csv(args.out_dir / f"{prefix}_POST_EXIT_BY_EXIT_AUTHORITY.csv", dimension_summaries(rows, "exit_authority"))
    write_summary(args.out_dir / f"{prefix}_POST_EXIT_5_10_15_20_30_60_SUMMARY.md", rows)
    print(f"extracted {len(rows)} closed positions from {args.journal}")


if __name__ == "__main__":
    main()
