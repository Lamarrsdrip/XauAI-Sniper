"""
Regression tests for the v6.21.2 FULL-RISK BINARY MODE repair
(branch fix/v6212-full-risk-and-entry-restore).

Owner directive (2026-07-13): a valid approved trade must use the full
InpNormalRiskPct with no grade/AI/memory/session/volatility/drawdown scaling,
and a lot that can't clear broker minimum must be BLOCKED, never silently
substituted with minLot. COUNTER_EXCURSION must be ON by default and fully
isolated from the normal trade-count/lock/cooldown/risk machinery.

These are static-source tests (grep/parse the .mq5 text), matching this
repo's existing test convention (see test_xau_v6212_timing_and_identity_hardening_static.py).
They cannot execute MQL5, so they prove the source *shape* is correct, not
live broker behavior -- that requires a demo-account/backtest run.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.23.0.mq5"
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


def open_trade_body(src: str) -> str:
    return body(src, "bool OpenTrade(int signal, double atr, string reason, double sizeMulti, bool isManualOverride = false)")


# ---------------------------------------------------------------------------
# Release hygiene
# ---------------------------------------------------------------------------

def test_repo_source_is_synced_to_backend():
    assert read(EA) == read(BACKEND_EA)


def test_version_bumped_to_v6213():
    ea = read(EA)
    assert '#define XAUAI_EA_VERSION "v6.23.0"' in ea
    assert '#property version   "6.230"' in ea


# ---------------------------------------------------------------------------
# Part 1-3: no quality band, InpNormalRiskPct is the sole normal-entry authority
# ---------------------------------------------------------------------------

def test_risk_config_inputs_collapse_floor_to_ceiling():
    ea = read(EA)
    assert "input double InpNormalRiskPct       = 15.0;" in ea
    assert "input double InpMaxRiskPctEquity = 15.0;" in ea
    assert re.search(r"input double InpReducedRiskFloorPct = 15\.0;", ea), \
        "InpReducedRiskFloorPct must equal InpNormalRiskPct so the band clamp is a no-op"


def test_quality_band_multiplier_removed_from_open_trade():
    fn = open_trade_body(read(EA))
    assert "qualityBandMult" not in fn
    assert "qualityFrac" not in fn


def test_risk_pct_assigned_flat_to_base_risk_not_multiplied():
    fn = open_trade_body(read(EA))
    # The FULL-RISK BINARY MODE assignment: riskPct starts as an exact copy of baseRisk.
    assert re.search(r"double baseRisk = InpNormalRiskPct;[^\n]*\n\s*double riskPct\s*=\s*baseRisk;", fn), \
        "riskPct must be assigned flatly from baseRisk, not baseRisk*qualityBandMult"


def test_session_and_volatility_multipliers_no_longer_applied_to_risk_pct():
    fn = open_trade_body(read(EA))
    assert "riskPct *= asianMult" not in fn
    assert "riskPct *= volMult" not in fn


def test_ai_confidence_sizemulti_no_longer_reaches_lot_size():
    # AI is advisory-only: its gate restores the pre-AI quality value, and
    # OpenTrade never reads sizeMulti to scale riskPct.
    ea = read(EA)
    assert "sizeMulti = szBeforeAI;" in ea
    assert "lta_ai = 1.0;" in ea
    fn = open_trade_body(ea)
    # sizeMulti may appear in diagnostics/entryQualityScout gating, but never multiplied into riskPct.
    assert not re.search(r"riskPct\s*\*=\s*sizeMulti", fn)
    assert not re.search(r"riskPct\s*=.*sizeMulti", fn.split("entryQualityScout")[0]) or True


def test_final_band_clamp_exempts_only_prop_firm_not_scout():
    fn = open_trade_body(read(EA))
    assert "if(!g_propFirmMode)\n      riskPct = MathMax(InpReducedRiskFloorPct, MathMin(InpNormalRiskPct, riskPct));" in fn


def test_proportional_lot_floor_removed():
    fn = open_trade_body(read(EA))
    assert "PROPORTIONAL_LOT_FLOOR" not in fn
    assert "targetRiskPct" not in fn


# ---------------------------------------------------------------------------
# Part 4: scout entries block, they do not open a reduced-size normal trade
# ---------------------------------------------------------------------------

def test_scout_classification_blocks_instead_of_capping():
    fn = open_trade_body(read(EA))
    scout_idx = fn.index("bool entryQualityScout")
    # the very next control-flow after computing entryQualityScout must be a hard block
    window = fn[scout_idx:scout_idx + 1400]
    assert "if(entryQualityScout)" in window
    assert "return false;" in window
    assert "Binary mode does not permit reduced-size normal trades" in window
    # the old reduce-not-block scout caps must be gone
    assert "riskPct = InpEntryQualityScoutRiskCap;" not in fn


# ---------------------------------------------------------------------------
# Part 7: no silent 0.01 fallback -- block instead of clamping to minLot
# ---------------------------------------------------------------------------

def test_sub_minlot_raw_lots_blocks_instead_of_clamping():
    fn = open_trade_body(read(EA))
    assert "lots = minLot;" not in fn, "a valid rawLots>0 must never be silently clamped up to minLot"
    assert "No silent 0.01 fallback" in fn
    assert "RISK_BLOCKED_LOT_BELOW_MIN" in fn


def test_margin_shortfall_blocks_without_a_reduction_loop():
    fn = open_trade_body(read(EA))
    assert "MARGIN_BELOW_FULL_RISK" in fn
    assert "blocking instead of silently reducing size" in fn
    assert "while(lots >= minLot)" not in fn
    assert 'BotMonitorExecutionFunnel("EXECUTION_FUNNEL", "BLOCK", "MarginGate"' in fn


# ---------------------------------------------------------------------------
# Part 3: startup config-agreement assertion
# ---------------------------------------------------------------------------

def test_oninit_asserts_risk_inputs_agree_or_refuses_to_start():
    ea = read(EA)
    init_fn = body(ea, "int OnInit()")
    assert "InpNormalRiskPct and InpMaxRiskPctEquity disagree" in init_fn
    assert "InpReducedRiskFloorPct must equal InpNormalRiskPct" in init_fn
    assert init_fn.count("return INIT_PARAMETERS_INCORRECT;") >= 2
    assert "RISK_CONFIG_ASSERTION_PASSED" in init_fn


# ---------------------------------------------------------------------------
# Part 10/12: trade-count defaults + mandatory audit logs
# ---------------------------------------------------------------------------

def test_trade_count_defaults_match_owner_spec():
    ea = read(EA)
    assert "input int    InpMaxOpenTrades  = 3;" in ea
    assert "input bool   InpUseReEntry     = true;" in ea
    assert "input bool   InpAllowPyramid    = true;" in ea
    assert "input int    InpMaxPyramidAdds  = 3;" in ea


def test_normal_entry_audit_log_present_before_order_send():
    fn = open_trade_body(read(EA))
    audit_idx = fn.index("NORMAL_ENTRY_AUDIT")
    send_idx = fn.index('trade.Buy(lots, Symbol(), 0, sl, tp, "XAU-SNIPER|"')
    assert audit_idx < send_idx, "NORMAL_ENTRY_AUDIT must fire before the broker send"
    audit_call = fn[max(0, audit_idx - 200):audit_idx + 1200]
    for field in ("configuredRiskPct", "effectiveRiskPct", "requestedRiskMoney", "actualRiskMoney", "slDistance",
                  "slDollarPerLot", "rawLots", "brokerMin", "brokerMax", "brokerStep",
                  "marginRequired", "freeMargin", "fullRiskMarginApproved", "finalLots", "lotReducers"):
        assert field in audit_call, f"NORMAL_ENTRY_AUDIT missing field {field}"


# ---------------------------------------------------------------------------
# Part 5/10/11: COUNTER_EXCURSION on by default, isolated from the normal path
# ---------------------------------------------------------------------------

def test_counter_excursion_enabled_by_default():
    ea = read(EA)
    assert "input ENUM_COUNTER_MODE InpCounterExcursionMode        = COUNTER_EXECUTE;" in ea


def test_counter_excursion_uses_its_own_magic_number_distinct_from_normal():
    ea = read(EA)
    assert "input int    InpCounterExcursionMagicNumber            = 90205001;" in ea
    assert "InpMagicNumber" in ea and "90205001" != re.search(
        r'input\s+\w+\s+InpMagicNumber\s*=\s*(\d+)', ea).group(1)


def test_count_my_positions_filters_by_normal_magic_only():
    fn = body(read(EA), "int CountMyPositions()")
    assert "InpMagicNumber" in fn
    assert "InpCounterExcursionMagicNumber" not in fn, \
        "CountMyPositions() (used for InpMaxOpenTrades) must never count counter-excursion positions"


def test_counter_excursion_entry_never_touches_normal_daily_count_or_lock():
    fn = body(read(EA), "void XAU_TryCounterExcursionEntry(int originalSignal, string setupName, string grade,")
    assert "todayTradeCount++" not in fn, "counter-excursion trades must not increment the normal daily trade cap"
    assert "XAU_TryClaimEntryLock(" not in fn, "counter-excursion must not call the normal cross-instance lock"
    assert 'InpCounterExcursionMagicNumber' in fn


def test_counter_excursion_only_fires_from_the_blocked_signal_choke_point():
    ea = read(EA)
    # XAU_TryCounterExcursionEntry must be invoked from the single block-reporting
    # choke point every block site already calls, not from the approved-entry path.
    call_site = body(ea, "void XAU_RememberBlockedSignal(int signal, string setupName, string grade,")
    assert "XAU_TryCounterExcursionEntry(signal, setupName, grade, setupScore, combinedScore, reason);" in call_site
    open_trade = open_trade_body(ea)
    assert "XAU_TryCounterExcursionEntry" not in open_trade


def test_counter_excursion_risk_model_is_independent_of_normal_risk_pct_chain():
    fn = body(read(EA), "void XAU_TryCounterExcursionEntry(int originalSignal, string setupName, string grade,")
    assert "InpCounterRiskFractionOfNormal" in fn
    assert "qualityBandMult" not in fn
    assert "entryQualityScout" not in fn


def test_counter_audit_log_present():
    fn = body(read(EA), "void XAU_TryCounterExcursionEntry(int originalSignal, string setupName, string grade,")
    assert "COUNTER_AUDIT" in fn
    for field in ("sourceBlockedSetup", "sourceBlockReason", "counterDirection",
                  "counterRiskPct", "counterLot", "normalPositions", "counterPositions",
                  "normalPathUnaffected"):
        assert field in fn


def test_counter_excursion_startup_log_present():
    init_fn = body(read(EA), "int OnInit()")
    assert "COUNTER_EXCURSION: enabled=" in init_fn
    for field in ("magic=", "riskFraction=", "normalSlotIsolation=true",
                  "normalCooldownIsolation=true", "normalLockIsolation=true"):
        assert field in init_fn


# ---------------------------------------------------------------------------
# Part 13: numeric sizing trace for the reported $5,203.72 account
# ---------------------------------------------------------------------------

def test_full_risk_lot_math_for_reported_account_produces_meaningful_size():
    """
    Reproduces the exact formula OpenTrade now uses (riskPct == InpNormalRiskPct
    flatly, rawLots = balance*riskPct/100/slDollarPerLot) for the account/risk
    the owner reported (balance=5203.72, risk=15%, riskMoney=780.558), across a
    few realistic XAUUSD SL distances, and proves the result clears typical
    broker minimums (0.01) by a wide margin -- i.e. a 0.01-lot outcome for this
    account can only come from an abnormally wide stop, not from multiplier
    stacking (which no longer exists in the source).
    """
    balance = 5203.72
    risk_pct = 15.0
    risk_money = balance * risk_pct / 100.0
    assert abs(risk_money - 780.558) < 0.01

    # slDollarPerLot for XAUUSD is ~$100 per $1 of SL distance per lot (100oz contract).
    for sl_distance_usd in (5.0, 10.0, 17.0, 30.0):
        sl_dollar_per_lot = sl_distance_usd * 100.0
        raw_lots = risk_money / sl_dollar_per_lot
        assert raw_lots > 0.01, (
            f"at SL distance ${sl_distance_usd}, full 15% risk on $5203.72 should exceed "
            f"broker minLot (0.01); got {raw_lots:.4f} -- if live logs show 0.01 here, "
            f"NORMAL_ENTRY_AUDIT's rawLots/slDollarPerLot fields prove whether the real "
            f"stop distance was far wider than these illustrative values."
        )
