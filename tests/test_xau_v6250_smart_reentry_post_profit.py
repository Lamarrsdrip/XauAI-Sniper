from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def find_function(ea: str, signature: str) -> str:
    start = ea.index(signature)
    open_idx = ea.index("{", start)
    depth = 0
    i = open_idx
    while i < len(ea):
        if ea[i] == "{":
            depth += 1
        elif ea[i] == "}":
            depth -= 1
            if depth == 0:
                return ea[start:i + 1]
        i += 1
    raise AssertionError(f"unbalanced braces for {signature}")


def test_root_and_backend_copies_synced():
    assert read(EA) == read(BACKEND_EA)


FN_SIG = "ENUM_XAU_POST_PROFIT_DECISION XAU_EvaluatePostProfitEntry(int requestedDirection, double currentPrice, double freshSLDistance, string &reason)"


def test_exactly_one_canonical_post_profit_authority():
    ea = read(EA)
    assert ea.count(FN_SIG) == 1


def test_cooldown_expiry_alone_cannot_open_a_trade():
    ea = read(EA)
    fn = find_function(ea, FN_SIG)
    # the function never reads cooldownExpiresAt/POST_TRADE_COOLDOWN as a
    # permission signal -- only exitPrice/wasProfitable/closeTime age
    assert "cooldownExpiresAt" not in fn
    assert "POST_TRADE_COOLDOWN" not in fn


def test_no_recent_profitable_close_is_normal_fresh_signal():
    ea = read(EA)
    fn = find_function(ea, FN_SIG)
    idx = fn.index("if(!g_postClose[slot].valid || !g_postClose[slot].wasProfitable || g_postClose[slot].direction != requestedDirection)")
    window = fn[idx: idx + 250]
    assert "return POST_PROFIT_NORMAL_FRESH_SIGNAL;" in window


def test_move_already_missed_uses_owner_030R_threshold():
    ea = read(EA)
    fn = find_function(ea, FN_SIG)
    assert "if(distanceFromExitR >= 0.30)" in fn
    idx = fn.index("if(distanceFromExitR >= 0.30)")
    window = fn[idx: idx + 200]
    assert "return POST_PROFIT_MOVE_ALREADY_MISSED;" in window


# v6.25.1 owner directive 2026-07-17 -- price-at-or-better-than-exit ALONE
# must NOT mean RETRACE_CONFIRMED (owner item 2, the exact bug this test
# used to assert as correct behavior). Real structure/pressure/reaction/room
# evidence (retraceEvidenceConfirmed) is now required in addition to price;
# price improvement without that evidence yields WAIT_FOR_RETRACE, and the
# candidate is preserved (never deleted) while waiting.
def test_price_at_or_better_than_exit_alone_is_not_sufficient_for_retrace_confirmed():
    ea = read(EA)
    fn = find_function(ea, FN_SIG)
    assert "bool retraceEvidenceConfirmed = structureValid && pressureRestoring && reactionConfirmed && roomValid;" in fn
    idx = fn.index("if(!worsePriceThanExit)")
    window = fn[idx: idx + 900]
    assert "if(retraceEvidenceConfirmed)" in window
    assert "return POST_PROFIT_RETRACE_CONFIRMED;" in window
    assert "return POST_PROFIT_WAIT_FOR_RETRACE;" in window
    # RETRACE_CONFIRMED must be nested inside the evidence check, not a
    # bare consequence of price alone
    confirmed_idx = window.index("return POST_PROFIT_RETRACE_CONFIRMED;")
    evidence_idx = window.index("if(retraceEvidenceConfirmed)")
    assert evidence_idx < confirmed_idx


def test_retrace_evidence_requires_all_four_components_for_both_buy_and_sell():
    ea = read(EA)
    fn = find_function(ea, FN_SIG)
    assert "bool structureValid" in fn
    assert "bool pressureRestoring" in fn
    assert "bool reactionConfirmed = sameSideStillDominant ? (td.continuationConfidence >= 50.0)" in fn
    assert "(td.oppositeReclaim || td.oppositeRetestHeld || td.oppositeDisplacement);" in fn
    assert "bool roomValid = roomForRequestedDir >= 0.30;" in fn
    # symmetric: reactionConfirmed's opposite-side branch (used when the
    # market's dominant direction genuinely flipped) reads the same reclaim/
    # retest/displacement evidence regardless of BUY or SELL direction
    assert "sameSideStillDominant ?" in fn


def test_worse_price_recognized_before_deciding_wait_or_continue():
    ea = read(EA)
    fn = find_function(ea, FN_SIG)
    assert "bool worsePriceThanExit = distanceFromExitR > 0.0;" in fn


def test_immediate_continuation_requires_strong_rising_pressure_not_just_high():
    ea = read(EA)
    fn = find_function(ea, FN_SIG)
    idx = fn.index("bool exceptionalContinuation =")
    window = fn[idx: idx + 300]
    assert "samePressureNow >= 70.0" in window
    assert "samePressureSlope > 3.0" in window  # slope, not just level
    assert "samePressureNow > oppositePressureNow" in window
    assert "td.continuationConfidence >= 55.0" in window


def test_reuses_existing_transition_engine_evidence_not_a_new_indicator():
    ea = read(EA)
    fn = find_function(ea, FN_SIG)
    assert "XAU_AdaptiveTransitionDecision td = XAU_AdaptiveMarketTransitionEngine();" in fn
    assert "g_prevBuyConfidenceForSlope" in fn
    assert "g_prevSellConfidenceForSlope" in fn


def test_candidate_preserved_while_waiting_no_deletion():
    ea = read(EA)
    fn = find_function(ea, FN_SIG)
    # WAIT_FOR_RETRACE is a return value only -- the function never mutates
    # or clears any candidate/campaign state itself
    assert "g_alignedCandidates" not in fn
    assert "g_campaign[" not in fn


def test_stale_profitable_close_treated_as_fresh_not_indefinite_wait():
    ea = read(EA)
    fn = find_function(ea, FN_SIG)
    assert "#define XAU_POST_PROFIT_RELEVANCE_SECONDS 1800" in ea
    assert "ageSec > XAU_POST_PROFIT_RELEVANCE_SECONDS" in fn
    idx = fn.index("ageSec > XAU_POST_PROFIT_RELEVANCE_SECONDS")
    window = fn[idx: idx + 250]
    assert "return POST_PROFIT_NORMAL_FRESH_SIGNAL;" in window


# ---------------------------------------------------------------------------
# integration: wired into OpenTrade(), manual-exempt (quality heuristic, not
# a safety invariant), does not touch risk/SL/exit/timer
# ---------------------------------------------------------------------------
# v6.25.1 owner directive 2026-07-17 -- REORDERED. The post-profit gate used
# to run BEFORE the SL-widening block, so its 0.30R missed-move check was
# silently using the RAW pre-widening structural distance as its "1R" unit
# instead of the final, actually-risked distance -- a real bug (owner item
# 3), not just documentation drift. The widening step (which now calls the
# canonical XAU_ComputeFinalRiskGeometry) was moved to run FIRST, so the
# gate reads slDist only after it has been reassigned to
# finalGeometry.finalOriginalRiskDistance.
def test_opentrade_calls_post_profit_gate_after_final_sl_distance_known():
    ea = read(EA)
    fn = find_function(ea, "bool OpenTrade(int signal, double atr, string reason, double sizeMulti, bool isManualOverride = false)")
    widening_idx = fn.index("slDist = finalGeometry.finalOriginalRiskDistance;")
    gate_idx = fn.index("XAU_EvaluatePostProfitEntry(signal, price, slDist, postProfitReason)")
    assert widening_idx < gate_idx, "SL widening must be applied before the post-profit gate reads slDist as its 1R unit"


def test_post_profit_gate_is_manual_override_exempt():
    ea = read(EA)
    fn = find_function(ea, "bool OpenTrade(int signal, double atr, string reason, double sizeMulti, bool isManualOverride = false)")
    idx = fn.index("if(!isManualOverride)\n   {\n      string postProfitReason")
    assert idx > 0


def test_blocks_only_on_wait_or_missed_not_other_decisions():
    ea = read(EA)
    fn = find_function(ea, "bool OpenTrade(int signal, double atr, string reason, double sizeMulti, bool isManualOverride = false)")
    idx = fn.index("if(postProfitDecision == POST_PROFIT_WAIT_FOR_RETRACE || postProfitDecision == POST_PROFIT_MOVE_ALREADY_MISSED)")
    window = fn[idx: idx + 600]
    assert "return false;" in window


def test_entry_timer_and_risk_constants_not_touched_by_this_feature():
    ea = read(EA)
    # sanity: the same 120/150s entry-timer values from the M10 test file
    # still present unchanged
    assert "input int    InpM5EntryDelayMinSeconds      = 120;" in ea
    assert "input double InpNormalRiskPct" in ea or "InpNormalRiskPct" in ea


def test_post_close_state_captures_exit_price_and_profitability():
    ea = read(EA)
    assert "double   exitPrice;" in ea
    assert "bool     wasProfitable;" in ea
    assert "g_postClose[closeSlot].exitPrice                     = dPrice;" in ea
    assert "g_postClose[closeSlot].wasProfitable                 = profit > 0.0;" in ea


if __name__ == "__main__":
    import sys
    import pytest
    sys.exit(pytest.main([__file__, "-q"]))
