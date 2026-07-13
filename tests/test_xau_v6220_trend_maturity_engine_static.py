"""
Regression tests for the v6.22.0 ADAPTIVE TREND MATURITY & EARLY REVERSAL
ENGINE (owner spec, 2026-07-13): a probability layer estimating where the
current directional move sits in its lifecycle (EARLY..CONFIRMED_REVERSAL)
that INFLUENCES campaign creation, pyramiding, protection, exit
classification, and post-campaign re-entry -- it is explicitly NOT another
confirmation filter, NOT another indicator, and must NOT panic existing
campaigns or block good trades outright except at its two most extreme
states.

Static-source tests, matching this repo's established convention.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXP = ROOT / "XAUUSD_AI_Sniper_EA_v6.22.0_ADAPTIVE_TREND_CAMPAIGN_EXP1.mq5"
PROD = ROOT / "XAUUSD_AI_Sniper_EA_v6.21.3.mq5"
BACKEND_PROD = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def body(src: str, signature: str) -> str:
    idx = src.index(signature)
    start = src.index("{", idx)
    depth = 0
    for i in range(start, len(src)):
        if src[i] == "{":
            depth += 1
        elif src[i] == "}":
            depth -= 1
            if depth == 0:
                return src[start:i + 1]
    raise AssertionError(f"unbalanced braces for {signature}")


UPDATE_FN_SIG = "void XAU_TrendMaturity_Update()"
GATE_FN_SIG = "bool XAU_TrendMaturity_NewCampaignAllowed(int signal, string grade, string &reason)"


# ---------------------------------------------------------------------------
# Isolation: production untouched
# ---------------------------------------------------------------------------

def test_production_still_byte_identical_to_backend_mirror():
    assert read(PROD) == read(BACKEND_PROD)


def test_engine_does_not_touch_signal_generation_grading_or_lot_sizing():
    exp = read(EXP)
    update_fn = body(exp, UPDATE_FN_SIG)
    # the update function must never call the entry/order pipeline directly
    for forbidden in ("OpenTrade(", "trade.Buy(", "trade.Sell(", "OrderSend("):
        assert forbidden not in update_fn


# ---------------------------------------------------------------------------
# 9-state lifecycle + confidence structure
# ---------------------------------------------------------------------------

def test_nine_lifecycle_states_present():
    exp = read(EXP)
    for state in ("TREND_STATE_EARLY", "TREND_STATE_DEVELOPING", "TREND_STATE_HEALTHY",
                  "TREND_STATE_MATURE", "TREND_STATE_LATE", "TREND_STATE_EXHAUSTION_RISK",
                  "TREND_STATE_TRANSITION", "TREND_STATE_EARLY_REVERSAL", "TREND_STATE_CONFIRMED_REVERSAL"):
        assert state in exp


def test_confidence_struct_has_all_five_required_fields():
    exp = read(EXP)
    struct = body(exp, "struct XAU_TrendMaturity")
    for field in ("maturityScore", "sellConfidence", "buyConfidence", "continuationConfidence", "reversalConfidence"):
        assert field in struct


def test_continuation_and_reversal_confidence_are_complementary():
    exp = read(EXP)
    fn = body(exp, UPDATE_FN_SIG)
    assert "g_trendMaturity.continuationConfidence = 100.0 - g_trendMaturity.reversalConfidence;" in fn


def test_sell_buy_confidence_derive_from_continuation_reversal_split():
    exp = read(EXP)
    fn = body(exp, UPDATE_FN_SIG)
    assert "g_trendMaturity.buyConfidence = g_trendMaturity.continuationConfidence;" in fn
    assert "g_trendMaturity.sellConfidence = g_trendMaturity.reversalConfidence;" in fn


# ---------------------------------------------------------------------------
# Direction tracking must be sticky, not circular
# ---------------------------------------------------------------------------

def test_direction_is_sticky_not_reset_by_every_htf_fluctuation():
    exp = read(EXP)
    fn = body(exp, UPDATE_FN_SIG)
    # the bootstrap-only assignment must be gated on direction==0 (first run),
    # not on "direction != g_htfConsensusDir" (which would be circular/reset
    # the lifecycle every time that global merely flickered)
    assert "if(g_trendMaturity.direction == 0 && g_htfConsensusDir != 0)" in fn
    assert "if(direction != g_trendMaturity.direction)" not in fn


def test_confirmed_reversal_requires_two_independent_structural_signals():
    exp = read(EXP)
    fn = body(exp, UPDATE_FN_SIG)
    assert "bool bosOpposed = (g_smc_bos_dir != 0 && g_smc_bos_dir == -direction);" in fn
    assert "bool htfConsensusOpposed = (g_htfConsensusDir != 0 && g_htfConsensusDir == -direction);" in fn
    assert "bool structurallyConfirmed = bosOpposed && htfConsensusOpposed;" in fn


def test_direction_flip_only_happens_inside_the_confirmed_reversal_branch():
    exp = read(EXP)
    fn = body(exp, UPDATE_FN_SIG)
    idx = fn.index("if(g_trendMaturity.state == TREND_STATE_CONFIRMED_REVERSAL")
    flip_block = fn[idx:idx + 900]
    assert "g_trendMaturity.direction = newDir;" in flip_block
    assert "int newDir = -g_trendMaturity.direction;" in flip_block
    # the confirmed state remains observable for one full closed-bar cycle
    assert "bar0 > g_trendMaturity.confirmedReversalBar" in flip_block


def test_update_runs_only_once_per_closed_bar():
    exp = read(EXP)
    fn = body(exp, UPDATE_FN_SIG)
    assert 'datetime bar0 = iTime(Symbol(), PERIOD_M5, 0);' in fn
    assert "if(bar0 == g_trendMaturity.lastUpdateBar) return;" in fn


# ---------------------------------------------------------------------------
# Reuses existing primitives -- does not duplicate indicators
# ---------------------------------------------------------------------------

def test_momentum_factor_reuses_clean_momentum_score_not_a_new_indicator():
    exp = read(EXP)
    fn = body(exp, "double XAU_Maturity_MomentumDecayFactor(int direction, int lookback, bool recentOnly)")
    assert "CleanMomentumScore(" in fn


def test_swing_factor_reuses_clean_structure_levels():
    exp = read(EXP)
    fn = body(exp, "double XAU_Maturity_SwingWeakeningFactor(int direction, double atr, int lookback)")
    assert "CleanStructureLevels(" in fn


def test_volatility_factor_reuses_the_shared_atr_handle_not_a_new_one():
    exp = read(EXP)
    fn = body(exp, "double XAU_Maturity_VolatilityRatio()")
    assert "CopyBuffer(hATR, 0, 1, 20, atrHist)" in fn
    assert "iATR(" not in fn


def test_engine_computes_at_least_eight_genuinely_distinct_factors():
    exp = read(EXP)
    for factor_fn in (
        "XAU_Maturity_DistanceFactor", "XAU_Maturity_DurationFactor", "XAU_Maturity_VelocityDecayFactor",
        "XAU_Maturity_MomentumDecayFactor", "XAU_Maturity_PullbackDepthFactor", "XAU_Maturity_ContinuationFailureFactor",
        "XAU_Maturity_SwingWeakeningFactor", "XAU_Maturity_AbsorptionFactor", "XAU_Maturity_VolatilityRatio",
    ):
        assert f"double {factor_fn}(" in exp, f"missing distinct factor: {factor_fn}"


# ---------------------------------------------------------------------------
# Campaign-creation gate: progressively stricter, never a blanket blocker
# ---------------------------------------------------------------------------

def test_opposite_direction_signal_never_gated_by_maturity():
    exp = read(EXP)
    fn = body(exp, GATE_FN_SIG)
    idx = fn.index("g_trendMaturity.direction != signal")
    window = fn[idx:idx + 60]
    assert "return true;" in window


def test_early_developing_healthy_mature_trends_not_additionally_restricted():
    exp = read(EXP)
    fn = body(exp, GATE_FN_SIG)
    switch_block = fn[fn.index("switch(g_trendMaturity.state)"):]
    default_idx = switch_block.index("default:")
    default_block = switch_block[default_idx:default_idx + 150]
    assert "break;" in default_block
    assert "allowed = false" not in default_block


def test_confirmed_reversal_is_a_hard_block_not_a_suggestion():
    exp = read(EXP)
    fn = body(exp, GATE_FN_SIG)
    idx = fn.index("case TREND_STATE_CONFIRMED_REVERSAL:")
    window = fn[idx:idx + 150]
    assert "allowed = false;" in window
    # unconditional -- no grade exception at CONFIRMED_REVERSAL
    assert "if(grade" not in window


def test_early_reversal_allows_a_plus_grade_through():
    exp = read(EXP)
    fn = body(exp, GATE_FN_SIG)
    idx = fn.index("case TREND_STATE_EARLY_REVERSAL:")
    window = fn[idx:idx + 150]
    assert 'if(grade != "A+")' in window


def test_gate_logs_every_evaluation_not_just_blocks():
    exp = read(EXP)
    fn = body(exp, GATE_FN_SIG)
    log_idx = fn.index("TREND_MATURITY_CAMPAIGN_GATE")
    assert log_idx > fn.index("switch(g_trendMaturity.state)")


def test_open_trade_calls_the_gate_before_any_order_send():
    exp = read(EXP)
    fn = body(exp, "bool OpenTrade(int signal, double atr, string reason, double sizeMulti, bool isManualOverride = false)")
    gate_idx = fn.index("XAU_TrendMaturity_NewCampaignAllowed(")
    send_idx = fn.index("trade.Buy(lots, Symbol(), 0, sl, tp,")
    assert gate_idx < send_idx


# ---------------------------------------------------------------------------
# Existing campaigns must never panic-exit on maturity alone
# ---------------------------------------------------------------------------

def test_maturity_is_only_one_vote_among_the_existing_hostile_factor_count():
    exp = read(EXP)
    fn = body(exp, "string XAU_Campaign_ClassifyMarket(int idx, bool isBuy, double close1, double open1, double close2,")
    assert "if(maturityHostile) hostileCount++;" in fn
    # must be alongside the other independent factors, not a separate branch
    # that can classify THESIS_DAMAGED/INVALIDATED by itself
    invalidated_idx = fn.index('classification = "THESIS_INVALIDATED"')
    window_before = fn[:invalidated_idx]
    assert "hostileCount >= InpCampaignHostileFactorsForInvalid" in window_before
    assert 'if(maturityHostile)\n      classification = "THESIS_INVALIDATED"' not in fn


def test_maturity_hostile_vote_requires_same_direction_as_the_campaign():
    exp = read(EXP)
    fn = body(exp, "string XAU_Campaign_ClassifyMarket(int idx, bool isBuy, double close1, double open1, double close2,")
    assert "g_trendMaturity.direction == g_campaign[idx].direction" in fn


def test_pyramid_hard_block_only_at_exhaustion_risk_and_above():
    exp = read(EXP)
    fn = body(exp, "void XAU_Campaign_EvaluatePyramid(int idx, bool isBuy, double curPrice, double atr,")
    assert "(double)g_trendMaturity.state >= InpMaturityPyramidBlockState) maturityBlocksAllAdds = true;" in fn
    assert "InpMaturityPyramidBlockState           = 5.0;" in read(EXP)  # 5 == EXHAUSTION_RISK ordinal


def test_pyramid_mature_trend_is_stricter_not_blocked():
    exp = read(EXP)
    fn = body(exp, "void XAU_Campaign_EvaluatePyramid(int idx, bool isBuy, double curPrice, double atr,")
    assert "maturityRequiresStricter" in fn
    assert "continuationConfirmed = continuationConfirmed && momentumScore >= 4;" in fn


def test_protection_tightening_is_additive_never_a_reduction():
    exp = read(EXP)
    fn = body(exp, "void XAU_Campaign_UpdateProtection(int idx, bool isBuy, double curPrice, double atr, int digits)")
    assert "effectiveSharePct = MathMin(95.0, InpCampaignAdaptivePeakSharePct + maturityTighteningPct);" in fn
    assert "maturityTighteningPct = (g_trendMaturity.maturityScore / 100.0) * InpMaturityProtectionTighteningMaxPct;" in fn


def test_protection_ratchet_still_applies_after_maturity_tightening():
    exp = read(EXP)
    fn = body(exp, "void XAU_Campaign_UpdateProtection(int idx, bool isBuy, double curPrice, double atr, int digits)")
    assert "newFloorR = MathMax(newFloorR, prevFloorR);" in fn


def test_post_reset_maturity_raises_the_bar_never_cancels_by_itself():
    exp = read(EXP)
    fn = body(exp, "void XAU_Campaign_PostResetEvaluate()")
    assert "maturityStillCautious" in fn
    approve_idx = fn.index('decision = "APPROVE";')
    approve_condition_start = fn.rindex("else if(", 0, approve_idx)
    condition = fn[approve_condition_start:approve_idx]
    assert "!maturityStillCautious" in condition
    # cancellation is driven only by hostileStructure, not maturity alone
    cancel_idx = fn.index('decision = "CANCEL";')
    cancel_condition_start = fn.rindex("if(", 0, cancel_idx)
    cancel_condition = fn[cancel_condition_start:cancel_idx]
    assert "maturityStillCautious" not in cancel_condition


# ---------------------------------------------------------------------------
# Config validation
# ---------------------------------------------------------------------------

def test_config_validation_requires_ascending_score_thresholds():
    exp = read(EXP)
    fn = body(exp, "bool XAU_ValidateMaturityConfig()")
    assert "InpMaturityScoreDevelopingThreshold >= InpMaturityScoreHealthyThreshold" in fn
    assert "InpMaturityScoreMatureThreshold >= InpMaturityScoreLateThreshold" in fn


def test_config_validation_requires_ascending_reversal_thresholds():
    exp = read(EXP)
    fn = body(exp, "bool XAU_ValidateMaturityConfig()")
    assert "InpMaturityExhaustionRiskThreshold >= InpMaturityTransitionThreshold" in fn
    assert "InpMaturityTransitionThreshold >= InpMaturityEarlyReversalThreshold" in fn


def test_config_validation_called_from_oninit():
    exp = read(EXP)
    assert "if(!XAU_ValidateMaturityConfig()) return INIT_PARAMETERS_INCORRECT;" in exp


def test_update_called_unconditionally_from_ontick():
    exp = read(EXP)
    update_idx = exp.index("XAU_TrendMaturity_Update();")
    core_idx = exp.index("XAU_RExitCoreLoop();", update_idx)
    gap = exp[update_idx:core_idx]
    assert gap.count("\n") < 10


# ---------------------------------------------------------------------------
# Master enable switch fully disables influence
# ---------------------------------------------------------------------------

def test_engine_disable_flag_short_circuits_the_campaign_gate():
    exp = read(EXP)
    fn = body(exp, GATE_FN_SIG)
    assert "if(!InpMaturityEngineEnable) return true;" in fn


def test_engine_disable_flag_short_circuits_the_update():
    exp = read(EXP)
    fn = body(exp, UPDATE_FN_SIG)
    assert "if(!InpMaturityEngineEnable) return;" in fn
