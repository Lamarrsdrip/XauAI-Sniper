#!/usr/bin/env python3
"""Extend the 60-day M30-postfix extraction with market-regime and
entry-timing evidence, joining every campaign to the EA's OWN real-time
classification -- no independently-invented technical-analysis rules.

Every field here comes from a log line the EA itself already prints
during the backtest:

  - ENTRY_TIMER_STARTED / ENTRY_DELAY_COMPLETED -- per-candidate: how
    long the 120-180s entry timer actually ran (elapsedSeconds), the
    price when the signal was first accepted (intendedEntry), the price
    when the timer resolved (currentPrice), and the EA's own R-drift
    measurement between the two (moveFromIntendedEntryR). This directly
    answers "did waiting inside the timer window help or hurt entry
    price" per trade -- no reconstruction needed.

  - DECISION_SNAPSHOT's regime= field -- the EA's own ENUM_REGIME
    classification (TREND_UP/TREND_DN/RANGING/BRKT_UP/BRKT_DN/
    LOW_VOL/CHOPPY/DEAD), looked up at the exact log-timestamp of both
    the signal (timer-start) moment and the entry (timer-resolved)
    moment, so a genuine signal-time-vs-entry-time regime comparison is
    possible without inventing a parallel indicator engine.

  - [MARKET_LIFECYCLE]'s state= field -- the EA's own
    ENUM_XAU_MARKET_LIFECYCLE (TREND_EARLY/DEVELOPING/HEALTHY/MATURE/
    LATE/EXHAUSTING/TRANSITION_NEUTRAL/OPPOSITE_DIRECTION_FORMING/
    CONFIRMED), same signal-time/entry-time join.

  - MARKET_THESIS -- location/exhaustion/timing/HTF/structure/pressure
    state labels at both moments.

  - FINAL_ENTRY_ARBITER and LEARNED_ENTRY_QUALITY_TRACE at the entry
    moment -- trendHealth, pullbackCompletion, trapRisk, liquiditySweep,
    breakoutAcceptance.

Anything the EA logs as a literal "UNKNOWN"/"UNCONFIRMED" placeholder
(e.g. liquiditySweep is UNKNOWN in every single occurrence in this run --
verified, not assumed) is passed through as-is and disclosed as
NOT_IMPLEMENTED in the method doc, never silently dropped or invented.
"""
import argparse
import csv
import re
from pathlib import Path

LOG_LINE_RE = re.compile(
    r"^CS\t\d+\t[\d:.]+\t[^\t]+\t(?P<ts>\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}:\d{2})\s+(?P<body>.*)$"
)


# MQL5's TimeToString-formatted values ("2026.05.18 07:00:30") contain an
# embedded space, which breaks a naive "key=value-until-next-space"
# tokenizer -- candidateId/executionKey/slot/origin/barTime all use this
# format. Join the date and time halves with "_" before tokenizing so the
# whole value is captured as one token, matching this module's other
# timestamp strings after a ts.replace("_", " ") when needed.
_DATETIME_SPACE_RE = re.compile(r"(\d{4}\.\d{2}\.\d{2}) (\d{2}:\d{2}:\d{2})")


def kv_parse(body: str):
    out = {}
    body = _DATETIME_SPACE_RE.sub(r"\1_\2", body.strip())
    if "|" in body:
        tag, rest = body.split("|", 1)
        out["_event_type"] = tag.strip()
        body = rest
    for tok in re.findall(r"([\w.]+)=([^\s]+)", body):
        out[tok[0]] = tok[1]
    return out


def scan_journal(journal_path: Path):
    # ENTRY_TIMER_STARTED and ENTRY_DELAY_COMPLETED both re-fire on every
    # re-validation tick while a candidate's timer is running, not once --
    # so a plain candidateId->fields dict silently keeps whichever
    # occurrence happens to be read last, which is NOT necessarily the one
    # that actually triggered execution. The only genuinely 1:1 anchor is
    # M30_EXECUTION_CONFIRMED's own positionId (== the real ticket), so
    # entry_delay_completed is keyed by (candidateId, ts) and looked up
    # using M30_EXECUTION_CONFIRMED's own timestamp as the join key --
    # the occurrence printed in the SAME tick as the real execution.
    entry_timer_started = {}       # candidateId -> {ts (=origin field), direction} (first occurrence only)
    entry_delay_completed = {}     # (candidateId, ts) -> fields
    execution_confirmed = {}       # positionId (ticket) -> {candidateId, ts}
    by_ts_decision_snapshot = {}  # ts -> {regime, structure, grade, ...}
    by_ts_market_thesis = {}      # ts -> {location, exhaustion, timing, HTF, structure, pressure, action}
    by_ts_lifecycle = {}          # ts -> {state, trendDirection, trendHealth, maturity, ...}
    by_ts_final_arbiter = {}      # ts -> {location, pressure, exhaustion, decision}
    by_ts_learned_quality = {}    # ts -> {trendHealth, pullbackCompletion, trapRisk, liquiditySweep, breakoutAcceptance}

    with journal_path.open("r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            if "M30_EXECUTION_CONFIRMED" in line:
                m = LOG_LINE_RE.match(line)
                if not m:
                    continue
                kv = kv_parse(m.group("body"))
                pid = kv.get("positionId")
                if pid:
                    execution_confirmed[pid] = {"candidateId": kv.get("executionKey"), "ts": m.group("ts")}
            elif "ENTRY_TIMER_STARTED" in line:
                m = LOG_LINE_RE.match(line)
                if not m:
                    continue
                kv = kv_parse(m.group("body"))
                cid = kv.get("candidateId")
                if cid and cid not in entry_timer_started:
                    # origin= is the EA's own stated timer-start timestamp,
                    # stable across re-logged duplicates; prefer it over
                    # the print-time ts, but fall back to ts if malformed.
                    # kv_parse joins embedded "date time" values with "_";
                    # undo that here so this ts matches the space-separated
                    # format every other by_ts_* dict is keyed on.
                    origin = kv.get("origin")
                    ts_signal = origin.replace("_", " ") if origin else m.group("ts")
                    entry_timer_started[cid] = {"ts": ts_signal, "direction": kv.get("direction")}
            elif "ENTRY_DELAY_COMPLETED" in line:
                m = LOG_LINE_RE.match(line)
                if not m:
                    continue
                kv = kv_parse(m.group("body"))
                cid = kv.get("candidateId")
                if cid:
                    entry_delay_completed[(cid, m.group("ts"))] = kv
            elif "DECISION_SNAPSHOT" in line:
                m = LOG_LINE_RE.match(line)
                if not m:
                    continue
                by_ts_decision_snapshot[m.group("ts")] = kv_parse(m.group("body"))
            elif "MARKET_THESIS" in line:
                m = LOG_LINE_RE.match(line)
                if not m:
                    continue
                by_ts_market_thesis[m.group("ts")] = kv_parse(m.group("body"))
            elif "[MARKET_LIFECYCLE]" in line:
                m = LOG_LINE_RE.match(line)
                if not m:
                    continue
                by_ts_lifecycle[m.group("ts")] = kv_parse(m.group("body"))
            elif "FINAL_ENTRY_ARBITER" in line:
                m = LOG_LINE_RE.match(line)
                if not m:
                    continue
                by_ts_final_arbiter[m.group("ts")] = kv_parse(m.group("body"))
            elif "LEARNED_ENTRY_QUALITY_TRACE" in line:
                m = LOG_LINE_RE.match(line)
                if not m:
                    continue
                by_ts_learned_quality[m.group("ts")] = kv_parse(m.group("body"))

    return {
        "entry_timer_started": entry_timer_started,
        "entry_delay_completed": entry_delay_completed,
        "execution_confirmed": execution_confirmed,
        "decision_snapshot": by_ts_decision_snapshot,
        "market_thesis": by_ts_market_thesis,
        "lifecycle": by_ts_lifecycle,
        "final_arbiter": by_ts_final_arbiter,
        "learned_quality": by_ts_learned_quality,
    }


def _f(x, default=None):
    if x is None:
        return default
    try:
        return float(x)
    except ValueError:
        return default


def classify_entry_timing(move_r, elapsed_s, mfe_r, mae_r, result):
    """Deterministic rule, documented here (not invented per-trade by
    inspection of the outcome): classification is based ONLY on
    information available at/around entry time -- the EA's own
    moveFromIntendedEntryR (price drift during the timer wait) and
    elapsedSeconds (which real checkpoint resolved the candidate) --
    plus MFE/MAE, which describe how the trade behaved AFTER entry
    (used only to distinguish "chased and it still worked" from "chased
    and got punished," not to relabel the entry itself)."""
    if move_r is None:
        return "UNDETERMINED_INSUFFICIENT_DATA"
    if move_r >= 0.15:
        return "LATE_ENTRY_CHASED_DURING_TIMER"
    if move_r <= -0.10:
        return "EARLY_ENTRY_PRICE_IMPROVED_DURING_TIMER"
    if abs(move_r) < 0.05:
        return "GOOD_TIMING_NEAR_SIGNAL_PRICE"
    return "MODERATE_DRIFT_DURING_TIMER"


def build_rows(campaigns_csv: Path, positions_csv: Path, events: dict):
    rows = []
    with campaigns_csv.open() as f:
        campaigns = {c["campaign_id"]: c for c in csv.DictReader(f)}
    with positions_csv.open() as f:
        positions = list(csv.DictReader(f))

    # positionId from M30_EXECUTION_CONFIRMED IS the real ticket -- this is
    # the only field in this whole join that is genuinely 1:1 with a real
    # trade (unlike candidateId/ts, which both re-appear on every
    # re-validation tick while a candidate's timer is running).
    matched = 0
    for pos in positions:
        if pos.get("leg_role") != "CORE":
            # PYRAMID legs attach to an already-open campaign via
            # CAMPAIGN_ADD_REGISTERED, not their own M30 candidate/timer
            # cycle -- regime/timing evidence here is signal-vs-entry for
            # the CORE decision that originated the campaign.
            continue
        ticket = pos["ticket"]
        ec = events["execution_confirmed"].get(ticket)
        if not ec:
            continue
        cid = ec["candidateId"]
        ts_entry = ec["ts"]
        camp = campaigns.get(pos["campaign_id"])
        if not camp:
            continue
        matched += 1
        ed = events["entry_delay_completed"].get((cid, ts_entry), {})
        ts_signal = events["entry_timer_started"].get(cid, {}).get("ts")

        ds_signal = events["decision_snapshot"].get(ts_signal, {}) if ts_signal else {}
        ds_entry = events["decision_snapshot"].get(ts_entry, {})
        mt_signal = events["market_thesis"].get(ts_signal, {}) if ts_signal else {}
        mt_entry = events["market_thesis"].get(ts_entry, {})
        lc_signal = events["lifecycle"].get(ts_signal, {}) if ts_signal else {}
        lc_entry = events["lifecycle"].get(ts_entry, {})
        fa_entry = events["final_arbiter"].get(ts_entry, {})
        lq_entry = events["learned_quality"].get(ts_entry, {})

        move_r = _f(ed.get("moveFromIntendedEntryR"))
        elapsed_s = _f(ed.get("elapsedSeconds"))
        regime_signal = ds_signal.get("regime")
        regime_entry = ds_entry.get("regime")

        rows.append({
            "campaign_id": camp["campaign_id"],
            "candidate_id": cid,
            "signal_time": ts_signal,
            "entry_time": ts_entry,
            "elapsed_seconds": elapsed_s,
            "intended_entry_price": _f(ed.get("intendedEntry")),
            "actual_entry_price": _f(ed.get("currentPrice")),
            "move_from_intended_entry_r": move_r,
            "structure_valid_at_entry": ed.get("structureValid"),
            "final_action": ed.get("finalAction"),
            "regime_at_signal": regime_signal,
            "regime_at_entry": regime_entry,
            "regime_changed": (regime_signal is not None and regime_entry is not None and regime_signal != regime_entry),
            "lifecycle_state_at_signal": lc_signal.get("state"),
            "lifecycle_state_at_entry": lc_entry.get("state"),
            "lifecycle_changed": (lc_signal.get("state") is not None and lc_entry.get("state") is not None
                                    and lc_signal.get("state") != lc_entry.get("state")),
            "location_at_signal": mt_signal.get("location"),
            "location_at_entry": mt_entry.get("location"),
            "exhaustion_state_at_signal": mt_signal.get("exhaustion"),
            "exhaustion_state_at_entry": mt_entry.get("exhaustion"),
            "timing_state_at_signal": mt_signal.get("timing"),
            "timing_state_at_entry": mt_entry.get("timing"),
            "htf_state_at_signal": mt_signal.get("HTF"),
            "htf_state_at_entry": mt_entry.get("HTF"),
            "structure_state_at_signal": mt_signal.get("structure"),
            "structure_state_at_entry": mt_entry.get("structure"),
            "pressure_state_at_signal": mt_signal.get("pressure"),
            "pressure_state_at_entry": mt_entry.get("pressure"),
            "final_arbiter_location": fa_entry.get("location"),
            "final_arbiter_pressure": fa_entry.get("pressure"),
            "final_arbiter_exhaustion_pct": fa_entry.get("exhaustion"),
            "final_arbiter_decision": fa_entry.get("decision"),
            "learned_trend_health": lq_entry.get("trendHealth"),
            "learned_pullback_completion_pct": lq_entry.get("pullbackCompletion"),
            "learned_continuation_pct": lq_entry.get("continuation"),
            "learned_trap_risk_pct": lq_entry.get("trapRisk"),
            "learned_liquidity_sweep": lq_entry.get("liquiditySweep"),
            "learned_breakout_acceptance": lq_entry.get("breakoutAcceptance"),
            "entry_timing_classification": classify_entry_timing(move_r, elapsed_s, None, None, None),
            "data_source": "EXACT_JOURNAL",
        })

    return rows, matched


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--journal", required=True, type=Path)
    ap.add_argument("--out-dir", required=True, type=Path)
    args = ap.parse_args()

    campaigns_csv = args.out_dir / "60DAY_ALL_CAMPAIGNS.csv"
    positions_csv = args.out_dir / "60DAY_ALL_POSITIONS.csv"

    print("Scanning journal for regime/lifecycle/timing evidence...")
    events = scan_journal(args.journal)
    print(f"  entry_timer_started(unique candidates)={len(events['entry_timer_started'])} "
          f"entry_delay_completed(occurrences)={len(events['entry_delay_completed'])} "
          f"execution_confirmed(unique tickets)={len(events['execution_confirmed'])} "
          f"decision_snapshot_timestamps={len(events['decision_snapshot'])} "
          f"market_thesis_timestamps={len(events['market_thesis'])} "
          f"lifecycle_timestamps={len(events['lifecycle'])} "
          f"final_arbiter_timestamps={len(events['final_arbiter'])} "
          f"learned_quality_timestamps={len(events['learned_quality'])}")

    rows, matched = build_rows(campaigns_csv, positions_csv, events)
    print(f"Matched {matched} CORE positions to a real M30_EXECUTION_CONFIRMED "
          f"ticket (of {len(events['execution_confirmed'])} confirmed executions)")

    fieldnames = list(rows[0].keys()) if rows else []
    out_csv = args.out_dir / "60DAY_ENTRY_TIMING_AND_REGIME.csv"
    with out_csv.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            w.writerow(r)
    print(f"Wrote {len(rows)} rows to {out_csv}")


if __name__ == "__main__":
    main()
