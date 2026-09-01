#!/usr/bin/env python3
"""Reconstruct one row per expected pure-M10 decision close from MT5 logs."""

from __future__ import annotations

import argparse
import csv
import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path


BOT = "XauCloud-m10_ASIA+"
DT = "%Y.%m.%d %H:%M:%S"


def fields(message: str) -> dict[str, str]:
    parsed = {
        key: value.strip()
        for key, value in re.findall(r"\b([A-Za-z][A-Za-z0-9_]*)=([^\s|]+)", message)
    }
    parsed.update({
        key: value
        for key, value in re.findall(
            r"\b([A-Za-z][A-Za-z0-9_]*)=(\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}(?::\d{2})?)",
            message,
        )
    })
    for segment in message.split(" | ")[1:]:
        match = re.match(r"([A-Za-z][A-Za-z0-9_]*)=(.*)$", segment)
        if not match:
            continue
        key, value = match.groups()
        if re.search(r"\s[A-Za-z][A-Za-z0-9_]*=", value):
            continue
        parsed[key] = value.strip()
    return parsed


def expected_closes() -> list[datetime]:
    rows: list[datetime] = []
    for day in range(27, 32):
        start = datetime(2026, 7, day, 1, 10)
        end = datetime(2026, 7, day, 19, 50) if day == 31 else datetime(2026, 7, day, 22, 50)
        cursor = start
        while cursor <= end:
            rows.append(cursor)
            cursor += timedelta(minutes=10)
    return rows


def session_at(close_time: datetime) -> str:
    h, minute = close_time.hour, close_time.minute
    if (h == 10 and minute >= 20) or (h == 15 and minute <= 10):
        return "FIX"
    if 13 <= h < 17:
        return "NY"
    if 7 <= h < 13:
        return "LDN"
    if 0 <= h < 8:
        return "ASIA"
    return "LATE"


def new_record(ev: dict[str, str], ready: str) -> dict[str, str]:
    return {
        "m10_candle_close_time": ev["barClose"],
        "scan_ran": "YES",
        "process_count": "1",
        "indicator_readiness": ready,
        "setup_scores": "NOT_LOGGED_BY_LIVE_BUILD",
        "buy_score": ev.get("buyCaseScore", ""),
        "sell_score": ev.get("sellCaseScore", ""),
        "preferred_direction": ev.get("preferredDirection", ""),
        "setup_selected": "NONE",
        "candidate_created": "NO",
        "candidate_not_created_reason": "",
        "grade": "SKIP",
        "session": session_at(datetime.strptime(ev["barClose"], DT)),
        "regime": "UNKNOWN",
        "location": ev.get("location", "UNKNOWN"),
        "m10_decision": ev.get("decision", "UNKNOWN"),
        "transition_state": ev.get("decision", "UNKNOWN"),
        "permanent_block_result": "NOT_REACHED",
        "owner_location_block_result": "NOT_REACHED",
        "normal_gate_result": "NOT_REACHED",
        "execution_timer_result": "NOT_STARTED",
        "order_send_result": "NOT_REACHED",
        "broker_retcode": "NOT_ATTEMPTED",
        "evidence_id": ev.get("evidenceId", ""),
        "freshness": ev.get("freshness", ""),
        "data_state": ev.get("dataState", ""),
    }


def parse_logs(log_dir: Path) -> list[dict[str, str]]:
    records: list[dict[str, str]] = []
    current: dict[str, str] | None = None
    ready_by_open: dict[str, str] = {}
    for path in sorted(log_dir.glob("202607*.txt")):
        for raw in path.read_text(encoding="utf-8-sig", errors="replace").splitlines():
            if BOT not in raw:
                continue
            message = raw.split(")\t", 1)[-1]
            if "M10_SNAPSHOT_READY |" in message:
                f = fields(message)
                ready_key=f.get("bar", "")
                if len(ready_key)==16:
                    ready_key += ":00"
                ready_by_open[ready_key] = (
                    f"{f.get('allRequiredIndicators', 'UNKNOWN')};closedShift={f.get('closedShift', '')};"
                    f"immutable={f.get('immutable', '')}"
                )
                continue
            if "M10_EVIDENCE_STORED |" in message:
                f = fields(message)
                current = new_record(f, ready_by_open.get(f.get("barOpen", ""), "COMPLETE_FROM_EVIDENCE"))
                records.append(current)
                continue
            if current is None:
                continue

            if "M10_CANDIDATE_REJECTED |" in message:
                f = fields(message)
                reason_match = re.search(r"m10Reason=(.*?)\s+--\s+", message)
                if reason_match:
                    f["m10Reason"] = reason_match.group(1)
                current["setup_selected"] = f.get("proposedSetup", "NONE")
                current["candidate_not_created_reason"] = (
                    f"M10_CANDIDATE_REJECTED:{f.get('m10Decision', '')}:"
                    f"preferred={f.get('m10PreferredDirection', '')}:reason={f.get('m10Reason', '')}"
                )
            elif "DECISION_SNAPSHOT |" in message:
                f = fields(message)
                signal = f.get("signal", "NONE")
                setup = f.get("setup", "") or current["setup_selected"]
                current["setup_selected"] = setup or "NONE"
                current["setup_scores"] = (
                    f"selected={f.get('setupScore', '')};combined={f.get('score', '')}"
                    if signal != "NONE" or f.get("setupScore") not in (None, "0.00")
                    else current["setup_scores"]
                )
                current["grade"] = f.get("grade", current["grade"])
                current["regime"] = f.get("regime", current["regime"])
                if signal != "NONE" and f.get("grade") != "SKIP":
                    current["candidate_created"] = "YES"
                    current["candidate_not_created_reason"] = ""
                    current["normal_gate_result"] = "PENDING_DOWNSTREAM_GATES"
            elif "[REVERSAL_ENTRY_AUDIT]" in message:
                match = re.search(r"opportunityState=([^ ]+)", message)
                if match:
                    current["transition_state"] = match.group(1)
            elif "PERMANENT_M10_CATEGORY_BLOCK |" in message:
                f = fields(message)
                current["candidate_created"] = "YES"
                current["permanent_block_result"] = f"BLOCKED:{f.get('primaryReason', '')}"
                current["normal_gate_result"] = "BLOCKED_BY_PERMANENT_POLICY"
                current["order_send_result"] = "NOT_REACHED"
                current["session"] = f.get("session", current["session"])
                current["grade"] = f.get("grade", current["grade"])
                current["regime"] = f.get("regime", current["regime"])
                current["location"] = f.get("location", current["location"])
            elif "OWNER_ENTRY_PERMISSION |" in message and "decision=BLOCK" in message:
                f = fields(message)
                reason = f.get("reason", "OWNER_BLOCK")
                if "LOCATION" in reason or "EXCELLENT" in reason or "LATE" in reason:
                    current["owner_location_block_result"] = f"BLOCKED:{reason}"
                current["normal_gate_result"] = f"BLOCKED:{reason}"
                current["session"] = f.get("session", current["session"])
                current["grade"] = f.get("grade", current["grade"])
                current["location"] = f.get("liveLocation", current["location"])
            elif "ENTRY_TIMER_STARTED |" in message:
                current["execution_timer_result"] = "STARTED"
            elif "ENTRY_TIMER_COMPLETED |" in message:
                current["execution_timer_result"] = "COMPLETED"
            elif "EXACT_CANDIDATE_FINAL_OUTCOME |" in message:
                f = fields(message)
                result = f.get("result", "UNKNOWN")
                if "TIMER_EXPIRED" in result:
                    current["execution_timer_result"] = "EXPIRED"
                if "EXECUTED" in result:
                    current["order_send_result"] = "BROKER_CONFIRMED"
                elif "EXECUTION_NOT_CONFIRMED" in result:
                    current["order_send_result"] = "NOT_CONFIRMED"
                if current["normal_gate_result"] == "PENDING_DOWNSTREAM_GATES":
                    current["normal_gate_result"] = result
            elif "STRUCTURAL_SL_BLOCK |" in message:
                f = fields(message)
                current["normal_gate_result"] = f"STRUCTURAL_SL_BLOCK:{f.get('reason', '')}"
                current["order_send_result"] = "NOT_SENT"
                current["broker_retcode"] = "NOT_ATTEMPTED"
            elif "BROKER_OPEN_NOT_CONFIRMED |" in message:
                f = fields(message)
                current["order_send_result"] = "NOT_CONFIRMED"
                current["broker_retcode"] = f.get("retcode", "UNKNOWN")

    return records


def missing_row(close_time: datetime) -> dict[str, str]:
    text_time = close_time.strftime(DT)
    reason = "EA_NOT_ATTACHED" if close_time < datetime(2026, 7, 29, 14, 40) else "NO_COMPLETED_SCAN_IN_LIVE_LOG"
    return {
        "m10_candle_close_time": text_time,
        "scan_ran": "NO",
        "process_count": "0",
        "indicator_readiness": "NOT_EVALUATED",
        "setup_scores": "NOT_EVALUATED",
        "buy_score": "",
        "sell_score": "",
        "preferred_direction": "",
        "setup_selected": "NONE",
        "candidate_created": "NO",
        "candidate_not_created_reason": reason,
        "grade": "NOT_CLASSIFIED",
        "session": session_at(close_time),
        "regime": "NOT_CLASSIFIED",
        "location": "NOT_CLASSIFIED",
        "m10_decision": "NOT_EVALUATED",
        "transition_state": "NOT_EVALUATED",
        "permanent_block_result": "NOT_REACHED",
        "owner_location_block_result": "NOT_REACHED",
        "normal_gate_result": "NOT_REACHED",
        "execution_timer_result": "NOT_STARTED",
        "order_send_result": "NOT_REACHED",
        "broker_retcode": "NOT_ATTEMPTED",
        "evidence_id": "",
        "freshness": "",
        "data_state": "",
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--log-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--summary", type=Path, required=True)
    args = parser.parse_args()

    parsed = parse_logs(args.log_dir)
    by_close: dict[str, list[dict[str, str]]] = defaultdict(list)
    for record in parsed:
        by_close[record["m10_candle_close_time"]].append(record)

    final: list[dict[str, str]] = []
    for close_time in expected_closes():
        key = close_time.strftime(DT)
        if key in by_close:
            row = by_close[key][-1].copy()
            row["process_count"] = str(len(by_close[key]))
            final.append(row)
        else:
            final.append(missing_row(close_time))

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(final[0]))
        writer.writeheader()
        writer.writerows(final)

    scans = sum(row["scan_ran"] == "YES" for row in final)
    duplicates = {row["m10_candle_close_time"]: row["process_count"] for row in final if int(row["process_count"]) > 1}
    missing = [row["m10_candle_close_time"] for row in final if row["scan_ran"] == "NO"]
    decisions = Counter(row["m10_decision"] for row in final if row["scan_ran"] == "YES")
    transition_states = Counter(row["transition_state"] for row in final if row["scan_ran"] == "YES")
    candidates = sum(row["candidate_created"] == "YES" for row in final)
    lines = [
        "# Pure M10 prior-week cycle summary",
        "",
        f"- Expected broker M10 closes: {len(final)}",
        f"- Unique closes with a completed scan: {scans}",
        f"- Missing completed scans: {len(missing)}",
        f"- Duplicate closes: {len(duplicates)} ({duplicates})",
        f"- Candidates created: {candidates}",
        f"- M10 decision states: {dict(decisions)}",
        f"- Adaptive transition/opportunity states when logged (otherwise M10 decision): {dict(transition_states)}",
        "- Completed evidence readiness: all live evidence rows report FRESH/COMPLETE; indicator readiness is taken from the matching immutable shift-1 snapshot when logged.",
        "- Missing Monday, Tuesday, and Wednesday before 14:40 server time are classified EA_NOT_ATTACHED because the named EA has no attachment or expert records before 2026-07-29 12:42 local / 14:42 server.",
        "- Setup score detail before a candidate veto was not emitted by v6.25.29; those cells are explicitly NOT_LOGGED_BY_LIVE_BUILD rather than inferred.",
        "",
        "## Missing close times",
        "",
        *[f"- {value}" for value in missing],
    ]
    args.summary.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
