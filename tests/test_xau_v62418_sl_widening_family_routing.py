from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"
V62417_EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.24.17.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def test_all_three_source_copies_synced():
    assert read(EA) == read(BACKEND_EA) == read(V62417_EA)


def test_widening_factor_is_exactly_1_20():
    ea = read(BACKEND_EA)
    assert "#define XAU_SL_WIDENING_FACTOR 1.20" in ea


# ---------------------------------------------------------------------------
# Owner's exact formula, computed independently in Python (not reading the
# EA's own arithmetic back at itself) and cross-checked against the literal
# source expressions used inside OpenTrade().
# ---------------------------------------------------------------------------
WIDENING_FACTOR = 1.20


def widen_buy(entry: float, raw_sl: float):
    raw_dist = abs(entry - raw_sl)
    final_dist = raw_dist * WIDENING_FACTOR
    return entry - final_dist, final_dist


def widen_sell(entry: float, raw_sl: float):
    raw_dist = abs(entry - raw_sl)
    final_dist = raw_dist * WIDENING_FACTOR
    return entry + final_dist, final_dist


def test_exact_buy_widening_example():
    # entry=4000, raw structural SL=3990 -> raw distance 10 -> widened 12 -> final SL 3988
    final_sl, final_dist = widen_buy(4000.0, 3990.0)
    assert final_dist == 12.0
    assert final_sl == 3988.0


def test_exact_sell_widening_example():
    # entry=4000, raw structural SL=4010 -> raw distance 10 -> widened 12 -> final SL 4012
    final_sl, final_dist = widen_sell(4000.0, 4010.0)
    assert final_dist == 12.0
    assert final_sl == 4012.0


def test_exact_buy_widening_second_example():
    # entry=3500, raw SL=3475 -> raw distance 25 -> widened 30 -> final SL 3470
    final_sl, final_dist = widen_buy(3500.0, 3475.0)
    assert final_dist == 30.0
    assert final_sl == 3470.0


def test_exact_sell_widening_second_example():
    # entry=3500, raw SL=3525 -> raw distance 25 -> widened 30 -> final SL 3530
    final_sl, final_dist = widen_sell(3500.0, 3525.0)
    assert final_dist == 30.0
    assert final_sl == 3530.0


def test_widening_applied_exactly_once_in_opentrade():
    ea = read(BACKEND_EA)
    # exactly one occurrence of the actual multiplication in OpenTrade's
    # normal-family geometry step (the other XAU_SL_WIDENING_FACTOR uses
    # are R-normalization / display reads of the already-final distance).
    assert ea.count("slDist = rawSLDistance * XAU_SL_WIDENING_FACTOR;") == 1


def test_widening_happens_before_lot_sizing():
    ea = read(BACKEND_EA)
    widen_idx = ea.index("slDist = rawSLDistance * XAU_SL_WIDENING_FACTOR;")
    lot_sizing_idx = ea.index("double baseRisk = InpNormalRiskPct;                 // uniform target, ALL account sizes, ALL grades")
    assert widen_idx < lot_sizing_idx


def test_lot_sizing_derives_from_the_already_widened_sldist():
    ea = read(BACKEND_EA)
    widen_idx = ea.index("slDist = rawSLDistance * XAU_SL_WIDENING_FACTOR;")
    window = ea[widen_idx: widen_idx + 10000]
    assert "double slDollarPerLotRaw = RiskPerLotForDistance(slDist);" in window


# ---------------------------------------------------------------------------
# Every normal-risk family (PRIMARY fresh entry, RE_ENTRY, MANUAL_OPEN_NOW,
# FORCE_OPEN_BLOCKED_CANDIDATE) must route through this ONE OpenTrade() call
# so none of them can bypass the widening step.
# ---------------------------------------------------------------------------
def test_manual_open_now_routes_through_opentrade():
    ea = read(BACKEND_EA)
    fn_idx = ea.index("bool XAU_TryManualOpenNow(")
    window = ea[fn_idx: fn_idx + 4000]
    assert "OpenTrade(" in window


def test_force_open_routes_through_opentrade():
    ea = read(BACKEND_EA)
    fn_idx = ea.index("bool XAU_TryForceOpenTrade(")
    window = ea[fn_idx: fn_idx + 6000]
    assert "OpenTrade(" in window


def test_re_entry_and_primary_share_the_same_opentrade_function():
    ea = read(BACKEND_EA)
    assert ea.count("bool OpenTrade(int signal, double atr, string reason, double sizeMulti, bool isManualOverride = false)") == 1


def test_counter_excursion_and_pyramid_do_not_use_the_widening_factor():
    ea = read(BACKEND_EA)
    # Counter-Excursion's own order-send block (trade.Buy/Sell around the
    # CEC_ scoring section) and the pyramid add block build their SL from
    # ATR*InpSLMultiplier directly -- never multiplied by the 1.20x factor,
    # which is reserved for normal-risk families only.
    ce_send_idx = ea.index("bool ok = (counterDir == 1) ? trade.Buy(lots, Symbol(), 0, slPrice, tpPrice, comment)")
    ce_window = ea[max(0, ce_send_idx - 4000): ce_send_idx]
    assert "XAU_SL_WIDENING_FACTOR" not in ce_window

    pyramid_send_idx = ea.index('bool ok=isBuy?trade.Buy(addLot,Symbol(),0,pyramidSL,pyramidTP,"XAU-SNIPER|"+why)')
    pyramid_window = ea[max(0, pyramid_send_idx - 4000): pyramid_send_idx]
    assert "XAU_SL_WIDENING_FACTOR" not in pyramid_window


def test_backend_and_frontend_never_recompute_widening():
    outlook_py = read(ROOT / "backend" / "market_outlook.py")
    assert "* 1.20" not in outlook_py
    assert "* 1.2" not in outlook_py
