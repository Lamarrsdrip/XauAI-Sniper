"""Static + scenario tests for the v6.20.3 "one adaptive risk/profit brain" migration.

User request this covers: make every exit/profit-protection module (Basket
Lock, A+ Shield, EV_PROTECT, AMPL, Protected Peak Floor, Smart Exit, Thesis
Hold, Runner Conviction, Basket Lifecycle, Peak Retrace) route its flat-dollar
arm/floor thresholds through the single central function
XAU_AdaptiveProfitArmUSD(), instead of each module inventing its own
un-scaled "$30" / "$75" style constant -- so a bigger lot or bigger account
never arms/locks protection at a smaller fraction of its own risk than a
smaller one would.

Per this repo's convention (see test_xau_v6202_command_safety_static.py),
these are static/text-level checks against the .mq5 source (no MQL5 runtime
in CI) plus a Python re-implementation of the pure-math formula for the
account-size scenario checks (Mac-small / VPS-big / prop / broker-min-lot).
"""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.20.3.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def mql_body(src: str, signature: str) -> str:
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


def mql_signature_and_body(src: str, signature: str) -> str:
    """Like mql_body, but includes the full parameter list before the opening
    brace -- needed for default parameters (e.g. `double rDollars = 0.0`),
    which sit in the signature, not the body."""
    idx = src.index(signature)
    start = src.index("{", idx)
    depth = 0
    for i in range(start, len(src)):
        if src[i] == "{":
            depth += 1
        elif src[i] == "}":
            depth -= 1
            if depth == 0:
                return src[idx:i + 1]
    raise AssertionError(f"unbalanced braces for {signature}")


# --------------------------------------------------------------------------
# Central function itself
# --------------------------------------------------------------------------

def test_central_function_exists_with_expected_shape():
    ea = read(EA)
    fn = mql_body(ea, "double XAU_AdaptiveProfitArmUSD(double rawDollarThreshold, double positionRiskUSD,")
    assert "MathMax(positionRiskUSD, basketRiskUSD)" in fn
    assert "InpExitArmMinOwnR" in fn
    assert "effectiveRisk <= 0.0" in fn and "return rawDollarThreshold" in fn


def test_min_arm_usd_for_own_r_is_thin_backward_compatible_wrapper():
    ea = read(EA)
    fn = mql_body(ea, "double XAU_MinArmUSDForOwnR(double dollarArm, double rDollars)")
    assert "XAU_AdaptiveProfitArmUSD(dollarArm, rDollars)" in fn


# --------------------------------------------------------------------------
# Per-module wiring -- every module the user named must route through the
# central function rather than comparing/MathMax-ing a raw Inp*USD constant
# directly against peak/profit.
# --------------------------------------------------------------------------

def test_ev_protect_uses_central_function():
    ea = read(EA)
    assert "XAU_MinArmUSDForOwnR(InpEVExitEdgeUSD, rDollars)" in ea
    assert "XAU_MinArmUSDForOwnR(InpEVMinHoldEdgeUSD, rDollars)" in ea


def test_a_plus_shield_uses_central_function():
    ea = read(EA)
    assert "XAU_MinArmUSDForOwnR(MathMax(InpAPlusShieldMinArmUSD" in ea
    assert "XAU_MinArmUSDForOwnR(MathMax(InpAPlusShieldMinProtectUSD" in ea


def test_ampl_uses_central_function_at_all_four_sites():
    ea = read(EA)
    assert "XAU_AdaptiveProfitArmUSD(InpAMPL_MinUSD, rDollars)" in ea
    assert "XAU_AdaptiveProfitArmUSD(InpAMPL_GivebackMinUSD, rDollars)" in ea
    assert ea.count("XAU_AdaptiveProfitArmUSD(InpAMPL_MinRetainUSD, rDollars)") == 2


def test_basket_lock_arm_uses_central_function():
    ea = read(EA)
    assert "armUSD = XAU_MinArmUSDForOwnR(armUSD, basketRDollars);" in ea


def test_basket_protected_peak_arm_and_floor_and_close_red_gates_normalized():
    ea = read(EA)
    assert "double basketProtectedPeakMinUSD_R = XAU_AdaptiveProfitArmUSD(InpProtectedPeakMinUSD, basketRDollars);" in ea
    assert "g_basketPeakUSD >= MathMax(1.0, basketProtectedPeakMinUSD_R)" in ea
    assert "XAU_AdaptiveProfitArmUSD(InpProtectedPeakMinRetainUSD, basketRDollars)" in ea
    assert ea.count("g_basketPeakUSD >= basketProtectedPeakMinUSD_R") == 3, \
        "all 3 basket CLOSE_RED gates (fast-reversal, hard-cap, floor) must reuse the same normalized threshold"


def test_per_position_protected_peak_arm_and_floor_normalized():
    ea = read(EA)
    assert "armUSD = XAU_MinArmUSDForOwnR(armUSD, rDollars);" in ea
    assert "double floorUSD = MathMax(XAU_AdaptiveProfitArmUSD(InpProtectedPeakMinRetainUSD, rDollars), peak * lockPct / 100.0);" in ea


def test_runner_conviction_normalized_per_position_and_basket():
    ea = read(EA)
    fn = mql_signature_and_body(ea, "bool XAU_RunnerConvictionActive(int signal,")
    assert "double rDollars = 0.0" in fn
    assert "XAU_AdaptiveProfitArmUSD(InpRunnerConvictionMinPeakUSD, rDollars)" in fn

    basket_fn = mql_signature_and_body(ea, "bool XAU_BasketRunnerConvictionActive(int basketDir, double totalPnL, double peakUSD, string &why,")
    assert "double basketRDollars = 0.0" in basket_fn
    assert "XAU_AdaptiveProfitArmUSD(InpRunnerConvictionMinPeakUSD, basketRDollars)" in basket_fn
    # all 3 real call sites must forward the basket's own risk, not rely on the 0.0 default
    for call in (
        "XAU_BasketRunnerConvictionActive(basketDirFRW, totalPnL, g_basketPeakUSD, basketRunnerWhyFR, basketRDollars)",
        "XAU_BasketRunnerConvictionActive(basketDirHCW, totalPnL, g_basketPeakUSD, basketRunnerWhyHC, basketRDollars)",
        "XAU_BasketRunnerConvictionActive(basketDirBL, totalPnL, g_basketPeakUSD, basketRunnerWhyBL, basketRDollars)",
    ):
        assert call in ea, f"missing basketRDollars forwarding at: {call}"


def test_basket_lifecycle_manager_normalized():
    ea = read(EA)
    fn = mql_signature_and_body(ea, "bool XAU_BasketLifecycleManager(double totalPnL, double bal, bool protectedPeakActive, double floorUSD,")
    assert "double basketRDollars = 0.0" in fn
    assert "XAU_AdaptiveProfitArmUSD(InpLifecyclePeakMinUSD, basketRDollars)" in fn
    assert "XAU_AdaptiveProfitArmUSD(InpLifecycleSecondChanceMinUSD, basketRDollars)" in fn
    assert "XAU_BasketLifecycleManager(totalPnL, bal, basketProtectedPeakActive, g_basketFloorUSD, basketRDollars)" in ea


def test_thesis_hold_runner_normalized_both_call_sites():
    ea = read(EA)
    fn = mql_signature_and_body(ea, "bool XAU_ThesisHoldRunnerAllowed(ulong ticket, bool isBuy, bool runnerClean,")
    assert "double rDollars = 0.0" in fn
    assert "XAU_AdaptiveProfitArmUSD(InpThesisHoldMinPeakUSD, rDollars)" in fn
    assert ea.count("contextState, rDollars);") >= 2, \
        "both XAU_ThesisHoldRunnerAllowed call sites must forward this position's own rDollars"


def test_smart_exit_arm_and_floor_normalized():
    ea = read(EA)
    assert "strongProfitUSD = XAU_AdaptiveProfitArmUSD(strongProfitUSD, rDollars);" in ea
    assert ea.count("MathMax(XAU_AdaptiveProfitArmUSD(InpSmartExitMinRetainUSD, rDollars), peak * lockPct / 100.0)") == 2


def test_peak_retrace_exit_gate_normalized():
    ea = read(EA)
    assert "effPeakMin = XAU_AdaptiveProfitArmUSD(effPeakMin, rDollars);" in ea
    idx = ea.index("effPeakMin = XAU_AdaptiveProfitArmUSD(effPeakMin, rDollars);")
    after = ea[idx:idx + 300]
    assert "peak >= effPeakMin" in after


# --------------------------------------------------------------------------
# Deliberately-unmigrated modules -- confirm the reasoning still holds so a
# future edit doesn't silently "fix" something that was correctly left alone.
# --------------------------------------------------------------------------

def test_profit_guardian_bounds_remain_balance_scaled_clamps_not_r_gates():
    ea = read(EA)
    fn = mql_body(ea, "void RecomputeAutoScale()")
    # Profit Guardian already scales by account balance-% (a different, correct
    # basis for a whole-account auto-target) and only clamps with flat floors/
    # ceilings -- these are sanity bounds on an already-scaled value, not a
    # per-trade-R arm gate, so they must NOT be wrapped in XAU_AdaptiveProfitArmUSD.
    assert "bal * (InpAutoProfMinPct / 100.0)" in fn
    assert "XAU_AdaptiveProfitArmUSD(InpProfMinFloorUSD" not in ea
    assert "XAU_AdaptiveProfitArmUSD(InpProfMaxFloorUSD" not in ea
    assert "XAU_AdaptiveProfitArmUSD(InpProfMaxCeilUSD" not in ea


def test_expectancy_day_giveback_guard_remains_equity_pct_scaled_not_r_scaled():
    ea = read(EA)
    fn = mql_body(ea, "bool ExpectancyDayGivebackGuard()")
    # A day-level (multi-trade) circuit breaker has no single position's R to
    # normalize against -- dailyStartEquity*% is the correct basis here, not
    # XAU_AdaptiveProfitArmUSD (which is intentionally per-position/basket).
    assert "dailyStartEquity * InpExpectancyDayArmPct / 100.0" in fn
    assert "XAU_AdaptiveProfitArmUSD" not in fn


# --------------------------------------------------------------------------
# Account-size scenario tests -- pure-math re-implementation of the formula,
# run across the 4 scenarios the user asked for: Mac-small, VPS-big, prop,
# broker-min-lot. Verifies the core invariant: bigger risk requires bigger
# (or equal) proof in dollar terms, and small/zero risk never regresses
# behavior below the raw configured threshold.
# --------------------------------------------------------------------------

MIN_OWN_R_DEFAULT = 0.20  # matches InpExitArmMinOwnR default


def adaptive_profit_arm_usd(raw_dollar_threshold, position_risk_usd,
                             basket_risk_usd=0.0, min_own_r=None, adj_mult=1.0):
    effective_risk = max(position_risk_usd, basket_risk_usd)
    if effective_risk <= 0.0:
        return raw_dollar_threshold
    min_r = min_own_r if (min_own_r is not None and min_own_r > 0.0) else MIN_OWN_R_DEFAULT
    adjusted_threshold = max(1.0, adj_mult) * raw_dollar_threshold
    return max(adjusted_threshold, effective_risk * min_r)


SCENARIOS = {
    # name: (account_balance, lot, sl_distance_usd_per_lot -> rDollars)
    "mac_small_demo":     dict(balance=3000,   rDollars=20.0),    # 0.01-lot XAUUSD, tight SL
    "vps_big_live":       dict(balance=7000,   rDollars=650.0),   # bigger lot, same setup grade
    "prop_firm_large":    dict(balance=100000, rDollars=4000.0),  # much bigger account/risk
    "broker_min_lot":     dict(balance=200,    rDollars=1.5),     # tiny broker-minimum-lot account
}


def test_bigger_risk_never_arms_at_a_smaller_absolute_threshold():
    raw = 75.0  # e.g. InpProtectedPeakMinUSD
    results = {name: adaptive_profit_arm_usd(raw, s["rDollars"]) for name, s in SCENARIOS.items()}
    # monotonic in rDollars: VPS (bigger risk) must require >= Mac's threshold, etc.
    ordered = sorted(SCENARIOS.items(), key=lambda kv: kv[1]["rDollars"])
    thresholds_in_risk_order = [results[name] for name, _ in ordered]
    assert thresholds_in_risk_order == sorted(thresholds_in_risk_order), \
        f"threshold must be monotonically non-decreasing in risk: {results}"


def test_own_r_floor_binds_exactly_when_it_should():
    raw = 75.0
    for name, s in SCENARIOS.items():
        result = adaptive_profit_arm_usd(raw, s["rDollars"])
        r_floor = s["rDollars"] * MIN_OWN_R_DEFAULT
        if r_floor > raw:
            assert abs(result - r_floor) < 1e-9, f"{name}: expected R-floor to bind, got {result} vs {r_floor}"
        else:
            assert abs(result - raw) < 1e-9, f"{name}: expected raw threshold to bind (R-floor smaller), got {result}"
        # invariant regardless of which side bound: never below either candidate
        assert result >= raw - 1e-9
        assert result >= r_floor - 1e-9


def test_zero_risk_fallback_reproduces_pre_migration_behavior_exactly():
    # Any call site that can't yet supply a real risk figure (e.g. a default
    # param of 0.0 before basketRDollars is known) must fall back to exactly
    # the original flat threshold -- never crash, never silently zero it out.
    assert adaptive_profit_arm_usd(75.0, 0.0) == 75.0
    assert adaptive_profit_arm_usd(35.0, 0.0, basket_risk_usd=0.0) == 35.0


def test_broker_min_lot_tiny_account_is_not_penalized_by_a_flat_floor_it_cant_reach():
    # A $200 broker-min-lot account's own R (1.5 * 0.20 = $0.30) is far below
    # the raw $75 configured floor -- the raw floor should bind, exactly as it
    # did before this migration, so tiny accounts aren't forced into an
    # unreachable, artificially-inflated R-based number.
    result = adaptive_profit_arm_usd(75.0, SCENARIOS["broker_min_lot"]["rDollars"])
    assert result == 75.0


def test_prop_firm_large_account_requires_meaningfully_more_than_flat_floor():
    # A $100k-risk-adjacent basket's own R (4000 * 0.20 = $800) must dominate
    # the flat $75 configured floor -- this is the exact failure mode the user
    # reported (VPS/large account cutting profit at a trivially small fraction
    # of its real risk).
    result = adaptive_profit_arm_usd(75.0, SCENARIOS["prop_firm_large"]["rDollars"])
    assert result == 800.0
    assert result > 75.0 * 10
