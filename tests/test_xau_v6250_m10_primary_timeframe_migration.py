from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"

# Functions deliberately left on PERIOD_M5 -- exit/position-management
# (owner spec: "position management ... primary exit enforcement ... remain
# live"), Counter-Excursion's own isolated fast-reaction architecture, and
# the entry-timer-window STI family (execution-time evidence, not the
# primary decision candle). See migration comment in XAUUSD_AI_Sniper_EA.mq5.
INTENTIONAL_M5_FUNCTIONS = {
    "STI_ComputeTCP", "STI_ComputeLateEntryRisk", "STI_Update",
    "XAU_M5M15TrendClean",  # exit-side "clean trend" runner confirmation
    "ManageBasket", "CleanStructureLevels", "CleanStructureBreakBars",
    "ManageCleanExitsForPosition", "TTM_Evaluate", "XAU_RExitCoreLoop",
    "ManagePositions", "XAU_ReconstructOpenBasketPeakUSD",
    "XAU_BasketStructureBroken", "XAU_BasketRunnerConvictionActive",
    "XAU_CounterExcursionOpportunityScore", "XAU_ManageCounterExcursionPosition",
    "InTradeClassifier_Update", "RatchetExitContext", "PG_PerPositionRatchet",
    "TFShortName",  # generic multi-TF label formatter, not a primary-TF assumption
}


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def find_function(ea: str, signature: str) -> str:
    start = ea.index(signature)
    open_idx = ea.index("{", start)
    depth = 0
    i = open_idx
    while i < len(ea):
        if ea[i] == "{":
            depth += 1
        elif ea[i] == "}":
            depth -= 1
            if depth == 0:
                return ea[start:i + 1]
        i += 1
    raise AssertionError(f"unbalanced braces for {signature}")


def test_root_and_backend_copies_synced():
    assert read(EA) == read(BACKEND_EA)


# ---------------------------------------------------------------------------
# 1: canonical primary timeframe constant
# ---------------------------------------------------------------------------
def test_canonical_primary_timeframe_is_m10():
    ea = read(EA)
    assert "#define XAU_PRIMARY_DECISION_TF PERIOD_M10" in ea
    assert "#define XAU_PRIMARY_DECISION_TF_SECONDS 600" in ea


def test_core_transition_engine_uses_canonical_constant_not_hardcoded_m5():
    ea = read(EA)
    fn = find_function(ea, "XAU_AdaptiveTransitionDecision XAU_AdaptiveMarketTransitionEngine()")
    assert "PERIOD_M5" not in fn
    assert "XAU_PRIMARY_DECISION_TF" in fn


def test_score_setups_uses_canonical_constant():
    ea = read(EA)
    fn = find_function(ea, "int ScoreSetups(double &score, string &setupName, int excludeDir = 0)")
    assert "PERIOD_M5" not in fn
    assert "XAU_PRIMARY_DECISION_TF" in fn


def test_indicator_handles_built_on_primary_timeframe():
    ea = read(EA)
    assert 'hEMAFast  = iMA(Symbol(), XAU_PRIMARY_DECISION_TF, InpEMAFast, 0, MODE_EMA, PRICE_CLOSE);' in ea
    assert 'hRSI      = iRSI(Symbol(), XAU_PRIMARY_DECISION_TF, InpRSIPeriod, PRICE_CLOSE);' in ea
    assert 'hATR      = iATR(Symbol(), XAU_PRIMARY_DECISION_TF, InpATRPeriod);' in ea
    assert 'hStoch    = iStochastic(Symbol(), XAU_PRIMARY_DECISION_TF, 14, 3, 3, MODE_SMA, STO_LOWHIGH);' in ea
    # both OnInit and RebuildEntryIndicatorHandles must agree
    assert ea.count('hEMAFast  = iMA(Symbol(), XAU_PRIMARY_DECISION_TF, InpEMAFast, 0, MODE_EMA, PRICE_CLOSE);') == 2


# ---------------------------------------------------------------------------
# 2: staleness threshold recalibrated for the new (larger) bar period
# ---------------------------------------------------------------------------
def test_staleness_threshold_uses_primary_tf_seconds_not_hardcoded_900():
    ea = read(EA)
    fn = find_function(ea, "XAU_AdaptiveTransitionDecision XAU_AdaptiveMarketTransitionEngine()")
    assert "barAgeSec > XAU_PRIMARY_DECISION_TF_SECONDS * 3" in fn
    assert "barAgeSec > 900" not in fn


# ---------------------------------------------------------------------------
# 3: rolling 24h window bar-count recalibrated (288 M5 bars -> 144 M10 bars)
# so the real-world duration is NOT silently doubled to 48h
# ---------------------------------------------------------------------------
def test_rolling_range_window_recalibrated_to_still_be_24h():
    ea = read(EA)
    fn = find_function(ea, "XAU_AdaptiveTransitionDecision XAU_AdaptiveMarketTransitionEngine()")
    assert "for(int i=1; i<=144; i++)" in fn
    assert "valid >= 24 &&" in fn
    assert "for(int i=1; i<=288; i++)" not in fn


# ---------------------------------------------------------------------------
# 4: structured logs carry primaryTf=M10
# ---------------------------------------------------------------------------
def test_exhaustion_and_pressure_calc_logs_carry_primary_tf_m10():
    ea = read(EA)
    assert 'PrintFormat("EXHAUSTION_CALC | primaryTf=M10 |' in ea
    assert 'PrintFormat("PRESSURE_CALC | primaryTf=M10 |' in ea


# ---------------------------------------------------------------------------
# 5: entry timer / missed-move rule unchanged (M10 must not be confused
# with the separate 120-180s entry confirmation timer)
# ---------------------------------------------------------------------------
def test_entry_timer_window_unchanged():
    ea = read(EA)
    # the 120-180s wall-clock entry confirmation timer is a distinct concept
    # from the M10 primary decision candle and must not be touched by this
    # migration -- these input names predate the M10 change (legacy "M5"
    # prefix, kept as-is to avoid breaking saved .set presets) but their
    # VALUES (120/150/180) are the thing that must be unchanged.
    assert "input int    InpM5EntryDelayMinSeconds      = 120;" in ea
    assert "input int    InpM5EntryDelaySeconds         = 150;" in ea


# ---------------------------------------------------------------------------
# 6: risk / SL widening non-regression (M10 migration must not touch these)
# ---------------------------------------------------------------------------
def test_risk_and_sl_widening_constants_unchanged():
    ea = read(EA)
    assert "InpNormalRiskPct" in ea
    assert "XAU_SL_WIDENING_FACTOR" in ea


# ---------------------------------------------------------------------------
# 7: identifier renames (lastM5Bar/newM5Bar/M5Bar family)
# ---------------------------------------------------------------------------
def test_new_bar_flag_renamed_to_primary():
    ea = read(EA)
    assert "bool newPrimaryBar = (curBar > 0 && curBar != g_lastEntryBarSeen);" in ea
    assert "newM5Bar" not in ea


def test_decision_snapshot_field_renamed_to_primary():
    ea = read(EA)
    assert "datetime closedPrimaryBarTime;" in ea
    assert "closedM5BarTime" not in ea


def test_watchdog_idle_reason_renamed_to_primary():
    ea = read(EA)
    assert "WAITING_FOR_NEW_PRIMARY_BAR" in ea
    assert "WAITING_FOR_NEW_M5_BAR" not in ea


# ---------------------------------------------------------------------------
# 8: intentional remaining M5 references are documented, not accidental
# ---------------------------------------------------------------------------
def test_every_remaining_period_m5_reference_is_in_the_documented_intentional_set():
    ea = read(EA)
    lines = ea.splitlines()
    offenders = []
    for i, line in enumerate(lines, start=1):
        if "PERIOD_M5" not in line:
            continue
        if line.strip().startswith("//"):
            continue  # explanatory comment, not a live code path
        offenders.append((i, line.strip()))
    # every offending line must fall within one of the documented
    # intentionally-left functions
    for lineno, content in offenders:
        # find nearest preceding function signature
        owner = None
        for j in range(lineno - 1, 0, -1):
            l = lines[j - 1]
            if any(l.startswith(f"{kw} ") for kw in ("bool", "void", "int", "double", "string", "ulong", "datetime")) and "(" in l:
                owner = l
                break
        assert owner is not None, f"line {lineno} ({content}) has no enclosing function"
        assert any(name in owner for name in INTENTIONAL_M5_FUNCTIONS), \
            f"line {lineno} ({content}) is inside undocumented function: {owner}"


if __name__ == "__main__":
    import sys
    import pytest
    sys.exit(pytest.main([__file__, "-q"]))
