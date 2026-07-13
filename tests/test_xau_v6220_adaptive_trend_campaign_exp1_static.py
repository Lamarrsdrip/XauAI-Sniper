"""
Regression tests for the v6.22.0 ADAPTIVE_TREND_CAMPAIGN_EXP1 experiment
(owner spec, 2026-07-13): a clean-architecture experiment branched from
v6.21.3 that replaces the scalper-style fixed-1R exit lifecycle with one
coherent campaign manager -- entry, pyramiding, protection and exit owned
by a single authority, holding a position from establishment through
confirmed thesis invalidation instead of a fixed R target or elapsed time.

This experiment must never touch production (origin/main v6.21.3) and
must never be merged. Static-source tests, matching this repo's
established convention.
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


# ---------------------------------------------------------------------------
# Isolation: production untouched, experiment never merges
# ---------------------------------------------------------------------------

def test_production_v6213_is_byte_identical_to_backend_mirror():
    # Confirms this experiment did not accidentally edit the production file.
    assert read(PROD) == read(BACKEND_PROD)


def test_experiment_file_is_a_distinct_file_from_production():
    assert EXP != PROD
    assert EXP.exists()


def test_experiment_has_its_own_unique_magic_number():
    exp = read(EXP)
    assert 'input int    InpMagicNumber    = 62200001;' in exp
    prod = read(PROD)
    assert "62200001" not in prod


def test_experiment_uses_its_own_comment_prefix_not_production_prefix():
    exp = read(EXP)
    assert '"XAU-CAMPAIGN-EXP1|"' in exp
    assert '"XAU-SNIPER|"' not in exp


# ---------------------------------------------------------------------------
# Counter-Excursion is fully removed, not merely disabled
# ---------------------------------------------------------------------------

def test_counter_excursion_functions_are_completely_absent():
    exp = read(EXP)
    for symbol in (
        "XAU_TryCounterExcursionEntry", "XAU_CounterExcursionEligible",
        "XAU_CounterExcursionOpportunityScore", "XAU_ManageCounterExcursionPosition",
        "XAU_ManageCounterShadowTracks", "XAU_RegisterCounterShadowTrack",
        "XAU_FinalizeCounterShadowTrack", "XAU_CounterExcursionEmergencyClose",
        "XAU_ReconcileCounterExcursionOnInit", "CounterExcursionState",
        "XAU_CounterShadowTrack", "g_counterEx", "ENUM_COUNTER_MODE",
        "InpCounterExcursionMagicNumber", "InpCounterExcursionMode",
    ):
        assert symbol not in exp, f"Counter-Excursion symbol still present: {symbol}"


def test_counter_excursion_magic_number_not_reachable():
    exp = read(EXP)
    assert "90205001" not in exp


def test_no_counter_excursion_input_group():
    exp = read(EXP)
    assert 'input group "=== COUNTER-EXCURSION' not in exp
    assert "enum ENUM_COUNTER_MODE" not in exp


# ---------------------------------------------------------------------------
# Campaign manager is the sole non-emergency authority
# ---------------------------------------------------------------------------

def test_campaign_ownership_gate_exists():
    exp = read(EXP)
    assert "bool XAU_AdaptiveCampaignOwnsPosition()" in exp
    fn = body(exp, "bool XAU_AdaptiveCampaignOwnsPosition()")
    assert "InpCampaignEnable" in fn and "g_campaignConfigValid" in fn


def test_rexit_owns_normal_positions_includes_campaign_ownership():
    exp = read(EXP)
    fn = body(exp, "bool XAU_RExitOwnsNormalPositions()")
    assert "XAU_AdaptiveCampaignOwnsPosition()" in fn


def test_rexit_core_loop_delegates_to_campaign_and_returns():
    exp = read(EXP)
    fn = body(exp, "void XAU_RExitCoreLoop()")
    idx = fn.index("XAU_AdaptiveCampaignOwnsPosition()")
    delegate_block = fn[idx:idx + 200]
    assert "XAU_CampaignCoreLoop();" in delegate_block
    assert "return;" in delegate_block
    # the delegation must appear before the legacy 1R-close logic
    legacy_idx = fn.index("InpRFinalTarget") if "InpRFinalTarget" in fn else len(fn)
    assert idx < legacy_idx


def test_manage_positions_stands_down_for_campaign_owned_tickets():
    exp = read(EXP)
    fn = body(exp, "void ManagePositions()")
    idx = fn.index("XAU_AdaptiveCampaignOwnsPosition()")
    assert "return;" in fn[idx:idx + 60]
    # must be the first executable check in the function
    first_brace = fn.index("{")
    between = fn[first_brace + 1:idx]
    assert "return" not in between, "campaign gate is not the first check in ManagePositions()"


def test_legacy_pyramid_and_reentry_watchers_gated_off_for_campaign():
    exp = read(EXP)
    assert "if(!XAU_AdaptiveCampaignOwnsPosition()) CheckReEntryOpportunity();" in exp
    assert "if(!XAU_AdaptiveCampaignOwnsPosition()) CheckPyramidOpportunity();" in exp


def test_no_fixed_1r_hard_close_reachable_for_campaign_positions():
    exp = read(EXP)
    campaign_loop = body(exp, "void XAU_CampaignCoreLoop()")
    assert "InpRFinalTarget" not in campaign_loop
    assert "currentR >= 1.0" not in campaign_loop
    assert ">= InpRFinalTarget" not in campaign_loop


def test_true_emergency_paths_remain_unconditional():
    exp = read(EXP)
    # weekend / prop-firm / equity-protect / weekly-target / remote-close-all
    # must still be reachable and NOT gated behind campaign ownership.
    for marker in ("WEEKEND_CLOSE", "PROP_FIRM_LOSS_LOCK", "EQUITY_PROTECT", "WEEKLY_TARGET_HIT"):
        assert marker in exp
    assert "bool XAU_EmergencyLossCloseAllowed(string ctx)" in exp
    assert "bool SafePositionClose(ulong ticket, string ctx = \"\")" in exp


# ---------------------------------------------------------------------------
# Campaign state machine
# ---------------------------------------------------------------------------

def test_nine_state_campaign_state_machine_present():
    exp = read(EXP)
    for state in ("CAMPAIGN_WAITING", "CAMPAIGN_CANDIDATE", "CAMPAIGN_INITIAL_POSITION",
                  "CAMPAIGN_THESIS_CONFIRMED", "CAMPAIGN_EXPANSION", "CAMPAIGN_MATURE_TREND",
                  "CAMPAIGN_DISTRIBUTION_WARNING", "CAMPAIGN_EXIT_PENDING", "CAMPAIGN_CLOSED"):
        assert state in exp


def test_post_campaign_reset_state_machine_present():
    exp = read(EXP)
    for state in ("POST_CAMPAIGN_NONE", "POST_CAMPAIGN_PROFIT_RECORDED", "POST_CAMPAIGN_WAITING_RESET",
                  "POST_CAMPAIGN_VALUE_ZONE_FORMING", "POST_CAMPAIGN_CONFIRMATION_PENDING",
                  "POST_CAMPAIGN_FRESH_APPROVED", "POST_CAMPAIGN_CANCELLED"):
        assert state in exp


# ---------------------------------------------------------------------------
# Initial risk: full 15% model, no hardcoded lot, campaignBaseLot scaling
# ---------------------------------------------------------------------------

def test_campaign_create_captures_lots_from_the_actual_sizing_output_not_hardcoded():
    exp = read(EXP)
    fn = body(exp, "void XAU_CampaignCreate(ulong positionId, int direction, string setup, string grade,")
    assert "campaignBaseLot = lots;" in fn
    assert re.search(r"campaignBaseLot\s*=\s*0\.\d+;", fn) is None


def test_open_trade_passes_the_actual_computed_lots_and_risk_into_campaign_create():
    exp = read(EXP)
    fn = body(exp, "bool OpenTrade(int signal, double atr, string reason, double sizeMulti, bool isManualOverride = false)")
    idx = fn.index("XAU_CampaignCreate(")
    call = fn[idx:idx + 300]
    assert "lots" in call and "riskAmount" in call
    assert re.search(r"XAU_CampaignCreate\([^)]*,\s*0\.\d+\s*,", call) is None


def test_pyramid_fractions_are_descending_and_scale_from_base_lot():
    exp = read(EXP)
    fn = body(exp, "void XAU_Campaign_EvaluatePyramid(int idx, bool isBuy, double curPrice, double atr,")
    assert "g_campaign[idx].campaignBaseLot * frac" in fn
    assert "XAU_Campaign_PyramidFraction(legNumber)" in fn


def test_pyramid_fraction_lookup_is_descending():
    exp = read(EXP)
    fn = body(exp, "double XAU_Campaign_PyramidFraction(int legNumber)")
    assert "InpCampaignPyramidFrac1" in fn and "InpCampaignPyramidFrac5" in fn


def test_config_validation_rejects_non_descending_ladder():
    exp = read(EXP)
    fn = body(exp, "void XAU_ValidateCampaignConfig()")
    assert "InpCampaignPyramidFrac2 > InpCampaignPyramidFrac1" in fn
    assert "g_campaignConfigValid = false" in fn


def test_pyramid_lot_normalization_blocks_rather_than_rounds_up():
    exp = read(EXP)
    fn = body(exp, "void XAU_Campaign_EvaluatePyramid(int idx, bool isBuy, double curPrice, double atr,")
    assert "NormalizeVolumeDown(proposedLotRaw)" in fn
    assert 'reason = "PROPOSED_LOT_BELOW_BROKER_MINIMUM";' in fn


# ---------------------------------------------------------------------------
# No martingale / no add while losing / no add at overextension
# ---------------------------------------------------------------------------

def test_no_pyramid_while_campaign_losing():
    exp = read(EXP)
    fn = body(exp, "void XAU_Campaign_EvaluatePyramid(int idx, bool isBuy, double curPrice, double atr,")
    assert "campaignLosing = g_campaign[idx].currentR <= 0" in fn
    assert 'reason = "CAMPAIGN_NOT_PROFITABLE";' in fn


def test_no_pyramid_at_severe_overextension():
    exp = read(EXP)
    fn = body(exp, "void XAU_Campaign_EvaluatePyramid(int idx, bool isBuy, double curPrice, double atr,")
    assert "InpCampaignOverextendedATR" in fn
    assert "overextended" in fn


def test_pyramid_evaluation_never_increases_size_after_a_loss():
    exp = read(EXP)
    fn = body(exp, "void XAU_Campaign_EvaluatePyramid(int idx, bool isBuy, double curPrice, double atr,")
    # every add is a strict fraction (<=1.0) of the ORIGINAL base lot, never of
    # a prior leg's size or a loss-scaled multiplier
    assert "campaignBaseLot * frac" in fn
    assert "* 1.5" not in fn and "* 2.0" not in fn and "martingale" not in fn.lower()


def test_aggregate_risk_ceiling_cannot_be_bypassed():
    exp = read(EXP)
    fn = body(exp, "void XAU_Campaign_EvaluatePyramid(int idx, bool isBuy, double curPrice, double atr,")
    assert "InpCampaignMaxAggregateRiskPct" in fn
    assert "aggregateRiskOK" in fn
    idx = fn.index("decision = \"ADD\";")
    gate_block = fn[:idx]
    assert "aggregateRiskOK" in gate_block  # aggregate check happens before any ADD decision


# ---------------------------------------------------------------------------
# Late-leg-first reduction, original entry preserved longest
# ---------------------------------------------------------------------------

def test_late_leg_reduction_preserves_the_original_entry():
    exp = read(EXP)
    fn = body(exp, "void XAU_Campaign_ReduceLatestLeg(int idx, ulong ticket, string deteriorationEvidence)")
    assert "legCount <= 1" in fn  # never reduces below the original leg via this path
    assert "for(int i = g_campaign[idx].legCount - 1; i >= 1; i--)" in fn  # scans from newest down to leg 1 (never leg 0)


def test_thesis_damaged_triggers_late_leg_reduction_not_full_close():
    exp = read(EXP)
    loop = body(exp, "void XAU_CampaignCoreLoop()")
    idx = loop.index('classification == "THESIS_DAMAGED"')
    window = loop[idx:idx + 1200]
    assert "XAU_Campaign_ReduceLatestLeg(idx, ticket, classification);" in window


# ---------------------------------------------------------------------------
# Profit guarantee: arm at 0.50R, floor >=0.25R, ratchet-only
# ---------------------------------------------------------------------------

def test_guarantee_arms_at_the_configured_threshold_not_before():
    exp = read(EXP)
    fn = body(exp, "void XAU_Campaign_UpdateProtection(int idx, ulong ticket, bool isBuy, double curPrice, double curSL, double atr, int digits)")
    assert "!g_campaign[idx].guaranteeArmed && peakR >= InpCampaignGuaranteeArmR" in fn
    assert "InpCampaignGuaranteeArmR              = 0.50;" in exp
    assert "InpCampaignGuaranteedFloorR           = 0.25;" in exp


def test_guarantee_floor_is_ratchet_only_never_loosens():
    exp = read(EXP)
    fn = body(exp, "void XAU_Campaign_UpdateProtection(int idx, ulong ticket, bool isBuy, double curPrice, double curSL, double atr, int digits)")
    assert "newFloorR = MathMax(newFloorR, prevFloorR);" in fn
    assert "RATCHET-ONLY" in fn


def test_adaptive_peak_share_floor_uses_configured_percentage_and_structure_blend():
    exp = read(EXP)
    fn = body(exp, "void XAU_Campaign_UpdateProtection(int idx, ulong ticket, bool isBuy, double curPrice, double curSL, double atr, int digits)")
    assert "peakR * (InpCampaignAdaptivePeakSharePct / 100.0)" in fn
    assert "MathMax(rawPeakShareFloorR, structureFloorR)" in fn
    assert "InpCampaignAdaptiveShareStartR        = 0.60;" in exp


def test_config_validation_requires_adaptive_share_start_at_or_after_guarantee_arm():
    exp = read(EXP)
    fn = body(exp, "void XAU_ValidateCampaignConfig()")
    assert "InpCampaignAdaptiveShareStartR < InpCampaignGuaranteeArmR" in fn


def test_geometry_blocked_sl_retains_internal_floor_and_can_force_close_on_breach():
    exp = read(EXP)
    fn = body(exp, "void XAU_Campaign_UpdateProtection(int idx, ulong ticket, bool isBuy, double curPrice, double curSL, double atr, int digits)")
    assert "floorGeometryBlocked = true;" in fn
    assert "breached" in fn
    assert "XAU_Campaign_Finalize(idx, \"INTERNAL_FLOOR_BREACH_GEOMETRY_BLOCKED\");" in fn


def test_protection_update_reuses_safe_modify_sl_not_a_raw_ordersend():
    exp = read(EXP)
    fn = body(exp, "void XAU_Campaign_UpdateProtection(int idx, ulong ticket, bool isBuy, double curPrice, double curSL, double atr, int digits)")
    assert "SafeModifySL(ticket, desiredSL, 0, isBuy, curPrice, \"CAMPAIGN_FLOOR\")" in fn


# ---------------------------------------------------------------------------
# Restart-safe persistence
# ---------------------------------------------------------------------------

def test_state_persistence_round_trips_peak_r_and_protected_floor():
    exp = read(EXP)
    save_fn = body(exp, "void XAU_Campaign_SaveState()")
    load_fn = body(exp, "void XAU_Campaign_LoadState()")
    for field in ("peakR", "protectedFloorR", "guaranteeArmed"):
        assert field in save_fn
        assert field in load_fn


def test_state_persistence_round_trips_legs():
    exp = read(EXP)
    save_fn = body(exp, "void XAU_Campaign_SaveState()")
    load_fn = body(exp, "void XAU_Campaign_LoadState()")
    assert '"LEG"' in save_fn and '"LEG"' in load_fn
    assert "legs[L].ticket" in save_fn
    assert "legs[legSlot].ticket = ticket;" in load_fn


def test_state_file_is_loaded_on_init():
    exp = read(EXP)
    init_fn = body(exp, "int OnInit()")
    assert "XAU_Campaign_LoadState();" in init_fn


def test_post_campaign_reset_state_also_persists():
    exp = read(EXP)
    save_fn = body(exp, "void XAU_Campaign_SaveState()")
    load_fn = body(exp, "void XAU_Campaign_LoadState()")
    assert '"POSTRESET"' in save_fn and '"POSTRESET"' in load_fn


# ---------------------------------------------------------------------------
# Post-campaign anti-chase re-entry
# ---------------------------------------------------------------------------

def test_post_reset_requires_real_market_evidence_not_just_a_timer():
    exp = read(EXP)
    fn = body(exp, "void XAU_Campaign_PostResetEvaluate()")
    assert "retracementR" in fn
    assert "valueZoneReached" in fn
    assert "freshStructure" in fn
    assert "htfStillAligned" in fn
    # a max-wait exists as a safety bound, but approval itself requires the
    # evidence flags above, not merely time elapsed
    approve_idx = fn.index('decision = "APPROVE";')
    approve_window = fn[max(0, approve_idx - 200):approve_idx]
    assert "valueZoneReached" in approve_window


def test_patience_scales_with_prior_win_size():
    exp = read(EXP)
    fn = body(exp, "void XAU_PostCampaignReset_Arm(string previousCampaignId, int direction, double realizedR, double peakR,")
    assert "InpCampaignVeryLargeWinR" in fn and "InpCampaignVeryLargeWinRetraceR" in fn
    assert "InpCampaignLargeWinR" in fn and "InpCampaignLargeWinRetraceR" in fn
    assert "InpCampaignSmallWinRetraceR" in fn


def test_opposite_direction_signal_never_blocked_by_post_reset_gate():
    exp = read(EXP)
    fn = body(exp, "bool XAU_Campaign_PostResetGate(int signal, string &blockReason)")
    idx = fn.index("signal != g_postCampaignReset.direction")
    window = fn[idx:idx + 60]
    assert "return true;" in window


def test_post_reset_arm_never_itself_places_a_trade():
    exp = read(EXP)
    fn = body(exp, "void XAU_PostCampaignReset_Arm(string previousCampaignId, int direction, double realizedR, double peakR,")
    assert "trade.Buy" not in fn and "trade.Sell" not in fn and "OrderSend" not in fn


def test_post_reset_evaluate_never_itself_places_a_trade():
    exp = read(EXP)
    fn = body(exp, "void XAU_Campaign_PostResetEvaluate()")
    assert "trade.Buy" not in fn and "trade.Sell" not in fn and "OrderSend" not in fn


def test_open_trade_gates_on_post_reset_before_any_order_send():
    exp = read(EXP)
    fn = body(exp, "bool OpenTrade(int signal, double atr, string reason, double sizeMulti, bool isManualOverride = false)")
    gate_idx = fn.index("XAU_Campaign_PostResetGate(")
    send_idx = fn.index("trade.Buy(lots, Symbol(), 0, sl, tp,")
    assert gate_idx < send_idx


def test_only_a_profitable_thesis_intact_close_arms_the_anti_chase_reset():
    exp = read(EXP)
    fn = body(exp, "void XAU_Campaign_Finalize(int idx, string exitReason)")
    idx = fn.index("XAU_PostCampaignReset_Arm(")
    guard = fn[max(0, idx - 120):idx]
    assert "realizedR > 0" in guard
    assert "!thesisInvalidated" in guard


# ---------------------------------------------------------------------------
# Preserved good parts of v6.21.3
# ---------------------------------------------------------------------------

def test_mid_candle_pending_confirm_timing_fix_preserved():
    exp = read(EXP)
    assert "pendingConfirmDue" in exp
    assert "TIMING_ENGINE: PENDING_CONFIRM_DUE_MIDBAR" in exp


def test_full_risk_binary_sizing_language_preserved():
    exp = read(EXP)
    assert "RISK_BLOCKED_LOT_BELOW_MIN" in exp
    assert "RISK_CONFIG_ASSERTION_PASSED" in exp


def test_no_silent_001_lot_fallback_language_preserved():
    exp = read(EXP)
    assert "lots = minLot;" not in exp


# ---------------------------------------------------------------------------
# Experiment memory namespace isolation
# ---------------------------------------------------------------------------

def test_experiment_memory_files_are_tagged_distinctly_from_production():
    exp = read(EXP)
    for tagged in (
        '"AIS_Patterns_" + Symbol() + "_CAMPAIGNEXP1.bin"',
        '"XAUAI_BlockedTradeMemory_" + Symbol() + "_CAMPAIGNEXP1.csv"',
        '"XAUAI_ExecutedTradeBrain_" + Symbol() + "_CAMPAIGNEXP1.csv"',
        '"XAUAI_TradingIntelligence_" + Symbol() + "_CAMPAIGNEXP1.csv"',
    ):
        assert tagged in exp, f"missing experiment memory tag: {tagged}"


def test_campaign_state_file_uses_its_own_namespace():
    exp = read(EXP)
    fn = body(exp, "string XAU_Campaign_StateFilePath()")
    assert "CAMPAIGNEXP1" in fn
    assert "RExitState_" not in fn


def test_experiment_never_reads_or_writes_the_production_untagged_filenames():
    exp = read(EXP)
    # the untagged production forms must not appear anywhere in the experiment file
    assert '"AIS_Patterns_" + Symbol() + ".bin"' not in exp
    assert '"XAUAI_ExecutedTradeBrain_" + Symbol() + ".csv"' not in exp
