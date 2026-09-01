from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.20.0.mq5"
EA_BACKEND = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path):
    return path.read_text(encoding="utf-8", errors="ignore")


def section(text, start, end):
    return text[text.index(start):text.index(end, text.index(start))]


def timing_fn(ea):
    return section(ea, "bool XAU_TimingEngineConfirmsEntry(int dir, string setup, string grade, double sizeMulti, double atr)",
                   "void XAU_CheckPendingOpportunityRecovery()")


def test_v6200_identity_and_synced_backend():
    ea = read(EA)
    assert '#property version   "6.199"' in ea
    assert '#define XAUAI_EA_VERSION "v6.20.0"' in ea
    assert '#define XAUAI_EA_VERSION_NUM "6.20.0"' in ea
    assert read(EA) == read(EA_BACKEND)


def test_signal_timeframe_unchanged_m5():
    # Signal detection must still come from M5 -- only execution timing changed.
    ea = read(EA)
    fn = timing_fn(ea)
    assert 'double signalPrice = iClose(Symbol(), PERIOD_M5, 1);' in fn
    assert 'datetime nowCandle = iTime(Symbol(), PERIOD_M5, 0);' in fn


def test_new_inputs_present_with_bounded_defaults():
    ea = read(EA)
    assert "input bool   InpUseM5EntryDelay             = true;" in ea
    assert "input int    InpM5EntryDelaySeconds         = 90;" in ea
    assert "input int    InpM5EntryDelayMinSeconds      = 60;" in ea
    assert "input int    InpM5EntryDelayMaxSeconds      = 120;" in ea
    assert "input bool   InpAllowImmediateAPlusMomentum = true;" in ea
    assert "input double InpCancelIfPriceMovedTooFarATR = 1.00;" in ea


def test_delay_is_wall_clock_not_next_bar():
    # "This is NOT wait for the next M5 bar" -- must be a seconds-based check
    # against firstSeenTime, clamped into [min,max] via the shared helper, not
    # a bar-boundary compare.
    ea = read(EA)
    fn = timing_fn(ea)
    assert "double elapsedSec = (double)(TimeCurrent() - g_pendingEntryConfirm.firstSeenTime);" in fn
    assert "double delaySec = XAU_EffectiveM5EntryDelaySec();" in fn
    assert "if(elapsedSec < delaySec)" in fn


def test_1_valid_candidate_stored_and_executed_after_delay_if_still_valid():
    ea = read(EA)
    fn = timing_fn(ea)
    # Storage on first detection
    assert "g_pendingEntryConfirm.active          = true;" in fn
    assert "g_pendingEntryConfirm.firstSeenTime   = TimeCurrent();" in fn
    # Execution path after the window elapses with no cancel reason
    assert 'if(StringLen(cancelReason) > 0)' in fn
    confirmed_idx = fn.index("M5_ENTRY_DELAY_CONFIRMED")
    return_true_idx = fn.index("return true;", confirmed_idx)
    assert return_true_idx > confirmed_idx  # confirms the true-return follows the confirmed log


def test_2_candidate_cancels_if_thesis_structure_flips_during_delay():
    ea = read(EA)
    fn = timing_fn(ea)
    assert 'bool structureFlipped = (dir == 1 && tcls.freshStructureBias == "BEARISH") ||' in fn
    assert '(dir == -1 && tcls.freshStructureBias == "BULLISH");' in fn
    assert 'cancelReason = StringFormat("STRUCTURE_FLIPPED freshStructureBias=%s now opposes %s", tcls.freshStructureBias, dirStr);' in fn


def test_3_candidate_cancels_if_price_ran_too_far_chase_and_tags_missed_trade():
    ea = read(EA)
    fn = timing_fn(ea)
    assert "if(movedInFavor > g_pendingEntryConfirm.atr * InpCancelIfPriceMovedTooFarATR)" in fn
    assert "PRICE_RAN_TOO_FAR_CHASE" in fn
    assert "MISSED_TRADE" in fn
    assert "moveATR >= 2.0" in fn


def test_4_no_stale_price_open_trade_computes_fresh_every_call():
    # The delay mechanism must not pass a cached/stale price into OpenTrade --
    # it only returns true/false; the caller re-fetches bufATR[1] fresh and
    # OpenTrade() itself computes entry/SL/TP/lot from current market data.
    ea = read(EA)
    fn = timing_fn(ea)
    assert "double curPriceNow = (dir == 1) ? SymbolInfoDouble(Symbol(), SYMBOL_ASK) : SymbolInfoDouble(Symbol(), SYMBOL_BID);" in fn
    # The function returns a bool, never a price/SL/TP override -- confirms
    # OpenTrade remains the sole authority for fresh order parameters.
    assert "bool XAU_TimingEngineConfirmsEntry(int dir, string setup, string grade, double sizeMulti, double atr)" in ea
    call_site = ea[ea.index("if(!XAU_TimingEngineConfirmsEntry(signal, setupName, grade, finalSzMult, bufATR[1]))"):]
    call_site = call_site[:call_site.index("bool tradeOpened = OpenTrade(") + 200]
    assert "bool tradeOpened = OpenTrade(signal, bufATR[1], setupName" in call_site


def test_5_a_plus_momentum_can_bypass_delay_when_configured():
    ea = read(EA)
    fn = timing_fn(ea)
    assert 'bool aPlusBypassAllowed = (grade != "A+" || InpAllowImmediateAPlusMomentum);' in fn
    assert "if(tcls.immediateConfirm && aPlusBypassAllowed)" in fn
    # And must be capable of NOT bypassing when the flag is off for A+.
    assert "if(tcls.immediateConfirm && !aPlusBypassAllowed)" in fn
    assert "routing through M5 entry delay anyway" in fn


def test_6_delayed_entry_logs_original_vs_final_details():
    ea = read(EA)
    fn = timing_fn(ea)
    for field in ["OriginalSignalTime=%s", "OriginalSignalPrice=%.2f", "DelayedEntryTime=%s",
                  "DelayedEntryPrice=%.2f", "EntryDelaySeconds=%.0f",
                  "PriceImprovementOrWorsening=%.2f", "ThesisStillValid=YES"]:
        assert field in fn
    cancel_fields = ["CancelReason=%s", "OriginalSignalTime=%s", "OriginalSignalPrice=%.2f",
                      "EntryDelaySeconds=%.0f", "ThesisStillValid=NO"]
    for field in cancel_fields:
        assert field in fn


def test_disabling_delay_restores_original_bar_based_behavior_unchanged():
    ea = read(EA)
    fn = timing_fn(ea)
    assert "InpUseM5EntryDelay=false: original next-M5-bar wait, byte-for-byte" in fn
    assert "nowCandle == g_pendingEntryConfirm.firstSeenCandle + PeriodSeconds(PERIOD_M5));" in fn


def test_hard_safety_not_duplicated_inside_timing_function():
    # Margin/broker/risk checks must remain OpenTrade()'s sole responsibility --
    # the timing function should not itself call OrderSend/OrderCalcMargin.
    ea = read(EA)
    fn = timing_fn(ea)
    assert "OrderSend" not in fn
    assert "OrderCalcMargin" not in fn


def test_delay_seconds_normalized_against_swapped_min_max_input():
    # Independent-audit finding: without normalizing Min/Max order first, a
    # misconfigured owner input (Min > Max) silently produced a fixed,
    # undocumented delay regardless of InpM5EntryDelaySeconds. One shared
    # helper now normalizes bounds before clamping, used at every call site.
    ea = read(EA)
    assert "double XAU_EffectiveM5EntryDelaySec()" in ea
    fn = section(ea, "double XAU_EffectiveM5EntryDelaySec()", "bool XAU_TimingEngineConfirmsEntry")
    assert "double lo = MathMin((double)InpM5EntryDelayMinSeconds, (double)InpM5EntryDelayMaxSeconds);" in fn
    assert "double hi = MathMax((double)InpM5EntryDelayMinSeconds, (double)InpM5EntryDelayMaxSeconds);" in fn
    assert "return MathMax(lo, MathMin(hi, (double)InpM5EntryDelaySeconds));" in fn
    # No more duplicated inline clamp expressions inside the timing function --
    # both call sites must use the shared helper instead.
    timing = timing_fn(ea)
    assert "XAU_EffectiveM5EntryDelaySec()" in timing
    assert "MathMax((double)InpM5EntryDelayMinSeconds," not in timing


def test_report_extended_with_m5_delay_counters():
    ea = read(EA)
    rpt = section(ea, "void XAU_WriteLearningReport()", "string XAU_BlockedMemoryFile()")
    assert "M5 Entry Delay (Phase B, v6.20.0)" in rpt
    assert "g_m5DelayConfirmedCount" in rpt
    assert "g_m5DelayCancelledCount" in rpt
