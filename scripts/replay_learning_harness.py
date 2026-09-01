#!/usr/bin/env python3
"""Rolling replay-learning harness: applies the canonical unified
market-thesis mirror (scripts/unified_thesis_mirror.py, the exact
priority-ordered logic in backend/ea_code/XAUUSD_AI_Sniper_EA.mq5's
XAU_ComputeMarketThesis) to real historical decision-point data,
chronologically, revealing outcome fields only AFTER the decision is
recorded -- never before.

======================================================================
WHAT DATA THIS ACTUALLY USES, AND WHY (read before trusting a number)
======================================================================

The spec this harness implements asks for a rolling 7-day tick/M1/M5/M15/H1
replay. That was investigated and found NOT achievable in this
environment, for two independently-confirmed reasons documented in
audits/v62411_full_unified_authority_final_report_20260715.md and
audits/timeframe_comparison/timeframe_comparison_report.md (a prior,
separate session's attempt at the same problem):

1. MT5 Strategy Tester requires launching the live terminal binary with a
   real account login -- blocked by this environment's own safety
   controls as a channel into live trading infrastructure. The isolated
   backtest worker (metatester64.exe) cannot run standalone; it hangs
   waiting for IPC orchestration only the live terminal provides
   (confirmed by direct test).
2. A prior session independently attempted to (a) run Tester against a
   relocated/sandboxed MT5 install -- blocked because MT5 wipes saved
   credentials on relocation and the demo password wasn't available to
   re-authenticate, and (b) reverse-engineer the raw cached history file
   format (.hc) -- got the timestamp column working (verified against
   10,747 real M15 bars) but could not reliably decode OHLC price
   columns, and explicitly stopped rather than risk silently wrong prices.

What IS available and used here instead: the EA's own real, previously
collected decision-point telemetry (BlockedTradeMemory-derived CSVs like
audits/timeframe_comparison/pure_m5_results.csv in the main XauAI-Sniper
repo) -- real historical dates, real M5/M15/M30 alignment state, real
fastScore, real ATR, real entry/SL/TP prices, and real forward-tracked
MAE/MFE/outcome checkpoints, all computed by the EA itself at the actual
historical moment. This is genuine historical ground truth. It uses an
OLDER feature vocabulary (v6.17.25-era) than the new v6.24.8-12 bucket
enums this harness reasons with, so every mapping from old field to new
bucket is a documented APPROXIMATION -- see map_row_to_transition_decision
below for the exact, stated mapping rule for every field. This is not a
literal re-execution of the new EA code against history; it is the
closest honest substitute achievable without the blocked data sources
above, and it is not the exact continuous-price OHLC replay the spec
originally asked for.

======================================================================
NO-LOOKAHEAD DISCIPLINE
======================================================================

Every row is processed in two strictly separated passes:
  1. decide(row) -- reads ONLY pre-decision fields (direction, setup,
     grade, m5/m15/m30 state, fastScore, required, atr, entry_phase,
     late_chase_status, session, sl/tp/entry price) and returns a thesis
     decision. This function must never read mae_*, mfe_*, simulated_*,
     win_loss_notrade, or reason_for_no_trade.
  2. score(row, decision) -- called AFTER decide() returns, reveals the
     outcome fields for grading only. Results are never fed back into
     decide() for the same or any other row.

A dedicated test (tests/test_replay_learning_harness.py) asserts decide()
literally cannot access the outcome columns, by construction (they are
stripped from the dict passed to it), not just by convention.
"""

import argparse
import csv
import json
from collections import Counter
from dataclasses import asdict
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from unified_thesis_mirror import (
    TransitionDecision, compute_thesis,
    TREND_EARLY, TREND_HEALTHY, TREND_EXHAUSTING, TRANSITION_NEUTRAL,
    old_side_state_from_row_evidence, map_to_readiness_state,
)

# Fields a decision function is allowed to see. Anything not in this set
# is an outcome/result field and must not reach decide().
DECISION_TIME_FIELDS = {
    "opportunity_id", "timestamp", "session", "setup", "grade", "direction",
    "signal_time", "signal_price", "entry_time", "entry_price", "sl_price",
    "tp_price", "atr", "m5_state", "m15_state", "m30_state", "fastScore",
    "required", "entry_phase", "late_chase_status",
}

OUTCOME_ONLY_FIELDS = {
    "mae_1m", "mae_3m", "mae_5m", "mae_10m", "mae_15m", "mae_20m", "max_mae",
    "mfe_1m", "mfe_3m", "mfe_5m", "mfe_10m", "mfe_15m", "mfe_20m", "max_mfe",
    "time_to_first_profit_min", "total_time_underwater_min",
    "sl_first_or_profit_first", "simulated_exit_result", "simulated_net_pnl_usd",
    "simulated_R", "win_loss_notrade", "reason_for_no_trade",
    "actual_historical_entry_price", "price_improvement_vs_actual",
}


def read_csv(path: Path) -> list:
    with path.open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def strip_to_decision_time_fields(row: dict) -> dict:
    """Enforces no-lookahead by construction: returns a NEW dict containing
    only DECISION_TIME_FIELDS, so decide() physically cannot reach an
    outcome column even by a coding mistake."""
    return {k: v for k, v in row.items() if k in DECISION_TIME_FIELDS}


def _to_float(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def map_row_to_transition_decision(decision_row: dict) -> tuple:
    """Documented, approximate mapping from the old telemetry schema to
    the new TransitionDecision fields. Every line states which real field
    it reads and what it assumes. Returns (signal, is_pyramid_add=False, td).
    """
    direction_txt = (decision_row.get("direction") or "").strip().upper()
    signal = 1 if direction_txt == "BUY" else -1 if direction_txt == "SELL" else 0

    m5 = (decision_row.get("m5_state") or "").strip().upper()
    m15 = (decision_row.get("m15_state") or "").strip().upper()
    m30 = (decision_row.get("m30_state") or "").strip().upper()
    entry_phase = (decision_row.get("entry_phase") or "").strip().upper()
    late_chase = (decision_row.get("late_chase_status") or "").strip().upper()
    fast_score = _to_float(decision_row.get("fastScore"), default=None)
    required = _to_float(decision_row.get("required"), default=None)
    atr = _to_float(decision_row.get("atr"), default=0.0)
    sl_price = _to_float(decision_row.get("sl_price"), default=0.0)
    tp_price = _to_float(decision_row.get("tp_price"), default=0.0)
    entry_price = _to_float(decision_row.get("entry_price"), default=0.0)

    def state_is_ok(s):
        return s.startswith("OK")

    def state_is_against(s):
        return s == "AGAINST"

    # HTF consensus direction: m15/m30 alignment is the closest real
    # analogue to g_htfConsensusDir. If either opposes, treat HTF as
    # opposing this candidate's direction (conservative: any real
    # opposition counts, not just full agreement).
    if state_is_against(m15) or state_is_against(m30):
        htf_dir = -signal if signal != 0 else 0
    elif state_is_ok(m15) or state_is_ok(m30):
        htf_dir = signal
    else:
        htf_dir = 0

    # dominantDirection: if HTF opposes, the "current campaign direction"
    # this candidate is fighting is the opposite side -- mirrors how
    # td.dominantDirection represents the PREVAILING direction, which the
    # candidate may or may not align with.
    dominant_direction = signal if htf_dir != -signal else -signal

    # Location quality: entry_phase is the closest real analogue to "how
    # early/late is this entry in the move" -- EARLY/MID/LATE_OR_WEAK map
    # to a coarse 0-100 quality score. late_chase_status=Y (the EA's own
    # real late-chase flag) forces the location to LATE regardless of
    # entry_phase, since it is a more specific, real signal.
    if late_chase == "Y":
        entry_location_quality = 25.0
        move_consumed_pct = 80.0
        exhaustion_probability = 75.0
    elif entry_phase == "EARLY":
        entry_location_quality = 82.0
        move_consumed_pct = 15.0
        exhaustion_probability = 15.0
    elif entry_phase == "MID":
        entry_location_quality = 62.0
        move_consumed_pct = 40.0
        exhaustion_probability = 35.0
    elif entry_phase == "LATE_OR_WEAK":
        entry_location_quality = 32.0
        move_consumed_pct = 72.0
        exhaustion_probability = 65.0
    else:
        # unknown entry_phase (blank/NO_TRADE rows) -- neutral defaults,
        # not a guess dressed up as a real reading
        entry_location_quality = 50.0
        move_consumed_pct = 50.0
        exhaustion_probability = 40.0

    # trendHealth: fastScore/required ratio is the closest real analogue
    # to "how strong is the setup relative to its own bar" -- when both
    # are present and required>0, scale to 0-100; otherwise fall back to
    # a value derived from location quality (documented approximation).
    if fast_score is not None and required not in (None, 0):
        trend_health = max(0.0, min(100.0, (fast_score / required) * 60.0))
    else:
        trend_health = entry_location_quality

    # remainingRewardR: derived from the REAL sl/tp/entry prices and ATR
    # when all three are present and atr>0 (genuine decision-time data,
    # not a guess); otherwise falls back to a neutral 2.0R so a missing
    # field doesn't manufacture either an artificially generous or
    # artificially starved room reading.
    if atr > 0 and entry_price and tp_price:
        remaining_reward_r = abs(tp_price - entry_price) / atr
    else:
        remaining_reward_r = 2.0

    # lifecycle: approximate categorical read from the same evidence above
    # -- there is no direct lifecycle field in the old schema.
    if m15 == "NEUTRAL":
        lifecycle = TRANSITION_NEUTRAL
    elif late_chase == "Y" or exhaustion_probability >= 65.0:
        lifecycle = TREND_EXHAUSTING
    elif entry_phase == "EARLY":
        lifecycle = TREND_EARLY
    else:
        lifecycle = TREND_HEALTHY

    # buyConfidence/sellConfidence: split a 0-100 "pressure" reading
    # derived from fastScore/required (as trend_health above) between the
    # two sides according to which direction the real evidence favors.
    if signal == 1:
        buy_confidence = trend_health
        sell_confidence = 100.0 - trend_health
    elif signal == -1:
        sell_confidence = trend_health
        buy_confidence = 100.0 - trend_health
    else:
        buy_confidence = sell_confidence = 50.0

    td = TransitionDecision(
        dominantDirection=dominant_direction,
        remainingRewardR=remaining_reward_r if signal == dominant_direction else 0.0,
        oppositeRemainingRewardR=remaining_reward_r if signal != dominant_direction else 0.0,
        entryLocationQuality=entry_location_quality,
        moveAlreadyConsumedPct=move_consumed_pct,
        exhaustionProbability=exhaustion_probability,
        transitionProbability=exhaustion_probability * 0.5,
        reversalProbability=5.0,  # no real reversal-confirmation field in the old schema -- documented gap, kept conservative
        trendHealth=trend_health,
        buyConfidence=buy_confidence,
        sellConfidence=sell_confidence,
        lifecycle=lifecycle,
        continuationEntryAllowed=(entry_phase in ("EARLY", "MID") and late_chase != "Y"),
        continuationEntryPaused=(entry_phase == "LATE_OR_WEAK" or late_chase == "Y"),
        htfConsensusDir=htf_dir,
        smcBosDir=0,       # no SMC-equivalent field in the old schema -- documented gap
        smcBonus=0.0,
    )
    return signal, False, td, htf_dir, entry_phase, late_chase


def decide(decision_row: dict) -> dict:
    """The one no-lookahead decision function. decision_row MUST already
    be stripped to DECISION_TIME_FIELDS by the caller."""
    assert not (set(decision_row.keys()) & OUTCOME_ONLY_FIELDS), (
        "no-lookahead violation: an outcome field reached decide()"
    )
    signal, is_pyramid_add, td, htf_dir, entry_phase, late_chase = map_row_to_transition_decision(decision_row)
    if signal == 0:
        return {"direction": 0, "action": "NO_VALID_TRADE", "reason": "no direction in source row",
                "readiness_state": "READINESS_INVALIDATED", "old_side_state": "OLD_DIRECTION_INVALIDATED"}
    thesis = compute_thesis(signal, is_pyramid_add, td)
    # v6.24.15 addition: same no-lookahead decision-time fields, now also
    # classified through the Entry Readiness Engine's mirror (see
    # unified_thesis_mirror.map_to_readiness_state's own docstring for the
    # documented limitation: this is the market-evidence layer only, not
    # the persistent multi-bar promotion gate, since these CSV rows are
    # independent decision points, not a continuous per-bar stream).
    old_side = old_side_state_from_row_evidence(signal, htf_dir, entry_phase, late_chase)
    thesis["old_side_state"] = old_side
    thesis["readiness_state"] = map_to_readiness_state(old_side, thesis)
    return thesis


def score(full_row: dict, thesis: dict) -> dict:
    """Called strictly after decide(). Reveals real outcome fields for
    grading only -- this result is never fed back into decide()."""
    outcome = (full_row.get("win_loss_notrade") or "").strip().upper()
    max_mfe = _to_float(full_row.get("max_mfe"), default=None)
    max_mae = _to_float(full_row.get("max_mae"), default=None)
    simulated_r = _to_float(full_row.get("simulated_R"), default=None)
    late_chase = (full_row.get("late_chase_status") or "").strip().upper()

    action = thesis["action"]
    would_have_allowed = action in ("ALLOW_CORE", "ALLOW_ADD", "ALLOW_SCALP")
    would_have_waited = action in ("WAIT_FOR_PULLBACK", "WAIT_FOR_RECLAIM",
                                   "WAIT_FOR_CONFIRMATION", "TRANSITION_WATCH",
                                   "NO_MORE_ADDS", "OPPOSITE_DISCOVERY")

    correctly_flagged_trap = (late_chase == "Y" and not would_have_allowed)
    missed_trap = (late_chase == "Y" and would_have_allowed and outcome == "LOSS")
    unnecessarily_cautious = (late_chase == "N" and outcome == "WIN" and would_have_waited)

    # v6.24.15 addition: readiness-engine grading, using the REAL time-based
    # MAE columns this CSV already has (mae_1m/3m/5m/10m) -- these are the
    # actual historical early-drawdown values, not simulated.
    readiness_state = thesis.get("readiness_state", "READINESS_FORMING")
    readiness_would_allow = (readiness_state == "READINESS_CONFIRMED")
    mae_1m = _to_float(full_row.get("mae_1m"), default=None)
    mae_3m = _to_float(full_row.get("mae_3m"), default=None)
    mae_5m = _to_float(full_row.get("mae_5m"), default=None)
    mae_10m = _to_float(full_row.get("mae_10m"), default=None)

    return {
        "opportunity_id": full_row.get("opportunity_id"),
        "real_outcome": outcome,
        "real_simulated_R": simulated_r,
        "real_max_mfe": max_mfe,
        "real_max_mae": max_mae,
        "real_mae_1m": mae_1m,
        "real_mae_3m": mae_3m,
        "real_mae_5m": mae_5m,
        "real_mae_10m": mae_10m,
        "thesis_action": action,
        "would_have_allowed": would_have_allowed,
        "would_have_waited": would_have_waited,
        "correctly_flagged_trap": correctly_flagged_trap,
        "missed_trap": missed_trap,
        "unnecessarily_cautious": unnecessarily_cautious,
        "readiness_state": readiness_state,
        "readiness_would_allow": readiness_would_allow,
    }


def run_replay(rows: list) -> list:
    """Chronological replay: decide() then score(), per row, in order."""
    results = []
    for row in sorted(rows, key=lambda r: r.get("timestamp", "")):
        decision_row = strip_to_decision_time_fields(row)
        thesis = decide(decision_row)
        graded = score(row, thesis)
        results.append({"row": row, "thesis": thesis, "graded": graded})
    return results


def build_report(results: list) -> dict:
    action_counts = Counter(r["thesis"]["action"] for r in results)
    graded = [r["graded"] for r in results]
    trades_with_outcome = [g for g in graded if g["real_outcome"] in ("WIN", "LOSS", "BREAKEVEN")]

    correctly_flagged = [g for g in graded if g["correctly_flagged_trap"]]
    missed_traps = [g for g in graded if g["missed_trap"]]
    unnecessarily_cautious = [g for g in graded if g["unnecessarily_cautious"]]

    allowed_and_won = [g for g in trades_with_outcome if g["would_have_allowed"] and g["real_outcome"] == "WIN"]
    allowed_and_lost = [g for g in trades_with_outcome if g["would_have_allowed"] and g["real_outcome"] == "LOSS"]

    return {
        "total_decisions": len(results),
        "decisions_with_real_outcome": len(trades_with_outcome),
        "action_distribution": dict(action_counts),
        "trap_avoidance": {
            "real_late_chase_flags": sum(1 for r in results if (r["row"].get("late_chase_status") or "").upper() == "Y"),
            "correctly_flagged_as_not_allow": len(correctly_flagged),
            "missed_traps_would_have_allowed_and_lost": len(missed_traps),
            "missed_trap_ids": [g["opportunity_id"] for g in missed_traps],
        },
        "over_caution_check": {
            "unnecessarily_cautious_count": len(unnecessarily_cautious),
            "unnecessarily_cautious_ids": [g["opportunity_id"] for g in unnecessarily_cautious],
        },
        "allowed_trade_outcomes": {
            "allowed_and_won": len(allowed_and_won),
            "allowed_and_lost": len(allowed_and_lost),
            "win_rate_of_allowed": (len(allowed_and_won) / max(1, len(allowed_and_won) + len(allowed_and_lost))),
        },
    }


def _avg(values):
    vals = [v for v in values if v is not None]
    return (sum(vals) / len(vals)) if vals else None


def build_early_mae_comparison(results: list) -> dict:
    """Before/after comparison the spec's Part 13 explicitly asks for,
    using REAL historical mae_1m/3m/5m/10m columns (not simulated) --
    "before" = the OLD system's classification (thesis action alone,
    matching what actually gated entries pre-v6.24.15); "after" = the
    NEW readiness engine's classification (readiness_state == CONFIRMED,
    a stricter subset). Only rows with a real recorded outcome are
    counted, so an empty group here is honest (no matching historical
    rows), not silently treated as zero drawdown."""
    graded = [r["graded"] for r in results if r["graded"]["real_outcome"] in ("WIN", "LOSS", "BREAKEVEN")]
    before = [g for g in graded if g["would_have_allowed"]]
    after = [g for g in graded if g["readiness_would_allow"]]

    def group_stats(group):
        return {
            "trade_count": len(group),
            "avg_mae_1m": _avg([g["real_mae_1m"] for g in group]),
            "avg_mae_3m": _avg([g["real_mae_3m"] for g in group]),
            "avg_mae_5m": _avg([g["real_mae_5m"] for g in group]),
            "avg_mae_10m": _avg([g["real_mae_10m"] for g in group]),
            "pct_immediately_negative_1m": (
                sum(1 for g in group if g["real_mae_1m"] is not None and g["real_mae_1m"] < 0) / len(group)
                if group else None
            ),
            "win_rate": (
                sum(1 for g in group if g["real_outcome"] == "WIN") / len(group) if group else None
            ),
        }

    return {"before_old_system": group_stats(before), "after_readiness_engine": group_stats(after)}


def split_train_validation_holdout(rows: list) -> dict:
    """Chronological 60/20/20 split (spec Part 12) -- oldest 60% = training,
    next 20% = validation, newest 20% = holdout. No shuffling: preserving
    chronological order is the entire point (prevents any future-leak into
    training)."""
    ordered = sorted(rows, key=lambda r: r.get("timestamp", ""))
    n = len(ordered)
    train_end = int(n * 0.60)
    val_end = int(n * 0.80)
    return {
        "training": ordered[:train_end],
        "validation": ordered[train_end:val_end],
        "holdout": ordered[val_end:],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data", type=Path, required=True,
                        help="real historical decision-point CSV (e.g. pure_m5_results.csv), outside the repo")
    parser.add_argument("--from-date", default=None, help="YYYY.MM.DD inclusive filter on timestamp")
    parser.add_argument("--to-date", default=None, help="YYYY.MM.DD inclusive filter on timestamp")
    parser.add_argument("--out", type=Path, required=True, help="output JSON report path")
    parser.add_argument("--train-val-holdout", action="store_true",
                        help="also run the chronological 60/20/20 train/validation/holdout study (spec Part 12)")
    args = parser.parse_args()

    rows = read_csv(args.data)
    if args.from_date:
        rows = [r for r in rows if r.get("timestamp", "") >= args.from_date]
    if args.to_date:
        rows = [r for r in rows if r.get("timestamp", "") <= args.to_date + " 23:59:59"]

    results = run_replay(rows)
    report = build_report(results)
    report["source_file"] = str(args.data)
    report["from_date"] = args.from_date
    report["to_date"] = args.to_date
    report["early_mae_comparison"] = build_early_mae_comparison(results)

    if args.train_val_holdout:
        splits = split_train_validation_holdout(rows)
        report["train_validation_holdout"] = {}
        for split_name, split_rows in splits.items():
            split_results = run_replay(split_rows)
            split_report = build_report(split_results)
            split_report["early_mae_comparison"] = build_early_mae_comparison(split_results)
            split_report["date_range"] = {
                "from": min((r.get("timestamp", "") for r in split_rows), default=None),
                "to": max((r.get("timestamp", "") for r in split_rows), default=None),
            }
            report["train_validation_holdout"][split_name] = split_report

    report["decision_rows"] = [
        {"opportunity_id": r["row"].get("opportunity_id"), "timestamp": r["row"].get("timestamp"),
         "thesis": r["thesis"], "graded": r["graded"]}
        for r in results
    ]

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    print(f"Replayed {len(results)} decisions -> {args.out}")
    print(json.dumps({k: v for k, v in report.items() if k not in ("decision_rows", "train_validation_holdout")}, indent=2))
    if args.train_val_holdout:
        for split_name in ("training", "validation", "holdout"):
            sr = report["train_validation_holdout"][split_name]
            print(f"\n--- {split_name.upper()} ({sr['date_range']['from']} to {sr['date_range']['to']}, n={sr['total_decisions']}) ---")
            print(json.dumps({
                "action_distribution": sr["action_distribution"],
                "allowed_trade_outcomes": sr["allowed_trade_outcomes"],
                "early_mae_comparison": sr["early_mae_comparison"],
            }, indent=2))


if __name__ == "__main__":
    main()
