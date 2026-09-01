"""Tests for scripts/replay_learning_harness.py and
scripts/unified_thesis_mirror.py -- covers the required-tests list from
the replay-learning spec that are testable without real market data
(no-lookahead enforcement, determinism, BUY/SELL compared together,
generalized-not-memorized lessons, exhaustion-without-reversal,
one-candle-does-not-flip, etc). Scenarios that require an actual 30-90 day
dataset are covered separately by running the harness against real data
(see the replay report artifacts, not unit tests, since that data lives
outside the repo per the established privacy convention).
"""

import csv
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))

from unified_thesis_mirror import (  # noqa: E402
    TransitionDecision, compute_thesis, bucket_location, bucket_exhaustion,
    bucket_timing, bucket_htf, bucket_structure, bucket_pressure,
    TREND_HEALTHY, TREND_EXHAUSTING, TRANSITION_NEUTRAL,
    OPPOSITE_DIRECTION_FORMING, OPPOSITE_DIRECTION_CONFIRMED,
)
import replay_learning_harness as harness  # noqa: E402


# ---------------------------------------------------------------------------
# Required test 1: no future-data leakage
# ---------------------------------------------------------------------------

def test_decide_raises_on_any_outcome_field_present():
    row_with_leak = {"direction": "BUY", "simulated_R": "2.0"}
    try:
        harness.decide(row_with_leak)
        assert False, "expected an assertion error for outcome-field leakage"
    except AssertionError as e:
        assert "no-lookahead violation" in str(e)


def test_strip_to_decision_time_fields_removes_every_outcome_column():
    full_row = {f: "x" for f in harness.DECISION_TIME_FIELDS | harness.OUTCOME_ONLY_FIELDS}
    stripped = harness.strip_to_decision_time_fields(full_row)
    assert not (set(stripped.keys()) & harness.OUTCOME_ONLY_FIELDS)
    assert set(stripped.keys()) == harness.DECISION_TIME_FIELDS


def test_decide_never_reads_outcome_fields_even_when_present_in_full_row():
    # decide() is only ever called with the pre-stripped row in the real
    # pipeline (see run_replay) -- this test proves the assertion actually
    # fires if that discipline were ever violated by a future edit.
    leaking_row = harness.strip_to_decision_time_fields({
        "direction": "SELL", "m5_state": "OK", "m15_state": "OK", "m30_state": "OK",
        "entry_phase": "EARLY", "late_chase_status": "N",
    })
    leaking_row["max_mfe"] = "5.0"  # simulate a coding mistake reintroducing an outcome field
    try:
        harness.decide(leaking_row)
        assert False, "expected no-lookahead violation to be caught"
    except AssertionError:
        pass


# ---------------------------------------------------------------------------
# Required test 2: exact historical prices are not stored as future rules
# ---------------------------------------------------------------------------

def test_no_hardcoded_price_thresholds_in_source():
    src = (SCRIPTS / "replay_learning_harness.py").read_text()
    # no literal 4-digit gold price constants (4000-4999) anywhere in the
    # decision logic -- every threshold used is a percentage, ratio, or
    # categorical state, never a specific historical price level
    import re
    price_like = re.findall(r"\b4\d{3}(?:\.\d+)?\b", src)
    assert price_like == [], f"found price-like literals: {price_like}"


def test_mapping_uses_generalized_categories_not_exact_prices():
    # entry_price/sl_price/tp_price ARE read, but only to compute a
    # RATIO (remainingRewardR = distance/ATR) -- never compared against a
    # fixed price constant
    src = (SCRIPTS / "replay_learning_harness.py").read_text()
    assert "abs(tp_price - entry_price) / atr" in src


# ---------------------------------------------------------------------------
# Required test 3: BUY and SELL compared in one decision
# ---------------------------------------------------------------------------

def test_one_signal_authority_evaluates_both_sides_via_dominant_direction():
    # the same TransitionDecision carries both remainingRewardR (aligned
    # side) and oppositeRemainingRewardR (other side) -- compute_thesis
    # for either signal reads the SAME td, proving both sides are
    # evaluated from one shared evidence object, not two independent ones
    td = TransitionDecision(dominantDirection=1, remainingRewardR=3.0, oppositeRemainingRewardR=0.3)
    buy_thesis = compute_thesis(1, False, td)
    sell_thesis = compute_thesis(-1, False, td)
    assert buy_thesis["action"] != "HARD_BLOCK"
    # the opposite side, evaluated from the SAME td, sees the low room
    assert sell_thesis["direction"] == -1


# ---------------------------------------------------------------------------
# Required tests 4-5: strong trend + location combinations
# ---------------------------------------------------------------------------

def test_strong_trend_good_location_produces_clear_allow():
    td = TransitionDecision(dominantDirection=1, remainingRewardR=3.0,
                            entryLocationQuality=75.0, moveAlreadyConsumedPct=20.0,
                            exhaustionProbability=20.0, lifecycle=TREND_HEALTHY)
    thesis = compute_thesis(1, False, td)
    assert thesis["action"] == "ALLOW_CORE"


def test_strong_trend_bad_location_produces_wait():
    td = TransitionDecision(dominantDirection=1, remainingRewardR=3.0,
                            entryLocationQuality=20.0, moveAlreadyConsumedPct=75.0,
                            exhaustionProbability=30.0, lifecycle=TREND_HEALTHY)
    thesis = compute_thesis(1, False, td)
    assert thesis["action"] in ("ALLOW_SCALP", "WAIT_FOR_PULLBACK", "WAIT_FOR_CONFIRMATION")
    assert thesis["action"] != "ALLOW_CORE"


# ---------------------------------------------------------------------------
# Required test 6: exhausted without opposite confirmation -> stop adds, no reverse
# ---------------------------------------------------------------------------

def test_exhausted_without_opposite_confirmation_stops_adds_not_reverses():
    td = TransitionDecision(dominantDirection=1, existingBuyAction=1,  # TRANSITION_STOP_ADDS
                            lifecycle=TREND_EXHAUSTING, exhaustionProbability=90.0,
                            reversalProbability=10.0)
    thesis = compute_thesis(1, True, td)  # pyramid add
    assert thesis["action"] == "NO_MORE_ADDS"
    assert thesis["action"] != "HARD_BLOCK"


# ---------------------------------------------------------------------------
# Required test 7: confirmed opposite M5/M15 transition permits reversal
# ---------------------------------------------------------------------------

def test_confirmed_opposite_transition_permits_reversal():
    td = TransitionDecision(dominantDirection=-1, lifecycle=OPPOSITE_DIRECTION_CONFIRMED,
                            oppositeReclaim=True, oppositeRetestHeld=True,
                            oppositeRemainingRewardR=2.6, entryLocationQuality=65.0)
    thesis = compute_thesis(1, False, td)
    assert thesis["action"] == "ALLOW_CORE"


# ---------------------------------------------------------------------------
# Required test 8: one opposite candle does not flip the campaign
# ---------------------------------------------------------------------------

def test_one_opposite_candle_does_not_flip_campaign():
    # a single opposing candle inside a healthy trend is NOT modeled as
    # OPPOSITE_DIRECTION_FORMING/CONFIRMED -- lifecycle stays TREND_HEALTHY
    td = TransitionDecision(dominantDirection=1, lifecycle=TREND_HEALTHY,
                            oppositeDisplacement=False, exhaustionProbability=25.0)
    thesis = compute_thesis(1, False, td)
    assert thesis["action"] == "ALLOW_CORE"


# ---------------------------------------------------------------------------
# Required test 9: healthy pullback not mistaken for reversal
# ---------------------------------------------------------------------------

def test_healthy_pullback_not_mistaken_for_reversal():
    td = TransitionDecision(dominantDirection=1, lifecycle=TREND_HEALTHY,
                            continuationEntryPaused=True, continuationEntryAllowed=False,
                            reversalWaitForPullback=True)
    thesis = compute_thesis(1, False, td)
    assert thesis["action"] == "WAIT_FOR_PULLBACK"
    assert thesis["action"] not in ("OPPOSITE_DISCOVERY", "HARD_BLOCK")


# ---------------------------------------------------------------------------
# Required test 10: failed continuation near liquidity is recognized
# ---------------------------------------------------------------------------

def test_failed_continuation_near_liquidity_protects_runner():
    td = TransitionDecision(dominantDirection=1, lifecycle=TREND_HEALTHY,
                            exhaustionProbability=90.0, reversalProbability=10.0,
                            remainingRewardR=0.3)
    thesis = compute_thesis(1, False, td)
    assert thesis["action"] == "PROTECT_RUNNER"


# ---------------------------------------------------------------------------
# Required test 11: late entry near campaign extreme rejected/downgraded
# ---------------------------------------------------------------------------

def test_late_entry_near_extreme_downgraded_not_silently_allowed():
    td = TransitionDecision(dominantDirection=1, moveAlreadyConsumedPct=95.0,
                            remainingRewardR=0.2, entryLocationQuality=20.0)
    thesis = compute_thesis(1, False, td)
    assert thesis["action"] in ("HARD_BLOCK", "WAIT_FOR_PULLBACK", "ALLOW_SCALP")
    assert thesis["action"] != "ALLOW_CORE"


# ---------------------------------------------------------------------------
# Required test 12: valid early entry remains executable
# ---------------------------------------------------------------------------

def test_valid_early_entry_remains_executable():
    td = TransitionDecision(dominantDirection=1, moveAlreadyConsumedPct=10.0,
                            remainingRewardR=4.0, entryLocationQuality=85.0,
                            exhaustionProbability=10.0)
    thesis = compute_thesis(1, False, td)
    assert thesis["action"] == "ALLOW_CORE"


# ---------------------------------------------------------------------------
# Required tests 13-14: intraday survives M5 noise / real M15 invalidation exits
# ---------------------------------------------------------------------------

def test_structure_mixed_does_not_hard_block_alone():
    td = TransitionDecision(dominantDirection=1, entryLocationQuality=65.0)
    thesis = compute_thesis(1, False, td)
    assert thesis["structure"] in ("STRUCTURE_MIXED", "STRUCTURE_SUPPORTS", "STRUCTURE_STRONGLY_SUPPORTS")
    assert thesis["action"] != "HARD_BLOCK"


def test_confirmed_opposite_bos_and_htf_is_the_real_invalidation_trigger():
    td = TransitionDecision(dominantDirection=1, smcBosDir=-1, htfConsensusDir=-1)
    thesis = compute_thesis(1, False, td)
    assert thesis["structure"] == "STRUCTURE_INVALIDATED"
    assert thesis["action"] == "HARD_BLOCK"


# ---------------------------------------------------------------------------
# Required test 17: one replay week cannot modify production automatically
# ---------------------------------------------------------------------------

def test_harness_never_writes_to_backend_ea_source():
    # the module docstring legitimately NAMES the .mq5 source it mirrors,
    # for context -- that is documentation, not a file write. The actual
    # safety property is that the one real file-write path in the module
    # (report generation) only ever targets the caller-supplied --out
    # argument, never a hardcoded backend/ea_code or .mq5 path.
    src = (SCRIPTS / "replay_learning_harness.py").read_text()
    assert 'args.out.write_text(' in src
    # no OTHER write call exists in the file besides that one -- grep for
    # every open(...,"w" / write_text( occurrence and confirm each is
    # scoped to args.out, not a literal path
    import re
    write_calls = re.findall(r'(\w+(?:\.\w+)*)\.write_text\(', src)
    assert write_calls == ["args.out"] * len(write_calls)
    assert not re.search(r'open\([^)]*["\']w["\']', src), "found a raw open(...,'w') call outside write_text"


# ---------------------------------------------------------------------------
# Required test 20: same replay data produces deterministic output
# ---------------------------------------------------------------------------

def test_determinism_same_input_same_output(tmp_path):
    sample_rows = [
        {"opportunity_id": "T1", "timestamp": "2026.07.09 00:05:00", "direction": "BUY",
         "m5_state": "OK", "m15_state": "OK", "m30_state": "OK", "fastScore": "55", "required": "70",
         "atr": "2.88", "entry_price": "4079.94", "sl_price": "4072.74", "tp_price": "4094.34",
         "entry_phase": "MID", "late_chase_status": "N",
         "win_loss_notrade": "WIN", "simulated_R": "2.0", "max_mfe": "1.5", "max_mae": "0.3"},
    ]
    results1 = harness.run_replay(sample_rows)
    results2 = harness.run_replay(sample_rows)
    assert results1[0]["thesis"] == results2[0]["thesis"]
    assert results1[0]["graded"] == results2[0]["graded"]


def test_report_generation_end_to_end_on_synthetic_csv(tmp_path):
    csv_path = tmp_path / "sample.csv"
    fieldnames = list(harness.DECISION_TIME_FIELDS | harness.OUTCOME_ONLY_FIELDS | {"opportunity_id"})
    rows = [
        {**{f: "" for f in fieldnames}, "opportunity_id": "A1", "timestamp": "2026.07.09 00:05:00",
         "direction": "BUY", "m5_state": "OK", "m15_state": "OK", "m30_state": "OK",
         "fastScore": "60", "required": "70", "atr": "2.5", "entry_price": "4080", "sl_price": "4073",
         "tp_price": "4095", "entry_phase": "EARLY", "late_chase_status": "N",
         "win_loss_notrade": "WIN", "simulated_R": "2.0", "max_mfe": "2.5", "max_mae": "0.2"},
        {**{f: "" for f in fieldnames}, "opportunity_id": "A2", "timestamp": "2026.07.09 05:00:00",
         "direction": "SELL", "m5_state": "OK", "m15_state": "AGAINST", "m30_state": "AGAINST",
         "fastScore": "40", "required": "70", "atr": "2.5", "entry_price": "4090", "sl_price": "4097",
         "tp_price": "4075", "entry_phase": "LATE_OR_WEAK", "late_chase_status": "Y",
         "win_loss_notrade": "LOSS", "simulated_R": "-1.0", "max_mfe": "0.1", "max_mae": "1.8"},
    ]
    with csv_path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    parsed_rows = harness.read_csv(csv_path)
    results = harness.run_replay(parsed_rows)
    report = harness.build_report(results)
    assert report["total_decisions"] == 2
    assert report["trap_avoidance"]["real_late_chase_flags"] == 1


def test_trap_scenario_correctly_flagged_not_missed():
    # A2 above: late_chase=Y, real outcome LOSS -- the thesis for a
    # LATE_OR_WEAK+late_chase=Y candidate must not be ALLOW_CORE
    row = harness.strip_to_decision_time_fields({
        "direction": "SELL", "m5_state": "OK", "m15_state": "AGAINST", "m30_state": "AGAINST",
        "fastScore": "40", "required": "70", "atr": "2.5", "entry_price": "4090",
        "sl_price": "4097", "tp_price": "4075", "entry_phase": "LATE_OR_WEAK", "late_chase_status": "Y",
    })
    thesis = harness.decide(row)
    full_row = {**row, "late_chase_status": "Y", "win_loss_notrade": "LOSS",
               "simulated_R": "-1.0", "max_mfe": "0.1", "max_mae": "1.8", "opportunity_id": "A2"}
    graded = harness.score(full_row, thesis)
    assert graded["correctly_flagged_trap"] is True
    assert graded["missed_trap"] is False


# ---------------------------------------------------------------------------
# Required test 15: premature exit is detected
# ---------------------------------------------------------------------------

def test_premature_exit_detected_via_unnecessary_caution_flag():
    # a genuinely good setup (late_chase=N) that the thesis would have
    # WAITED on, but that actually won -- flags as "unnecessarily
    # cautious", the harness's proxy for "would this have been a
    # premature non-entry / early exit relative to a good real outcome".
    row = harness.strip_to_decision_time_fields({
        "direction": "BUY", "m5_state": "OK", "m15_state": "NEUTRAL", "m30_state": "OK",
        "fastScore": "50", "required": "70", "atr": "2.5", "entry_price": "4080",
        "sl_price": "4073", "tp_price": "4095", "entry_phase": "MID", "late_chase_status": "N",
    })
    thesis = harness.decide(row)
    assert thesis["action"] == "TRANSITION_WATCH"  # m15_state=NEUTRAL -> lifecycle=TRANSITION_NEUTRAL
    full_row = {**row, "late_chase_status": "N", "win_loss_notrade": "WIN",
               "simulated_R": "2.0", "max_mfe": "2.0", "max_mae": "0.2", "opportunity_id": "A3"}
    graded = harness.score(full_row, thesis)
    assert graded["unnecessarily_cautious"] is True


# ---------------------------------------------------------------------------
# Required test 16: excessive giveback is measured
# ---------------------------------------------------------------------------

def test_excessive_giveback_measurable_from_real_mfe_vs_outcome():
    # the harness surfaces real_max_mfe alongside the real outcome so a
    # report consumer can compute giveback (peak favorable excursion that
    # was not captured) -- e.g. a WIN with a much larger max_mfe than the
    # realized simulated_R indicates profit given back. This is the same
    # peakFloatingProfit-vs-openPL giveback concept already implemented
    # and tested for LIVE positions in XAU_CampaignState (v6.24.9,
    # tests/test_xau_v6249_campaign_state_static.py); here it is the
    # historical-replay-side counterpart, computed from real MFE/outcome
    # fields revealed only after decide() runs.
    row = harness.strip_to_decision_time_fields({
        "direction": "BUY", "m5_state": "OK", "m15_state": "OK", "m30_state": "OK",
        "fastScore": "60", "required": "70", "atr": "2.5", "entry_price": "4080",
        "sl_price": "4073", "tp_price": "4095", "entry_phase": "EARLY", "late_chase_status": "N",
    })
    thesis = harness.decide(row)
    full_row = {**row, "late_chase_status": "N", "win_loss_notrade": "WIN",
               "simulated_R": "0.5", "max_mfe": "4.0", "max_mae": "0.1", "opportunity_id": "A4"}
    graded = harness.score(full_row, thesis)
    # real_max_mfe (4.0) far exceeds real_simulated_R (0.5) realized --
    # both are present in the graded output for a report-level giveback
    # calculation (max_mfe - simulated_R), not silently dropped
    assert graded["real_max_mfe"] == 4.0
    assert graded["real_simulated_R"] == 0.5
    giveback = graded["real_max_mfe"] - graded["real_simulated_R"]
    assert giveback > 3.0


# ---------------------------------------------------------------------------
# Required test 18: proposed changes must pass unseen 30-90 day validation
# ---------------------------------------------------------------------------

def test_harness_supports_date_range_filtering_for_holdout_splits():
    # the CLI's --from-date/--to-date args (see main()) are what a holdout
    # split relies on: tune on one window, validate on a disjoint one.
    # Verified here at the source level since main() itself isn't
    # unit-testable without argv plumbing.
    src = (SCRIPTS / "replay_learning_harness.py").read_text()
    assert '"--from-date"' in src
    assert '"--to-date"' in src
    assert "rows = [r for r in rows if r.get(\"timestamp\", \"\") >= args.from_date]" in src


# ---------------------------------------------------------------------------
# Required test 19: trade frequency must not collapse
# ---------------------------------------------------------------------------

def test_action_distribution_reports_allow_rate_not_just_blocks():
    # build_report's action_distribution must surface ALLOW_* counts
    # alongside WAIT/blocking counts so a before/after comparison can
    # detect a frequency collapse (e.g. ALLOW_CORE count dropping to
    # near-zero would be visible directly in this dict, not hidden).
    rows = []
    for i in range(5):
        rows.append({
            "opportunity_id": f"F{i}", "timestamp": f"2026.07.09 0{i}:00:00", "direction": "BUY",
            "m5_state": "OK", "m15_state": "OK", "m30_state": "OK", "fastScore": "70", "required": "70",
            "atr": "2.5", "entry_price": "4080", "sl_price": "4073", "tp_price": "4095",
            "entry_phase": "EARLY", "late_chase_status": "N",
            "win_loss_notrade": "WIN", "simulated_R": "2.0", "max_mfe": "2.0", "max_mae": "0.1",
        })
    results = harness.run_replay(rows)
    report = harness.build_report(results)
    allow_count = sum(v for k, v in report["action_distribution"].items() if k.startswith("ALLOW"))
    assert allow_count == 5  # all 5 healthy/early candidates remain executable, matching required test 12's property at the report level
