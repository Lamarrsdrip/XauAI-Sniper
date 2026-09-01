from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.17.19.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


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


def test_current_release_source_is_synced_to_backend():
    assert read(EA) == read(BACKEND_EA)


def test_version_bumped_to_v61719():
    ea = read(BACKEND_EA)
    assert '#define XAUAI_EA_VERSION "v6.17.19"' in ea


def test_header_banner_matches_property_version_for_website_display():
    import re
    ea = read(BACKEND_EA)
    m = re.search(r'v(\d+\.\d+\.\d+)\s*[—\-]+\s*(.+)', ea[:3000])
    assert m is not None
    assert f"v{m.group(1)}" == "v6.17.19"


# ---------------------------------------------------------------------------
# ACCOUNT-SIZE ADAPTIVE TP
# ---------------------------------------------------------------------------
def test_account_size_tp_multiplier_mirrors_risk_multiplier_equity_tiers():
    ea = read(BACKEND_EA)
    fn = body(ea, "double AccountSizeTPMultiplier()")
    assert "if(!InpAccountSizeBoost) return 1.0;" in fn
    assert "if(equity < 1000.0)   return 0.85;" in fn
    assert "if(equity < 10000.0)  return 1.00;" in fn
    assert "if(equity < 25000.0)  return 1.10;" in fn
    assert "if(equity < 75000.0)  return 1.20;" in fn
    assert "return 1.30;" in fn


def test_tp_multiplier_top_tier_capped_slightly_below_risk_multiplier():
    # At the top tier, TP boost (1.30x) is deliberately more conservative
    # than the risk boost (1.35x, InpLargeAccountBoostMax) -- widening TP
    # too aggressively on top of the risk boost can hurt fill probability.
    assert 1.30 < 1.35


def test_tp_scaling_applied_to_trending_and_breakout_not_to_chop_lowvol_safety_cap():
    ea = read(BACKEND_EA)
    fn = body(ea, "bool OpenTrade(int signal, double atr, string reason, double sizeMulti, bool isManualOverride = false)")
    chop_idx = fn.index("if(currentRegime == REGIME_LOW_VOL || currentRegime == REGIME_CHOPPY)")
    window = fn[chop_idx: chop_idx + 260]
    # The chop/low-vol branch keeps a flat, unscaled safety cap.
    assert "{ slM = MathMax(0.8, slM * 0.5); tpM = 1.5; }" in window
    assert "AccountSizeTPMultiplier" not in window
    # But the breakout and default (trending) branches do scale.
    assert "tpM = 2.5 * AccountSizeTPMultiplier();" in fn
    assert "tpM = tpM * AccountSizeTPMultiplier();" in fn


def test_lot_size_not_touched_by_this_release():
    # This release is exit-target-only; lot sizing (v6.17.17 floor,
    # AccountSizeRiskMultiplier) must be completely unchanged.
    ea = read(BACKEND_EA)
    assert "double acctFloorLot = MathMax(InpMinAccountLotFloor, balance / 1000.0 * InpAccountLotFloorPer1000);" in ea
    risk_fn = body(ea, "double AccountSizeRiskMultiplier()")
    assert "if(equity < 1000.0)   return 0.75;" in risk_fn
    assert "if(equity < 10000.0)  return 1.00;" in risk_fn


def test_prior_session_fixes_still_intact():
    ea = read(BACKEND_EA)
    assert "input double InpProfitQualityMinR             = 0.80;" in ea  # v6.17.18
    assert "XAU_ProfitQuality pq = XAU_AssessProfitQuality(" in ea         # v6.17.18
    assert "XAU_ScanStateKey(state)" in ea                                 # v6.17.18
    assert 'if(blockClass == "HARD_BLOCK")' in ea                          # v6.17.16
    assert "double acctFloorLot = MathMax(InpMinAccountLotFloor, balance / 1000.0 * InpAccountLotFloorPer1000);" in ea  # v6.17.17
