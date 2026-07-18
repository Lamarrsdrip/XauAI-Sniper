from pathlib import Path
import re

from scripts.owner_r_exit_policy_harness import (
    BREAKOUT_BLOCK,
    BREAKOUT_INVERSE,
    BREAKOUT_NORMAL,
    GENERAL,
    OWNER_CLOSE,
    TREND_UP,
    OwnerState,
    execution_direction,
    required_floor,
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


def test_trend_up_pretrigger_and_legacy_close_are_rejected():
    state = OwnerState(TREND_UP)
    assert state.observe(0.49) == 0.0
    assert not state.close_allowed(0.30, "SMART_EXIT")


def test_trend_up_first_floor_and_adaptive_floor():
    state = OwnerState(TREND_UP)
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


def test_pyramid_and_reentry_inherit_profile_and_active_floor():
    core = OwnerState(TREND_UP)
    core.observe(1.00)
    pyramid = core.inherited_leg()
    reentry = core.inherited_leg()
    assert pyramid.profile == reentry.profile == TREND_UP
    assert pyramid.floor_r == reentry.floor_r == 0.70


def test_floor_boundary_examples_match_owner_policy():
    assert required_floor(0.39, GENERAL) == 0.0
    assert required_floor(0.40, GENERAL) == 0.30
    assert required_floor(0.49, GENERAL) == 0.30
    assert required_floor(0.50, GENERAL) == 0.35
    assert abs(required_floor(0.80, GENERAL) - 0.56) < 1e-12
    assert required_floor(0.49, TREND_UP) == 0.0
    assert required_floor(0.50, TREND_UP) == 0.40
    assert required_floor(0.69, TREND_UP) == 0.40
    assert abs(required_floor(0.70, TREND_UP) - 0.49) < 1e-12
    assert required_floor(1.00, TREND_UP) == 0.70


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


def test_full_1r_no_broker_tp_and_restored_pyramid_50pct_margin_buffer():
    assert "g.effectiveHardStopDistance=g.finalOriginalRiskDistance" in EA.replace(" ", "")
    assert "trade.Buy(lots, Symbol(), 0, sl, 0.0" in EA
    assert "trade.Sell(lots, Symbol(), 0, sl, 0.0" in EA
    assert "FreeMargin()*0.50" in EA.replace(" ", "")
    assert "marginNeeded>accInfo.FreeMargin()" in EA.replace(" ", "")


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
    assert "#define XAU_BASKET_STATE_SCHEMA_VERSION 5" in EA
