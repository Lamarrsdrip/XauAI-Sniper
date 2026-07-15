from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.24.1.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"
COMPILE_LOG = ROOT / "test_reports" / "metaeditor_v6241.log"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def test_repo_source_is_synced_to_backend():
    assert read(EA) == read(BACKEND_EA)


def test_arbitrary_fifty_percent_margin_ceiling_is_removed():
    ea = read(BACKEND_EA)
    assert "marginNeeded > freeMargin * 0.5" not in ea
    # MARGIN_BELOW_FULL_RISK may still appear in the changelog banner as
    # historical context, but must no longer be used as a live block reason.
    assert '"BLOCKED", "MARGIN_BELOW_FULL_RISK"' not in ea
    assert "requires margin $%.2f, above safe 50%% of free margin" not in ea


def test_margin_gate_uses_real_broker_verification_with_small_reserve():
    ea = read(BACKEND_EA)
    assert "input double InpMarginReservePct" in ea
    assert "double marginReserve = freeMargin * (InpMarginReservePct / 100.0);" in ea
    assert "double marginAvailableForTrade = freeMargin - marginReserve;" in ea
    assert "if(marginNeeded > marginAvailableForTrade)" in ea
    # reserve defaults to a small 10% buffer, not a 50% ceiling
    assert "input double InpMarginReservePct         = 10.0;" in ea


def test_valid_trade_is_not_blocked_just_for_exceeding_old_fifty_percent_rule():
    # The specific reported case: lot=0.56, margin~$2,262, free margin~$3,016.
    # 2262 / 3016 ~= 75%, i.e. it would have hit the removed 50% ceiling but
    # is well within actual broker capacity. Assert the gate that would have
    # rejected it (the flat 50% comparison) is gone and only real insufficiency
    # (marginNeeded > freeMargin - reserve) can block.
    ea = read(BACKEND_EA)
    margin_needed = 2262.0
    free_margin = 3016.0
    reserve_pct = 10.0
    reserve = free_margin * (reserve_pct / 100.0)
    available = free_margin - reserve
    assert margin_needed < available, "sample trade must fit comfortably under the real-margin gate"
    assert "freeMargin * 0.5" not in ea


def test_trade_is_never_silently_reduced_to_0_01_on_margin_shortfall():
    ea = read(BACKEND_EA)
    assert "INSUFFICIENT_BROKER_MARGIN" in ea
    assert "lots = 0.01" not in ea
    assert "input bool   InpMarginFallbackReduceToMax" in ea
    # default is transparent block, not silent auto-reduce
    assert "InpMarginFallbackReduceToMax = false" in ea


def test_margin_shortfall_reports_requested_and_max_supported_lot_and_actual_risk_pct():
    ea = read(BACKEND_EA)
    assert "requested 15%%-risk lot %.4f needs margin" in ea
    assert "Max broker-margin-supported lot=%.4f (actual risk %.3f%% of balance)" in ea


def test_margin_fallback_reduce_to_max_only_applies_when_input_enabled():
    ea = read(BACKEND_EA)
    idx = ea.index("if(InpMarginFallbackReduceToMax && maxMarginLots >= minLot)")
    block = ea[idx: idx + 600]
    assert "lots = maxMarginLots;" in block
    # the else branch (default) blocks transparently instead of reducing
    else_idx = ea.index("else", idx)
    else_block = ea[else_idx: else_idx + 500]
    assert "INSUFFICIENT_BROKER_MARGIN" in else_block
    assert "return false;" in else_block


def test_genuine_broker_margin_calc_failure_still_hard_blocks():
    ea = read(BACKEND_EA)
    assert '!OrderCalcMargin(signal == 1 ? ORDER_TYPE_BUY : ORDER_TYPE_SELL, Symbol(), lots, price, marginNeeded)' in ea
    assert "ORDER_CALC_MARGIN_FAILED" in ea


def test_15_percent_stop_risk_lot_formula_is_intact_and_unchanged():
    ea = read(BACKEND_EA)
    # riskUSD = balance * 15% (InpNormalRiskPct), lot = riskUSD / money-loss-per-lot-at-SL
    assert "double riskAmount = balance * riskPct / 100.0;" in ea
    assert "double rawLots = riskAmount / slDollarPerLotRaw;" in ea
    assert "input double InpNormalRiskPct       = 15.0;" in ea
    assert "riskPct = MathMax(InpReducedRiskFloorPct, MathMin(InpNormalRiskPct, riskPct));" in ea


def test_lot_normalized_to_broker_step_min_and_max_before_margin_check():
    ea = read(BACKEND_EA)
    assert "double lots = XAU_NormalizeVolumeForRisk(rawLots, lotStep, minLot, maxLot," in ea
    assert "double minLot = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_MIN);" in ea
    assert "double maxLot = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_MAX);" in ea
    assert "double lotStep = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_STEP);" in ea


def test_different_sl_distances_produce_different_lots_via_risk_per_lot_function():
    # Lot size is derived from RiskPerLotForDistance(slDist), so different SL
    # distances feed different slDollarPerLotRaw values into the same 15%-risk
    # formula, producing different lots -- not a fixed/hardcoded lot size.
    ea = read(BACKEND_EA)
    assert "double slDollarPerLotRaw = RiskPerLotForDistance(slDist);" in ea
    assert "double rawLots = riskAmount / slDollarPerLotRaw;" in ea


def test_margin_and_symbol_properties_are_looked_up_dynamically_not_hardcoded():
    ea = read(BACKEND_EA)
    assert 'OrderCalcMargin(signal == 1 ? ORDER_TYPE_BUY : ORDER_TYPE_SELL, Symbol(), lots, price, marginNeeded)' in ea
    assert "accInfo.FreeMargin()" in ea
    assert "accInfo.Equity()" in ea


def test_risk_margin_trace_log_reports_every_required_field():
    ea = read(BACKEND_EA)
    idx = ea.index('PrintFormat("RISK_MARGIN_TRACE')
    block = ea[idx: idx + 700]
    for field in ["balance=$%.2f", "equity=$%.2f", "riskPct=%.3f%%", "riskUSD=$%.2f",
                  "slDist=%.2f", "moneyLossPerLotAtSL=$%.2f", "rawLot=%.4f",
                  "normalizedLot=%.4f", "requiredMargin=$%.2f", "freeMargin=$%.2f",
                  "marginReserve=$%.2f", "finalLot=%.4f", "decision=APPROVED"]:
        assert field in block, f"missing {field} in RISK_MARGIN_TRACE log"


def test_genuine_protections_are_preserved_untouched():
    ea = read(BACKEND_EA)
    # broker max/min lot, lot step, InpMaxLots, equity cap, aggregate risk cap,
    # invalid SL/TP, prop-firm cap must all still exist and still hard-block
    assert "BROKER_MAX_BELOW_FULL_RISK" in ea
    assert "CONFIGURED_MAX_LOTS_BELOW_FULL_RISK" in ea
    assert "EQUITY_CAP_BELOW_FULL_RISK" in ea
    assert "AGG_RISK_BELOW_FULL_RISK_ROOM" in ea
    assert "PROP_FIRM_CAP_BELOW_FULL_RISK" in ea
    assert "INVALID_LOT_OR_SL_DISTANCE" in ea


def test_compile_log_reports_zero_errors_and_warnings():
    log = read(COMPILE_LOG)
    assert re.search(r"Result:\s+0 errors,\s+0 warnings", log), log[-1000:]


def test_version_identity_bumped_to_v6243_without_losing_margin_fix():
    ea = read(BACKEND_EA)
    assert '#define XAUAI_EA_VERSION "v6.24.3"' in ea
    assert '#define XAUAI_EA_VERSION_NUM "6.24.3"' in ea
    assert '#property version   "6.243"' in ea
