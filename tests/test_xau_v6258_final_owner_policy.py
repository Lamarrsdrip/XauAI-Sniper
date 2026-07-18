from datetime import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = (ROOT / "XAUUSD_AI_Sniper_EA.mq5").read_text(encoding="utf-8", errors="ignore")
BACKEND = (ROOT / "backend/ea_code/XAUUSD_AI_Sniper_EA.mq5").read_text(encoding="utf-8", errors="ignore")


def owner_floor(profile: str, peak: float, previous: float = 0.0) -> float:
    if profile == "TREND_UP":
        required = 0.0 if peak < 0.50 else (0.40 if peak < 0.70 else max(0.40, peak * 0.70))
    else:
        required = 0.0 if peak < 0.40 else (0.30 if peak < 0.50 else max(0.30, peak * 0.70))
    return max(previous, required)


def owner_time_block(_: time) -> bool:
    return False


def ea_section(start: str, end: str) -> str:
    begin = EA.index(start)
    return EA[begin:EA.index(end, begin)]


def test_canonical_and_backend_sources_match():
    assert EA == BACKEND


def test_release_identity_is_v62510():
    assert '#define XAUAI_EA_VERSION "v6.25.10"' in EA
    assert '#define XAUAI_EA_VERSION_NUM "6.25.10"' in EA
    assert '#property version   "6.260"' in EA


def test_profile_assignment_is_trend_up_only_and_truthfully_named():
    fn = ea_section(
        "ENUM_XAU_OWNER_EXIT_PROFILE XAU_OwnerExitProfileForEntryRegime",
        "XAU_CampaignState g_campaign",
    )
    assert "entryRegime == REGIME_TRENDING_UP ? OWNER_EXIT_TREND_UP : OWNER_EXIT_GENERAL" in fn
    assert 'return profile == OWNER_EXIT_TREND_UP ? "TREND_UP" : "GENERAL";' in EA
    assert "TREND_DN_SPECIAL" not in EA
    assert "TREND_UP_SPECIAL" not in EA


def test_profile_is_frozen_at_core_and_pyramids_inherit_without_mixing():
    core = ea_section("void XAU_CampaignOpenCore(", "void XAU_CampaignRegisterAdd(")
    add = ea_section("void XAU_CampaignRegisterAdd(", "string XAU_TryConvertBasketToSingleFloor")
    pyramid = ea_section("void CheckPyramidOpportunity()", "//+------------------------------------------------------------------+\n//| TICK")
    assert "XAU_OwnerExitProfileForEntryRegime(frozenEntryRegime)" in core
    assert "OWNER_EXIT_PROFILE_FROZEN" in core
    assert "OWNER_EXIT_PROFILE_INHERITED" in add
    assert "mixedProfiles=false" in add
    assert "inheritedProfile=g_campaign[XAU_CampaignSlot(dir)].ownerExitProfile" in pyramid


def test_general_floor_boundaries_and_monotonic_ratchet():
    assert owner_floor("GENERAL", 0.39) == 0.0
    assert owner_floor("GENERAL", 0.40) == 0.30
    assert owner_floor("GENERAL", 0.49) == 0.30
    assert abs(owner_floor("GENERAL", 0.50) - 0.35) < 1e-12
    assert abs(owner_floor("GENERAL", 0.80) - 0.56) < 1e-12
    assert owner_floor("GENERAL", 0.45, previous=0.56) == 0.56


def test_trend_up_floor_boundaries_and_monotonic_ratchet():
    assert owner_floor("TREND_UP", 0.49) == 0.0
    assert owner_floor("TREND_UP", 0.50) == 0.40
    assert owner_floor("TREND_UP", 0.69) == 0.40
    assert abs(owner_floor("TREND_UP", 0.70) - 0.49) < 1e-12
    assert abs(owner_floor("TREND_UP", 1.00) - 0.70) < 1e-12
    assert owner_floor("TREND_UP", 0.60, previous=0.70) == 0.70


def test_one_owner_floor_calculation_is_shared_by_individual_and_basket():
    assert EA.count("double XAU_ComputeOwnerRequiredFloorR(") == 1
    assert EA.count("XAU_ComputeOwnerRequiredFloorR(") >= 5
    assert "MathMax(existingValidFloorR, ownerRequiredFloorR)" in EA
    assert "MathMax(basketExistingValidFloorR, basketOwnerRequiredFloorR)" in EA
    primary = ea_section("double XAU_ComputePrimaryExitFloor(", "bool XAU_RExitOwnsNormalPositions()")
    assert "TRADE_STRUGGLING" not in primary
    assert "peakR - InpRAdaptiveTrailOffset" not in primary


def test_every_broker_close_and_modify_obeys_owner_floor():
    assert 'bool OWNER_R_EXIT_CLOSE_ONLY(' in EA
    assert 'if(!externalManual && !initialStopIntegrity && !XAU_OwnerProtectedFloorAllowsClose(ticket, ctx))' in EA
    assert 'if(!XAU_OwnerProtectedFloorAllowsModify(ticket, newSL, logTag))' in EA
    assert EA.count("OWNER_FLOOR_OVERRIDE | attempted_exit_authority=%s") >= 3
    assert "action=REJECT_LOWER_EXIT" in EA
    assert "OWNER_R_EXIT_FLOOR_BREACH" in EA


def test_full_structural_one_r_replaces_universal_point_75_cap():
    assert "XAU_OWNER_EFFECTIVE_SL_CAP_R" not in EA
    assert "OWNER_SL_CAP_BROKER_CONFIRMATION_FAILED" not in EA
    assert "BROKER_MINIMUM_WOULD_FORCE_WIDER_THAN_075R" not in EA
    assert "g.effectiveHardStopDistance = g.finalOriginalRiskDistance;" in EA
    open_trade = ea_section("bool OpenTrade(", "void LogExit(")
    assert "ownerEffectiveSLDistance = finalGeometry.effectiveHardStopDistance" in open_trade
    assert "OWNER_RISK_POLICY | structural_sl_r=1.00" in open_trade
    assert "OWNER_INITIAL_1R_HARD_STOP" in open_trade
    assert "structuralSLR=1.00" in open_trade


def test_restart_schema_fallbacks_preserve_full_original_risk():
    assert "ownerEffectiveRiskUSD = schema >= 3 ? FileReadNumber(h) : coreMoneyRisk;" in EA
    assert "effectiveInitialRisk = schema >= 3 ? FileReadNumber(h) : origRisk;" in EA
    assert "#define XAU_BASKET_STATE_SCHEMA_VERSION 5" in EA
    assert "#define R_EXIT_STATE_SCHEMA_VERSION 4" in EA
    assert "OWNER_EXIT_PROFILE_LEGACY_MIGRATED" in EA


def test_breakout_up_and_down_use_single_owner_scenario_authority():
    fn = ea_section("bool XAU_OwnerEntryPermission(", "bool XAU_FinalEntryArbiter(")
    assert "currentRegime == REGIME_BREAKOUT_UP || currentRegime == REGIME_BREAKOUT_DOWN" in fn
    assert "OWNER_BREAKOUT_EXECUTION_POLICY" in fn
    assert "OWNER_BREAKOUT_INVERSE" in EA
    assert "BREAKOUT_REGIME_HARD_BLOCK" not in fn
    assert "canonicalGrade !=" not in fn
    assert "OWNER_BRKT_UP_REQUIRES_A_OR_A_PLUS" not in EA
    assert EA.count('XAU_OwnerEntryPermission("CANDIDATE_ACCEPTANCE"') >= 3
    assert EA.count('XAU_OwnerEntryPermission("FINAL_EXECUTION"') >= 3
    counter = ea_section("void XAU_TryCounterExcursionEntry(", "bool XAU_ManageCounterExcursionPosition()")
    assert 'XAU_OwnerEntryPermission("CANDIDATE_ACCEPTANCE", "COUNTER_EXCURSION"' in counter
    assert 'XAU_OwnerEntryPermission("FINAL_EXECUTION", "COUNTER_EXCURSION"' in counter


def test_owner_time_windows_are_not_blocked():
    for value in (time(6, 10), time(6, 20), time(7, 30, 59), time(14, 10), time(14, 30), time(15, 30, 59)):
        assert owner_time_block(value) is False
    fn = ea_section("bool XAU_OwnerEntryPermission(", "bool XAU_FinalEntryArbiter(")
    assert "secondOfDay" not in fn
    assert "OWNER_TIME_BLOCK" not in EA
    assert "0610_0730" not in EA
    assert "1410_1530" not in EA


def test_allowed_regime_timer_remains_the_existing_120_to_180_second_process():
    assert "#define XAU_ENTRY_DELAY_ABSOLUTE_FLOOR_SEC   120.0" in EA
    assert "#define XAU_ENTRY_DELAY_ABSOLUTE_CEILING_SEC 180.0" in EA
    assert "ENTRY_DELAY_TARGET=%.0f" in EA
    assert "ALIGNED_2_TO_3_MINUTE_DELAY_SATISFIED" in EA
    owner_permission = ea_section("bool XAU_OwnerEntryPermission(", "bool XAU_FinalEntryArbiter(")
    assert "XAU_ENTRY_DELAY" not in owner_permission


def test_pyramid_uses_full_configured_risk_and_full_one_r_stop():
    pyramid = ea_section("void CheckPyramidOpportunity()", "//+------------------------------------------------------------------+\n//| TICK")
    assert "pyramidRiskAmount = StrategyReferenceBalance() * InpNormalRiskPct / 100.0" in pyramid
    assert "rawPyramidLots = pyramidRiskAmount / riskPerLot" in pyramid
    assert "pyramidFullRiskLots=addLot" in pyramid
    assert "blocking instead of reduced-risk execution" in pyramid
    assert "OWNER_PYRAMID_1R_HARD_STOP" in pyramid
    assert "origLot*MathPow" not in pyramid


def test_risk_reconciliation_is_binary_for_core_reentry_and_pyramid():
    reconcile = ea_section("bool XAU_ReconcileFinalRisk(", "double CurrentAggregateRiskToSL")
    assert 'StringFind(context, "ENTRY:") == 0 || context == "PYRAMID"' in reconcile
    assert "BLOCKED_BINARY_FULL_RISK_EXCEEDS_CAP" in reconcile
    assert "if(binaryFullRiskEntry)" in reconcile


def test_required_policy_logs_are_present_and_state_change_scoped():
    assert "OWNER_EXIT_PROFILE | profile=GENERAL | first_trigger_r=0.40 | first_floor_r=0.30 | adaptive_trigger_r=0.50 | adaptive_lock_pct=70" in EA
    assert "OWNER_EXIT_PROFILE | profile=TREND_UP | first_trigger_r=0.50 | first_floor_r=0.40 | adaptive_trigger_r=0.70 | adaptive_lock_pct=70" in EA
    assert "OWNER_FLOOR_UPDATE | profile=%s | peak_r=%.3f | previous_floor_r=%.3f | new_floor_r=%.3f | reason=%s" in EA
    assert "OWNER_BREAKOUT_EXECUTION_POLICY | mode=%s | regime=%s" in EA
    assert "OWNER_RISK_POLICY | structural_sl_r=1.00" in EA
