from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
EA_ROOT = ROOT / "XAUUSD_AI_Sniper_EA_v6.11.0.mq5"


def read() -> str:
    return EA_ROOT.read_text(encoding="utf-8")


def section(ea: str, start: str, end: str) -> str:
    return ea[ea.index(start):ea.index(end, ea.index(start))]


def test_adaptive_trade_context_inputs_and_helpers_exist():
    ea = read()

    for token in (
        "InpThesisHoldRunnerEnable",
        "InpThesisHoldMinHoldMinutes",
        "InpThesisHoldMaxGivebackPct",
        "InpThesisHoldReentryCooldownMin",
        "XAU_TRADE_CONTEXT_STATE",
        "XAU_CONTEXT_STRONG_TREND",
        "XAU_CONTEXT_NORMAL_PULLBACK",
        "XAU_CONTEXT_WEAK_TRADE",
        "XAU_CONTEXT_EXPLOSIVE_MOVE",
        "XAU_CONTEXT_TREND_EXHAUSTION",
        "XAU_ContextStateName",
        "XAU_ClassifyTradeContext",
        "XAU_ContextAllowedGivebackPct",
        "XAU_ContextLockPct",
        "XAU_ContextShouldTakePartial",
        "XAU_AdaptiveReentryWaitMin",
        "XAU_ThesisHoldRunnerAllowed",
        "HOLD_RUNNER_THESIS_VALID",
        "THESIS_HOLD_PULLBACK",
        "ADAPTIVE_CONTEXT_STRONG_TREND",
        "ADAPTIVE_CONTEXT_EXPLOSIVE_LOCK",
        "ADAPTIVE_CONTEXT_WEAK_TRADE",
        "ADAPTIVE_CONTEXT_EXHAUSTION_EXIT",
    ):
        assert token in ea


def test_smart_exit_classifies_context_before_partial_or_floor_decisions():
    ea = read()
    smart_exit = section(ea, "bool XAU_SmartExit3Layer", "//+------------------------------------------------------------------+\n//| v6.4.8")

    assert "XAU_TRADE_CONTEXT_STATE contextState = XAU_ClassifyTradeContext" in smart_exit
    assert smart_exit.index("XAU_ClassifyTradeContext") < smart_exit.index("XAU_ContextLockPct(contextState")
    assert smart_exit.index("XAU_ClassifyTradeContext") < smart_exit.index("XAU_ContextShouldTakePartial(contextState")
    assert "bool thesisHoldAllowed = XAU_ThesisHoldRunnerAllowed" in smart_exit
    assert "contextState" in smart_exit[smart_exit.index("bool thesisHoldAllowed = XAU_ThesisHoldRunnerAllowed"):smart_exit.index("if(profitUSD <= 0.0")]
    assert "XAU_ContextAllowedGivebackPct(contextState" in smart_exit
    assert "XAU_ContextLockPct(contextState" in smart_exit
    assert "XAU_ContextShouldTakePartial(contextState" in smart_exit
    assert "HOLD_RUNNER_THESIS_VALID" in smart_exit
    assert "floorBroken && !thesisHoldAllowed" in smart_exit
    assert "profitUSD <= 0.0 && !thesisHoldAllowed" in smart_exit
    assert "if(floorBroken || !runnerClean || structureConfirmedBroken || !floorAlreadyProtected)" not in smart_exit


def test_partials_are_context_gated_not_automatic_on_strong_profit():
    ea = read()
    smart_exit = section(ea, "bool XAU_SmartExit3Layer", "//+------------------------------------------------------------------+\n//| v6.4.8")
    partial_helper = section(ea, "bool XAU_ContextShouldTakePartial", "bool XAU_ThesisHoldRunnerAllowed")

    assert "bool contextPartial = XAU_ContextShouldTakePartial(contextState" in smart_exit
    assert "partialsAllowed && contextPartial && floorAlreadyProtected" in smart_exit
    assert "partialsAllowed && floorAlreadyProtected && profitUSD >= strongProfitUSD" not in smart_exit
    assert "case XAU_CONTEXT_EXPLOSIVE_MOVE" in partial_helper
    assert "case XAU_CONTEXT_TREND_EXHAUSTION" in partial_helper
    assert "case XAU_CONTEXT_STRONG_TREND" in partial_helper
    assert "return false;" in partial_helper[partial_helper.index("case XAU_CONTEXT_STRONG_TREND"):]


def test_context_changes_giveback_and_lock_rules_adaptively():
    ea = read()
    giveback = section(ea, "double XAU_ContextAllowedGivebackPct", "double XAU_ContextLockPct")
    lock = section(ea, "double XAU_ContextLockPct", "bool XAU_ContextShouldTakePartial")

    assert "XAU_CONTEXT_STRONG_TREND" in giveback
    assert "XAU_CONTEXT_EXPLOSIVE_MOVE" in giveback
    assert "XAU_CONTEXT_WEAK_TRADE" in giveback
    assert "XAU_CONTEXT_TREND_EXHAUSTION" in giveback
    assert "MathMin(baseAllowedGiveback" in giveback
    assert "MathMax(baseAllowedGiveback" in giveback

    assert "XAU_CONTEXT_EXPLOSIVE_MOVE" in lock
    assert "XAU_CONTEXT_TREND_EXHAUSTION" in lock
    assert "XAU_CONTEXT_STRONG_TREND" in lock
    assert "70.0" in lock
    assert "60.0" in lock


def test_profit_floor_respects_thesis_valid_pullbacks_before_market_close():
    ea = read()
    floor = section(ea, "bool XAU_ProtectPeakProfitFloor", "// v4.5.4")

    assert "XAU_TRADE_CONTEXT_STATE contextState = XAU_ClassifyTradeContext" in floor
    assert "XAU_ContextLockPct(contextState" in floor
    assert "XAU_ContextAllowedGivebackPct(contextState" in floor
    assert "bool thesisHoldAllowed = XAU_ThesisHoldRunnerAllowed" in floor
    assert "contextState" in floor[floor.index("bool thesisHoldAllowed = XAU_ThesisHoldRunnerAllowed"):]
    assert "THESIS_HOLD_PULLBACK" in floor
    assert "if(thesisHoldAllowed && (floorBroken || severeGiveback || profit <= 0.0))" in floor
    assert "InpProtectedPeakCloseOnFloorBreak && !thesisHoldAllowed" in floor


def test_reentry_memory_wait_is_adaptive_to_macro_context():
    ea = read()
    adaptive_wait = section(ea, "int XAU_AdaptiveReentryWaitMin", "void STI_Update")
    sti_update = section(ea, "void STI_Update()", "void STI_AfterProfitableClose")
    sti_after = section(ea, "void STI_AfterProfitableClose", "int FindPeakIdx")

    assert "g_sti.macroDir == dir" in adaptive_wait
    assert "g_sti.macroStrength" in adaptive_wait
    assert "InpThesisHoldReentryCooldownMin / 2" in adaptive_wait
    assert "XAU_AdaptiveReentryWaitMin(g_sti.lastProfitDir)" in sti_update
    assert "XAU_AdaptiveReentryWaitMin(dir)" in sti_after


def test_bad_entry_fast_cut_is_opt_in_not_default_gold_noise_behavior():
    ea = read()
    inputs = section(ea, 'input group "=== EQUITY GROWTH GUARD', 'input int    InpMaxOpenTrades')
    guard = section(ea, "bool XAU_GrowthGuardManagePosition", "bool XAU_GrowthGuardCanPyramid")

    assert re.search(r"InpGrowthBadEntryMaxMinutes\s*=\s*0", inputs)
    assert re.search(r"InpGrowthBadEntryLossEquityPct\s*=\s*0\.0", inputs)
    assert "bool badEntryGuardOn = (InpGrowthBadEntryMaxMinutes > 0 && InpGrowthBadEntryLossEquityPct > 0.0)" in guard
    assert "if(badEntryGuardOn && earlyAdverse" in guard
    assert "if(badEntryGuardOn && thesisFailing && profit < 0.0" in guard
