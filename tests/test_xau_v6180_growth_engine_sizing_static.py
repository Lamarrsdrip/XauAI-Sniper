from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.18.0.mq5"
EA_BACKEND = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path):
    return path.read_text(encoding="utf-8", errors="ignore")


def section(text, start, end):
    return text[text.index(start):text.index(end, text.index(start))]


def open_trade_section(ea):
    return section(ea, "bool OpenTrade(int signal, double atr, string reason, double sizeMulti", "void LogExit")


def test_v6180_identity_and_synced_backend():
    ea = read(EA)
    assert '#property version   "6.196"' in ea
    assert '#define XAUAI_EA_VERSION "v6.18.0"' in ea
    assert '#define XAUAI_EA_VERSION_NUM "6.18.0"' in ea
    assert read(EA) == read(EA_BACKEND)


def test_unified_risk_inputs_replace_old_disagreeing_caps():
    ea = read(EA)
    # New single-authority inputs, uniform across every account size.
    assert "input double InpNormalRiskPct       = 15.0;" in ea
    assert "input double InpReducedRiskFloorPct = 9.0;" in ea
    # The single-trade and aggregate hard backstops now agree with the new target
    # instead of contradicting it (old: 5.0 / 8.0, both below what the account-size
    # lot floor was silently forcing in practice).
    assert "input double InpMaxRiskPctEquity = 15.0;" in ea
    assert "input double InpMaxAggregateRiskPct = 35.0;" in ea


def test_lot_sizing_mode_no_longer_branches_behavior():
    ea = read(EA)
    open_trade = open_trade_section(ea)
    # juneBalanceLotMode must be hardcoded false -- the two-parallel-systems split
    # (JUNE_16_19_BALANCE_MODE silently overriding every risk cap) is retired; the
    # enum/input stay declared for display only, referenced but not branched on.
    assert "bool juneBalanceLotMode = false;" in open_trade
    assert "juneBaseLot" not in open_trade
    assert "juneGradeMult" not in open_trade
    # Both lot-sizing modes now converge on one real-SL-risk formula.
    assert "double rawLots = riskAmount / slDollarPerLotRaw;" in open_trade


def test_quality_band_rescale_present_and_bounded():
    ea = read(EA)
    open_trade = open_trade_section(ea)
    assert "double qualityFrac = MathMax(0.0, MathMin(1.10, sizeMulti)) / 1.10;" in open_trade
    assert "double qualityBandMult = MathMax(0.60, MathMin(1.00," in open_trade
    assert "double baseRisk = InpNormalRiskPct;" in open_trade
    assert "double riskPct  = baseRisk * qualityBandMult;" in open_trade


def test_final_band_clamp_survives_legacy_multiplier_stack():
    ea = read(EA)
    open_trade = open_trade_section(ea)
    # Must clamp AFTER Asia-session/volatility/prop-firm/large-account-floor logic,
    # not just at the top of the function -- otherwise a B-grade Asia-session trade
    # could still stack below the promised 9% floor.
    assert "FINAL BAND CLAMP" in open_trade
    assert "riskPct = MathMax(InpReducedRiskFloorPct, MathMin(InpNormalRiskPct, riskPct));" in open_trade
    clamp_idx = open_trade.index("FINAL BAND CLAMP")
    riskamount_idx = open_trade.index("double riskAmount = balance * riskPct / 100.0;")
    assert clamp_idx < riskamount_idx


def test_unconditional_account_lot_floor_override_removed():
    ea = read(EA)
    open_trade = open_trade_section(ea)
    # The old v6.17.17 mechanism that unconditionally overrode every risk cap "as the
    # LAST step... regardless of which upstream reducer shrank the lot" must be gone --
    # that was the two-systems-fighting bug this release exists to close.
    assert "acctFloorLot" not in open_trade
    assert "ACCOUNT-LOT-FLOOR: balance=" not in open_trade


def test_growth_guard_no_longer_caps_at_entry():
    ea = read(EA)
    open_trade = open_trade_section(ea)
    # XAU_GrowthGuardCapLots() must not be called for entry-time sizing anymore (it
    # shared inputs with the in-trade defensive exit logic, which stays untouched).
    assert "lots = XAU_GrowthGuardCapLots(" not in open_trade
    assert "XAU_GrowthGuardCapLots(double lots" in ea  # function itself still exists, for exit-side use
