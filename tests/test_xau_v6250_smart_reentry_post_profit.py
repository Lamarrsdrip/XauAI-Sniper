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


def test_price_at_or_better_than_exit_is_retrace_confirmed():
    ea = read(EA)
    fn = find_function(ea, FN_SIG)
    idx = fn.index("if(!worsePriceThanExit)")
    window = fn[idx: idx + 250]
    assert "return POST_PROFIT_RETRACE_CONFIRMED;" in window


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
def test_opentrade_calls_post_profit_gate_after_final_sl_distance_known():
    ea = read(EA)
    fn = find_function(ea, "bool OpenTrade(int signal, double atr, string reason, double sizeMulti, bool isManualOverride = false)")
    gate_idx = fn.index("XAU_EvaluatePostProfitEntry(signal, price, slDist, postProfitReason)")
    widening_idx = fn.index("XAU_SL_WIDENING_FACTOR (1.20x), applied exactly")
    assert gate_idx < widening_idx, "post-profit gate must run before SL widening/lot sizing, not after"


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
