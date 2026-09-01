from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.18.1.mq5"
EA_BACKEND = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path):
    return path.read_text(encoding="utf-8", errors="ignore")


def section(text, start, end):
    return text[text.index(start):text.index(end, text.index(start))]


def pyramid_section(ea):
    return section(ea, "void CheckPyramidOpportunity()", "bool OpenTrade(int signal, double atr, string reason, double sizeMulti")


def test_v6181_identity_and_synced_backend():
    ea = read(EA)
    assert '#property version   "6.197"' in ea
    assert '#define XAUAI_EA_VERSION "v6.18.1"' in ea
    assert '#define XAUAI_EA_VERSION_NUM "6.18.1"' in ea
    assert read(EA) == read(EA_BACKEND)


def test_exit_arm_no_longer_depends_on_retired_equity_tier_multiplier():
    ea = read(EA)
    assert "input double InpProtectedPeakEquityPct        = 2.5;" in ea
    assert "double armUSD_accountScaled = MathMax(InpProtectedPeakMinUSD, StrategyReferenceBalance() * InpProtectedPeakEquityPct / 100.0);" in ea
    # The old formula must be gone as executable code (it's still quoted in the
    # changelog header for documentation, which is fine).
    assert "double armUSD_accountScaled = InpProtectedPeakMinUSD * AccountSizeRiskMultiplier();" not in ea
    # AccountSizeRiskMultiplier() must have no remaining live call sites that
    # actually use the return value (only its own definition, the deliberately
    # neutralized item-1 call, and explanatory comments may mention the name).
    live_calls = [ln.strip() for ln in ea.splitlines()
                  if "AccountSizeRiskMultiplier()" in ln
                  and not ln.strip().startswith("//")
                  and "double AccountSizeRiskMultiplier()" not in ln]
    assert live_calls == ["double acctSizeMult = 1.0; AccountSizeRiskMultiplier();"], live_calls


def test_pyramid_adds_no_longer_bypass_risk_caps_in_default_mode():
    ea = read(EA)
    pyr = pyramid_section(ea)
    assert 'if(InpLotSizingMode == JUNE_16_19_BALANCE_MODE)' not in pyr
    assert "risk caps bypassed" not in pyr
    # Both caps must be applied unconditionally now.
    assert "double effectiveSingleCap = EffectiveSingleRiskCapPct();" in pyr
    assert "double effectiveAggregateCap = EffectiveAggregateRiskCapPct();" in pyr


def test_pyramid_margin_projection_present_before_execution():
    ea = read(EA)
    pyr = pyramid_section(ea)
    assert "PYRAMID MARGIN PROJECTION" in pyr
    assert "OrderCalcMargin(isBuy ? ORDER_TYPE_BUY : ORDER_TYPE_SELL, Symbol(), addLot, entryPx, pyrMarginNeeded)" in pyr
    assert "pyrMarginNeeded > pyrFreeMargin * 0.8" in pyr
    # Must run before the actual order is placed.
    margin_idx = pyr.index("PYRAMID MARGIN PROJECTION")
    execute_idx = pyr.index('Print("PYRAMID: adding #"')
    assert margin_idx < execute_idx


def test_pyramid_add_count_no_longer_gated_by_equity_dollar_cutoffs():
    ea = read(EA)
    fn = section(ea, "int EffectiveMaxPyramidAdds(int dir, double moved, double atr)", "double PyramidMomentumATR")
    assert "equity >= 25000.0" not in fn
    assert "equity >= 50000.0" not in fn
    assert "StrategyReferenceBalance()" not in fn  # no equity variable left in this function at all
    assert "if(trendOk && highQuality && moved >= atr * 1.2 && !drawdownActive)" in fn
    assert "if(trendOk && highQuality && moved >= atr * 1.8 && !drawdownActive)" in fn


def test_growth_hard_loss_cap_june_adjust_now_unconditional():
    ea = read(EA)
    assert "GROWTH_HARD_LOSS_CAP_JUNE_ADJUST" in ea
    block = section(ea, "// v6.5.0 (audit bug #5): JUNE_16_19_BALANCE_MODE used to size lots",
                     "GROWTH_HARD_LOSS_CAP_JUNE_ADJUST")
    assert "if(slDist > 0.0 && lotsOpen > 0.0)" in block
    assert "InpLotSizingMode == JUNE_16_19_BALANCE_MODE &&" not in block


def test_role_notes_present_and_no_merge_occurred():
    ea = read(EA)
    assert "SETUP TYPE / EVIDENCE CLASSIFIER" in ea
    assert "CONFIRMATION / WAIT / REASSESS" in ea
    assert "ANTI-CHASE / LOCATION QUALITY" in ea
    # All three functions must still independently exist -- confirms no merge.
    assert "void XAU_ClassifySetup(int dir, double atr, string setupName, XAU_SetupClassification &c)" in ea
    assert "bool XAU_TimingEngineConfirmsEntry(int dir, string setup, string grade, double sizeMulti, double atr)" in ea
    assert 'bool XAUEntryTimingGuard(int signal, string setupName, double setupScore, double combinedScore,' in ea
