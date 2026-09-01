from pathlib import Path
import re

from scripts.owner_r_exit_policy_harness import (
    BREAKOUT_BLOCK,
    BREAKOUT_INVERSE,
    BREAKOUT_NORMAL,
    BREAKOUT,
    GENERAL,
    PYRAMID,
    OWNER_CLOSE,
    OWNER_GIVEBACK_45,
    OWNER_RUNNER_FAILED,
    OWNER_TP_1R,
    OwnerState,
    exit_profile_for_regime,
    execution_direction,
    required_floor,
    strict_pyramid_gate,
)


ROOT = Path(__file__).resolve().parents[1]
EA = (ROOT / "XAUUSD_AI_Sniper_EA.mq5").read_text(encoding="utf-8")


def test_general_pretrigger_and_legacy_close_are_rejected():
    state = OwnerState(GENERAL)
    assert state.observe(0.39) == 0.0
    assert not state.close_allowed(0.20, "PROFIT_CLOSE")
    assert not state.close_allowed(0.20, "R_EXIT_GIVEBACK_45")


def test_general_first_floor_and_below_floor_close():
    state = OwnerState(GENERAL)
    assert state.observe(0.40) == 0.30
    assert not state.close_allowed(0.299, OWNER_CLOSE)
    assert state.close_allowed(0.30, OWNER_CLOSE)


def test_general_adaptive_floor_and_monotonic_pullback():
    state = OwnerState(GENERAL)
    assert abs(state.observe(0.80) - 0.56) < 1e-12
    assert abs(state.observe(0.60) - 0.56) < 1e-12
    assert not state.close_allowed(0.559, OWNER_CLOSE)


def test_trend_up_and_trend_dn_use_general_profile():
    for regime in ("TREND_UP", "TREND_DN"):
        profile = exit_profile_for_regime(regime)
        state = OwnerState(profile)
        assert profile == GENERAL
        assert state.observe(0.39) == 0.0
        assert state.observe(0.40) == 0.30
        assert abs(state.observe(0.50) - 0.35) < 1e-12


def test_breakout_first_floor_and_adaptive_floor():
    state = OwnerState(BREAKOUT)
    assert state.observe(0.50) == 0.40
    assert not state.close_allowed(0.399, OWNER_CLOSE)
    assert abs(state.observe(1.00) - 0.70) < 1e-12
    assert not state.close_allowed(0.699, OWNER_CLOSE)
    assert state.close_allowed(0.70, OWNER_CLOSE)


def test_restart_round_trip_preserves_peak_floor_and_profile():
    before = OwnerState(GENERAL)
    before.observe(0.80)
    after = before.restart()
    assert after == before
    assert abs(after.observe(0.50) - 0.56) < 1e-12


def test_reentry_inherits_profile_without_foreign_leg_geometry():
    core = OwnerState(BREAKOUT)
    core.observe(1.00)
    reentry = core.inherited_leg()
    assert reentry.profile == BREAKOUT
    assert reentry.peak_r == 0.0
    assert reentry.floor_r == 0.0


def test_pyramid_gets_its_own_dedicated_profile_not_the_cores():
    # v6.25.13: a pyramid leg no longer inherits the core campaign's
    # GENERAL/BREAKOUT profile -- it always gets its own PYRAMID profile,
    # with fresh peak/floor state, regardless of what the core's profile is.
    for core_profile in (GENERAL, BREAKOUT):
        core = OwnerState(core_profile)
        core.observe(1.00)
        pyramid = core.pyramid_leg()
        assert pyramid.profile == PYRAMID
        assert pyramid.profile != core_profile
        assert pyramid.peak_r == 0.0
        assert pyramid.floor_r == 0.0


def test_restored_r_manager_rules_are_guarded_by_any_active_owner_floor():
    pretrigger = OwnerState(GENERAL)
    pretrigger.observe(0.30)
    assert pretrigger.close_allowed(0.16, OWNER_GIVEBACK_45)
    assert not pretrigger.close_allowed(-0.01, OWNER_GIVEBACK_45)

    armed = OwnerState(GENERAL)
    armed.observe(0.50)
    assert not armed.close_allowed(0.34, OWNER_GIVEBACK_45)
    assert armed.close_allowed(0.35, OWNER_GIVEBACK_45)
    assert armed.close_allowed(1.00, OWNER_TP_1R)
    assert armed.close_allowed(0.35, OWNER_RUNNER_FAILED)
    assert not armed.close_allowed(0.34, OWNER_RUNNER_FAILED)


def test_floor_boundary_examples_match_owner_policy():
    assert required_floor(0.39, GENERAL) == 0.0
    assert required_floor(0.40, GENERAL) == 0.30
    assert required_floor(0.49, GENERAL) == 0.30
    assert required_floor(0.50, GENERAL) == 0.35
    assert abs(required_floor(0.80, GENERAL) - 0.56) < 1e-12
    assert required_floor(0.49, BREAKOUT) == 0.0
    assert required_floor(0.50, BREAKOUT) == 0.40
    assert required_floor(0.69, BREAKOUT) == 0.40
    assert abs(required_floor(0.70, BREAKOUT) - 0.49) < 1e-12
    assert required_floor(1.00, BREAKOUT) == 0.70


def test_only_one_raw_market_close_and_no_raw_partial_close():
    assert EA.count("trade.PositionClose(ticket)") == 1
    assert "bool OWNER_R_EXIT_CLOSE_ONLY(" in EA
    assert "trade.PositionClosePartial(" not in EA
    assert "TELEMETRY_ONLY_NO_PARTIALS" in EA


def test_legacy_safe_close_adapter_routes_only_to_owner_chokepoint():
    body = EA[EA.index("bool SafePositionClose(ulong ticket"):]
    body = body[: body.index("bool SafePositionClosePartial")]
    assert "OWNER_R_EXIT_CLOSE_ONLY(ticket, ctx, externalManual)" in body
    assert "trade.PositionClose" not in body


def test_owner_modify_guard_is_deny_by_default():
    body = EA[EA.index("bool SafeModifySL("):]
    body = body[: body.index("double XAU_AdaptiveProfitArmUSD")]
    for authority in ("OWNER_INITIAL_1R_HARD_STOP", "OWNER_PYRAMID_1R_HARD_STOP", "OWNER_R_EXIT_FLOOR"):
        assert authority in body
    assert "OWNER_R_EXIT_MODIFY_REJECTED_LEGACY_AUTHORITY" in body


def test_counter_is_compiled_off_and_default_off():
    assert "#define XAU_COUNTER_EXCURSION_BUILD false" in EA
    assert re.search(r"InpCounterExcursionMode\s*=\s*COUNTER_OFF", EA)
    assert "if(!XAU_COUNTER_EXCURSION_BUILD || InpCounterExcursionMode == COUNTER_OFF) return;" in EA
    assert "COUNTER_EXCURSION: enabled=false | mode=COUNTER_OFF" in EA


def test_breakouts_use_canonical_owner_mode_and_no_owner_time_blackout():
    assert "currentRegime == REGIME_BREAKOUT_UP || currentRegime == REGIME_BREAKOUT_DOWN" in EA
    assert "OWNER_BREAKOUT_EXECUTION_POLICY" in EA
    assert "BREAKOUT_REGIME_HARD_BLOCK" not in EA
    assert "OWNER_ENTRY_TIME_POLICY | blackout=NONE" in EA
    assert "OWNER_ENTRY_TIME_BLACKOUT" not in EA


def test_full_1r_core_has_no_broker_tp_pyramid_tp_restored_and_margin_buffer_preserved():
    assert "g.effectiveHardStopDistance=g.finalOriginalRiskDistance" in EA.replace(" ", "")
    assert "trade.Buy(lots, Symbol(), 0, sl, 0.0" in EA
    assert "trade.Sell(lots, Symbol(), 0, sl, 0.0" in EA
    assert 'trade.Buy(addLot,Symbol(),0,pyramidSL,pyramidTP,"XAU-SNIPER|"+why)' in EA
    assert 'trade.Sell(addLot,Symbol(),0,pyramidSL,pyramidTP,"XAU-SNIPER|"+why)' in EA
    assert "FreeMargin()*0.50" in EA.replace(" ", "")
    assert "marginNeeded>accInfo.FreeMargin()" in EA.replace(" ", "")
    assert "PYRAMID_GATE_REJECT | campaign_id=" in EA
    assert "PYRAMID_GATE_APPROVED | campaign_id=" in EA
    assert "core_position_id=" in EA
    assert "direction_ok=true | structure_ok=true | pressure_ok=true | timing_ok=true | location_ok=true | exhaustion_ok=true | margin_ok=true" in EA


def test_strategy_tester_executes_embedded_owner_policy_self_tests():
    assert "bool XAU_RunOwnerRExitSelfTests()" in EA
    assert "OWNER_R_EXIT_SELF_TEST_SUMMARY" in EA
    assert "MQLInfoInteger(MQL_TESTER)" in EA


def test_breakout_inverse_matrix_and_non_breakout_identity():
    for regime in ("BRKT_UP", "BRKT_DN"):
        assert execution_direction(1, regime, BREAKOUT_INVERSE) == -1
        assert execution_direction(-1, regime, BREAKOUT_INVERSE) == 1
        assert execution_direction(1, regime, BREAKOUT_NORMAL) == 1
        assert execution_direction(-1, regime, BREAKOUT_NORMAL) == -1
        assert execution_direction(1, regime, BREAKOUT_BLOCK) is None
    for regime, signal in (("TREND_UP", 1), ("TREND_DN", -1), ("CHOPPY", 1), ("RANGING", -1)):
        assert execution_direction(signal, regime, BREAKOUT_INVERSE) == signal


def test_inverse_is_one_final_normal_execution_mapping_not_counter_path():
    assert "bool XAU_ShouldInvertBreakoutExecution(" in EA
    assert "int XAU_ResolveOwnerBreakoutExecutionDirection(" in EA
    assert "OWNER_BREAKOUT_INVERSE_EXECUTION" in EA
    open_trade = EA[EA.index("bool OpenTrade("):EA.index("void LogExit(")]
    assert "XAU_ResolveOwnerBreakoutExecutionDirection" in open_trade
    assert "XAU_TryCounterExcursionEntry" not in open_trade
    assert "trade.SetExpertMagicNumber(InpCounterExcursionMagicNumber)" not in open_trade


def test_breakout_inversion_precedes_price_sl_risk_margin_and_order_geometry():
    open_trade = EA[EA.index("bool OpenTrade("):EA.index("void LogExit(")]
    mapping = open_trade.index("signal=executionDirection;")
    ordered_geometry_markers = (
        "double price, sl, tp, slDist;",
        "price = SymbolInfoDouble(Symbol(), SYMBOL_ASK);",
        "price = SymbolInfoDouble(Symbol(), SYMBOL_BID);",
        "XAU_ComputeStructuralSL(signal",
        "XAU_ComputeFinalRiskGeometry(rawSLDistance)",
        "RiskPerLotForDistance(slDist)",
        "OrderCalcMargin(signal == 1 ? ORDER_TYPE_BUY : ORDER_TYPE_SELL",
        "trade.Buy(lots, Symbol(), 0, sl, 0.0",
        "trade.Sell(lots, Symbol(), 0, sl, 0.0",
    )
    for marker in ordered_geometry_markers:
        assert mapping < open_trade.index(marker), marker


def test_breakout_profile_is_only_for_breakout_regimes():
    assert exit_profile_for_regime("BRKT_UP") == BREAKOUT
    assert exit_profile_for_regime("BRKT_DN") == BREAKOUT
    for regime in ("TREND_UP", "TREND_DN", "CHOPPY", "RANGING"):
        assert exit_profile_for_regime(regime) == GENERAL


def test_strict_pyramid_gate_rejects_each_required_condition_and_approves_all_pass():
    # v6.25.13: core_floor_confirmed is gone -- a pyramid no longer requires
    # the core's owner floor to already be armed. Only core_position_live
    # (the core must still be genuinely open) remains as that first check.
    base = dict(
        core_position_live=True,
        direction_ok=True,
        opposite_direction_present=False,
        structure_ok=True,
        pressure_ok=True,
        timing_ok=True,
        exhaustion_ok=True,
        margin_ok=True,
    )
    assert strict_pyramid_gate(**base) == (True, "PYRAMID_GATE_APPROVED")
    for field, expected_reason, value in (
        ("core_position_live", "CORE_POSITION_NOT_LIVE", False),
        ("direction_ok", "DIRECTION_NOT_CURRENTLY_APPROVED", False),
        ("opposite_direction_present", "OPPOSITE_DIRECTION_FORMING_OR_CONFIRMED", True),
        ("structure_ok", "STRUCTURE_OPPOSES", False),
        ("pressure_ok", "PRESSURE_OPPOSES", False),
        ("timing_ok", "TIMING_OR_LOCATION_LATE_CHASE", False),
        ("exhaustion_ok", "EXHAUSTION_HIGH_OR_EXTREME", False),
        ("margin_ok", "MARGIN_50_PERCENT_BUFFER", False),
    ):
        case = dict(base)
        case[field] = value
        approved, reason = strict_pyramid_gate(**case)
        assert not approved
        assert reason == expected_reason


def test_pyramid_no_longer_requires_armed_core_floor_before_evaluation():
    # Direct proof of the v6.25.12 -> v6.25.13 change: a pyramid opportunity
    # whose core has NOT yet armed its owner floor (the exact condition that
    # rejected ~94% of all evaluations in the 30/50-day replays) must now be
    # approvable as long as the core position is still live and every other
    # gate passes.
    case = dict(
        core_position_live=True,
        direction_ok=True,
        opposite_direction_present=False,
        structure_ok=True,
        pressure_ok=True,
        timing_ok=True,
        exhaustion_ok=True,
        margin_ok=True,
    )
    approved, reason = strict_pyramid_gate(**case)
    assert approved
    assert reason == "PYRAMID_GATE_APPROVED"


def test_inverse_geometry_uses_execution_side_not_original_signal_side():
    original_buy = 1
    execution_sell = execution_direction(original_buy, "BRKT_UP", BREAKOUT_INVERSE)
    assert execution_sell == -1
    bid, ask, structural_distance = 4000.0, 4000.2, 20.0
    execution_entry = ask if execution_sell == 1 else bid
    structural_sl = execution_entry - structural_distance if execution_sell == 1 else execution_entry + structural_distance
    assert execution_entry == bid
    assert structural_sl == 4020.0


def test_breakout_campaign_persists_original_and_execution_direction():
    assert "ownerOriginalSignalDirection" in EA
    assert "ownerBreakoutInversionApplied" in EA
    assert "OWNER_EXIT_PROFILE_INHERITED" in EA
    assert "OWNER_R_EXIT_FLOOR_INHERITED" not in EA
    assert "INHERITED_FROM_CAMPAIGN" not in EA
    assert "#define XAU_BASKET_STATE_SCHEMA_VERSION 6" in EA


def test_basket_telemetry_cannot_contaminate_surviving_leg_floor():
    conversion = EA[EA.index("string XAU_TryConvertBasketToSingleFloor("):]
    conversion = conversion[:conversion.index("void XAU_CampaignRegisterClose(")]
    assert 'return "TELEMETRY_ONLY_NO_FLOOR_TRANSFER";' in conversion
    assert ".guaranteedFloorR = convertedFloorROut" not in conversion
    assert ".profitGuaranteeArmed = true" not in conversion
    assert "KEEP_SURVIVOR_PER_LEG_OWNER_FLOOR" in EA


def test_below_floor_retry_evidence_is_rate_limited_without_disabling_retry():
    assert "lastBelowFloorRejectLog" in EA
    assert "TimeCurrent()-g_rExit[idx].lastBelowFloorRejectLog>=30" in EA
    assert "action=RETRY_BROKER_FLOOR" in EA


# ==========================================================================
# v6.25.13: default breakouts off, pyramid protection instead of armed-core
# floor requirement. See fix(ea): default breakouts off and protect pyramid
# profit.
# ==========================================================================


def test_breakout_input_defaults_to_block():
    assert re.search(
        r"input ENUM_XAU_OWNER_BREAKOUT_EXECUTION_MODE InpOwnerBreakoutExecutionMode\s*=\s*OWNER_BREAKOUT_BLOCK\s*;",
        EA,
    )


def test_brkt_up_and_brkt_dn_blocked_by_default_at_candidate_and_final_stage():
    for regime in ("BRKT_UP", "BRKT_DN"):
        assert execution_direction(1, regime, BREAKOUT_BLOCK) is None
        assert execution_direction(-1, regime, BREAKOUT_BLOCK) is None
    # Both real call-site stages exist and share the single owner authority.
    assert 'XAU_OwnerEntryPermission("CANDIDATE_ACCEPTANCE"' in EA
    assert 'XAU_OwnerEntryPermission("FINAL_EXECUTION"' in EA
    body = EA[EA.index("bool XAU_OwnerEntryPermission("):]
    body = body[: body.index("\n}\n", body.index("bool XAU_OwnerEntryPermission("))]
    assert "InpOwnerBreakoutExecutionMode==OWNER_BREAKOUT_BLOCK" in body
    assert "OWNER_BREAKOUT_BLOCKED | regime=%s | mode=BLOCK | default_off=true | stage=%s | reason=OWNER_BREAKOUT_DISABLED" in body


def test_no_bypass_path_reopens_breakout_block():
    # PRIMARY/RE_ENTRY, PYRAMID, and COUNTER_EXCURSION each call the exact
    # same single owner authority at both stages -- no path evaluates
    # currentRegime==BREAKOUT_UP/DOWN and opens a trade without going through
    # XAU_OwnerEntryPermission first.
    call_sites = re.findall(r'XAU_OwnerEntryPermission\("(CANDIDATE_ACCEPTANCE|FINAL_EXECUTION)"[^)]*"([A-Z_]+)"', EA)
    sources = {source for _, source in call_sites}
    assert {"PYRAMID", "COUNTER_EXCURSION"}.issubset(sources)
    stages = {stage for stage, _ in call_sites}
    assert stages == {"CANDIDATE_ACCEPTANCE", "FINAL_EXECUTION"}


def test_non_breakout_regimes_unaffected_by_breakout_block():
    for regime, signal in (("TREND_UP", 1), ("TREND_DN", -1), ("CHOPPY", 1), ("RANGING", -1)):
        assert execution_direction(signal, regime, BREAKOUT_BLOCK) == signal
        assert execution_direction(signal, regime, BREAKOUT_INVERSE) == signal
        assert execution_direction(signal, regime, BREAKOUT_NORMAL) == signal


def test_pyramid_gate_no_longer_references_armed_core_floor_strings():
    gate_body = EA[EA.index("void CheckPyramidOpportunity()"):]
    gate_body = gate_body[: gate_body.index("PYRAMID_GATE_APPROVED")]
    assert "profitGuaranteeArmed" not in gate_body
    assert "CORE_FLOOR_NOT_CONFIRMED" not in gate_body
    assert "CORE_POSITION_NOT_LIVE" in gate_body


def test_pyramid_leg_never_reads_campaign_profile_or_floor():
    registration = EA[EA.index("XAU_CampaignRegisterAdd(dir, \"PYRAMID\")"):]
    registration = registration[: registration.index("BotMonitorActivity(\"PYRAMID_ADD\"")]
    assert "(int)OWNER_EXIT_PYRAMID" in registration
    assert "g_campaign[XAU_CampaignSlot(dir)].ownerExitProfile" not in registration
    assert "g_rExit[idx].guaranteedFloorR =" not in registration
    assert "basketProtectedFloorMoney" not in registration


def test_pyramid_protection_floor_boundary_examples_match_owner_policy():
    assert required_floor(0.24, PYRAMID) == 0.0
    assert abs(required_floor(0.25, PYRAMID) - 0.20) < 1e-12
    assert abs(required_floor(0.30, PYRAMID) - 0.21) < 1e-12
    assert abs(required_floor(0.50, PYRAMID) - 0.35) < 1e-12
    assert abs(required_floor(0.70, PYRAMID) - 0.49) < 1e-12
    assert abs(required_floor(1.00, PYRAMID) - 0.70) < 1e-12


def test_pyramid_floor_is_monotonic_and_never_moves_backward():
    state = OwnerState(PYRAMID)
    assert state.observe(0.24) == 0.0
    assert abs(state.observe(0.30) - 0.21) < 1e-12
    # Price pulls back after the peak: peak_r and floor_r must not regress.
    floor_before = state.floor_r
    peak_before = state.peak_r
    state.observe(0.10)
    assert state.peak_r == peak_before
    assert state.floor_r == floor_before
    # A new higher peak ratchets forward again.
    assert abs(state.observe(1.00) - 0.70) < 1e-12


def test_pyramid_leg_uses_its_own_independent_r_geometry_not_the_cores():
    core = OwnerState(GENERAL)
    core.observe(1.00)
    pyramid = core.pyramid_leg()
    assert pyramid.peak_r == 0.0
    assert pyramid.floor_r == 0.0
    assert pyramid.profile == PYRAMID
    # The pyramid leg's own peak drives its own floor, independent of the
    # core's already-advanced peak/floor.
    assert abs(pyramid.observe(0.50) - 0.35) < 1e-12
    assert core.floor_r != pyramid.floor_r or core.profile != pyramid.profile


def test_pyramid_restart_round_trip_preserves_its_own_peak_and_floor():
    before = OwnerState(PYRAMID)
    before.observe(0.50)
    after = before.restart()
    assert after == before
    assert abs(after.observe(0.70) - 0.49) < 1e-12


def test_pyramid_protection_armed_and_confirmed_logs_are_broker_confirmation_gated():
    assert 'PYRAMID_PROTECTION_ARMED | position_id=' in EA
    assert 'source=PYRAMID_0.25R_70PCT_POLICY' in EA
    confirmed_line = EA.index("PYRAMID_FLOOR_CONFIRMED | position_id=")
    # Must sit inside the broker-confirmed branch, after the actual reread
    # comparison, never before it.
    preceding = EA[:confirmed_line]
    assert preceding.rindex("confirmed = MathAbs(actualSLAfterModify - guaranteedSL) <= tickTol;") < confirmed_line
    assert preceding.rindex("if(confirmed)") < confirmed_line


def test_canonical_and_backend_ea_sources_remain_byte_identical():
    backend = (ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5").read_text(encoding="utf-8")
    assert backend == EA


def test_no_duplicate_pyramid_or_exit_authority_introduced():
    assert EA.count("void CheckPyramidOpportunity()") == 1
    assert EA.count("void XAU_RExitCoreLoop(") == 1
    assert EA.count("double XAU_ComputeOwnerRequiredFloorR(") == 1
    assert EA.count("bool XAU_OwnerEntryPermission(") == 1
    assert EA.count("trade.PositionClose(ticket)") == 1
