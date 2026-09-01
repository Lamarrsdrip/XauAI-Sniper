from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.20.1.mq5"
EA_BACKEND = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path):
    return path.read_text(encoding="utf-8", errors="ignore")


def section(text, start, end):
    return text[text.index(start):text.index(end, text.index(start))]


def timing_fn(ea):
    return section(ea, "bool XAU_TimingEngineConfirmsEntry(int dir, string setup, string grade, double sizeMulti, double atr)",
                   "void XAU_CheckPendingOpportunityRecovery()")


def open_trade_fn(ea):
    return section(ea, "bool OpenTrade(int signal, double atr, string reason, double sizeMulti",
                   "void LogExit(ulong ticket, string dir, double openPx, double closePx,")


def report_fn(ea):
    return section(ea, "void XAU_ReportDelayOutcome(ulong posId, TradeBrainOpen &r, double profit,",
                   "void XAU_PostTradeConsciousAnalysis(TradeBrainOpen &r, double closePrice, double profit,")


def test_v6201_identity_and_synced_backend():
    ea = read(EA)
    assert '#property version   "6.200"' in ea
    assert '#define XAUAI_EA_VERSION "v6.20.1"' in ea
    assert '#define XAUAI_EA_VERSION_NUM "6.20.1"' in ea
    assert read(EA) == read(EA_BACKEND)


def test_no_strategy_change_only_new_structs_and_telemetry_calls():
    # The core decision logic added in v6.20.0 (delay window, cancel reasons,
    # A+ bypass) must be untouched -- only mailbox writes were added around it.
    ea = read(EA)
    fn = timing_fn(ea)
    assert "if(movedInFavor > g_pendingEntryConfirm.atr * InpCancelIfPriceMovedTooFarATR)" in fn
    assert "bool aPlusBypassAllowed = (grade != \"A+\" || InpAllowImmediateAPlusMomentum);" in fn
    assert "double delaySec = XAU_EffectiveM5EntryDelaySec();" in fn


def test_mailbox_struct_and_all_three_return_true_paths_populate_it():
    ea = read(EA)
    assert "struct XAU_LastEntryTimingDecision" in ea
    assert "XAU_LastEntryTimingDecision g_lastEntryTimingDecision;" in ea
    fn = timing_fn(ea)
    # Three distinct entry reasons, one per return-true path.
    assert '"IMMEDIATE_APLUS_MOMENTUM"' in fn
    assert '"IMMEDIATE_CLEAN_EVIDENCE"' in fn
    assert 'g_lastEntryTimingDecision.entryReasonText    = "M5_ENTRY_DELAY_CONFIRMED";' in fn
    assert 'g_lastEntryTimingDecision.entryReasonText    = "BAR_BASED_CONFIRMED";' in fn
    # Every write sets valid=true.
    assert fn.count("g_lastEntryTimingDecision.valid              = true;") == 3


def test_mailbox_consumed_inside_open_trade_and_cleared_by_caller():
    ea = read(EA)
    ot = open_trade_fn(ea)
    assert "if(g_lastEntryTimingDecision.valid)" in ot
    assert "XAU_RecordDelayOutcome(openedPosId," in ot
    # Consumption must happen AFTER XAU_BrainRecordOpen, using the real posId.
    brain_idx = ot.index("XAU_BrainRecordOpen(openedPosId")
    consume_idx = ot.index("if(g_lastEntryTimingDecision.valid)")
    assert brain_idx < consume_idx
    # Caller-side unconditional clear, immediately after the OpenTrade call.
    call_site = read(EA)
    call_site = call_site[call_site.index("bool tradeOpened = OpenTrade(signal, bufATR[1], setupName"):]
    call_site = call_site[:call_site.index("if(tradeOpened)") + 20]
    assert "g_lastEntryTimingDecision.valid = false;" in call_site


def test_re_entry_caller_also_clears_the_mailbox():
    # Independent-audit finding: XAU_TimingEngineConfirmsEntry has a SECOND
    # caller (CheckReEntryOpportunity, the RE_ENTRY path) that can also set
    # the mailbox -- the first pass only cleared it at the main-scan caller,
    # leaving it dangling on every RE_ENTRY attempt and risking a later,
    # unrelated OpenTrade call (recovery/force-open) wrongly consuming stale
    # RE_ENTRY data and corrupting the aggregate DELAY_HELPED/HURT stats.
    ea = read(EA)
    assert 'if(!XAU_TimingEngineConfirmsEntry(lastClose.dir, "RE_ENTRY", "A", InpReEntrySize, bufATR[1]))' in ea
    re_entry_fn = section(ea, 'if(!XAU_TimingEngineConfirmsEntry(lastClose.dir, "RE_ENTRY"',
                          'lastSignalDir = lastClose.dir;')
    call_site = ea[ea.index('bool reEntryOpened = OpenTrade(lastClose.dir, bufATR[1], "RE_ENTRY", InpReEntrySize);'):]
    call_site = call_site[:call_site.index("if(reEntryOpened)") + 20]
    assert "g_lastEntryTimingDecision.valid = false;" in call_site


def test_no_other_callers_of_timing_engine_exist_unaudited():
    # Confirms the complete, current set of callers -- if a third caller is
    # ever added, this test should be revisited to confirm it also clears
    # the mailbox (or deliberately never sets it, like force-open/recovery).
    ea = read(EA)
    call_sites = [ln for ln in ea.splitlines() if "XAU_TimingEngineConfirmsEntry(" in ln
                  and "bool XAU_TimingEngineConfirmsEntry(int dir" not in ln
                  and not ln.strip().startswith("//")]
    assert len(call_sites) == 2, call_sites


def test_delay_outcome_array_bounded_and_keyed_by_posid():
    ea = read(EA)
    assert "#define XAU_DELAY_OUTCOME_MAX 60" in ea
    assert "int XAU_FindDelayOutcome(ulong posId)" in ea
    fn = section(ea, "void XAU_RecordDelayOutcome(ulong posId,", "// v6.20.1 aggregate counters")
    assert "if(n >= XAU_DELAY_OUTCOME_MAX)" in fn
    assert "if(posId == 0) return;" in fn


def test_close_time_report_computes_estimated_instant_entry_and_verdict():
    ea = read(EA)
    fn = report_fn(ea)
    assert "int idx = XAU_FindDelayOutcome(posId);" in fn
    assert "if(idx < 0) return;" in fn
    # Estimate formula: linear shift by price improvement, broker-aware conversion.
    assert "double dollarShift = XAU_MoneyPerLotForDistance(MathAbs(d.priceImprovement)) * r.lots *" in fn
    assert "double estInstantMAE = worstFloatingPnl - dollarShift;" in fn
    assert "double estInstantMFE = bestFloatingPnl  - dollarShift;" in fn
    assert "double estInstantPL  = profit           - dollarShift;" in fn
    # Verdict logic covers all four cases.
    for verdict in ["NO_DELAY", "DELAY_HELPED", "DELAY_HURT", "DELAY_NEUTRAL"]:
        assert f'verdict = "{verdict}"' in fn


def test_report_call_wired_at_close_after_real_mae_mfe_are_known():
    ea = read(EA)
    assert "XAU_ReportDelayOutcome(posId, brainRec, profit, bestFloatingPnl, worstFloatingPnl);" in ea
    close_block = ea[ea.index('XAU_AppendTradeBrain("CLOSE", brainRec, dPrice, profit, worstFloatingPnl,'):]
    close_block = close_block[:close_block.index("XAU_WriteLearningReport();") + 30]
    assert "XAU_ReportDelayOutcome(posId, brainRec, profit, bestFloatingPnl, worstFloatingPnl);" in close_block


def test_all_requested_telemetry_fields_present_in_log_line():
    ea = read(EA)
    fn = report_fn(ea)
    for field in ["OriginalSignalTime=%s", "OriginalSignalPrice=%.2f", "DelayedEntryTime=%s",
                  "DelayedEntryPrice=%.2f", "EntryDelaySeconds=%.0f", "PriceImprovementOrWorsening=%.2f",
                  "EntryReason=%s", "Ticket=%I64u", "ActualMAE=$%.2f", "ActualMFE=$%.2f", "ActualPL=$%.2f",
                  "EstimatedInstantEntryMAE=$%.2f", "EstimatedInstantEntryMFE=$%.2f",
                  "EstimatedInstantEntryPL=$%.2f", "Verdict=%s"]:
        assert field in fn


def test_report_extended_with_aggregate_proof_section():
    ea = read(EA)
    rpt = section(ea, "void XAU_WriteLearningReport()", "string XAU_BlockedMemoryFile()")
    assert "Delayed-Entry Outcome (closed trades, v6.20.1)" in rpt
    assert "g_delayOutcomeHelpedCount" in rpt
    assert "g_delayOutcomeHurtCount" in rpt
    assert "Avg actual MAE (with delay)" in rpt
    assert "Avg ESTIMATED instant-entry MAE" in rpt


def test_estimate_explicitly_labeled_not_a_resimulation():
    ea = read(EA)
    fn = report_fn(ea)
    assert "not a re-simulation" in fn


def test_dollar_shift_reuses_broker_aware_helper_not_hardcoded_constant():
    # Independent-audit finding: a hardcoded $100/lot (100oz contract)
    # constant would silently diverge from the file's own precision under a
    # broker-specific contract size or non-standard account currency. Must
    # reuse the same OrderCalcProfit-based helper used elsewhere in the file.
    ea = read(EA)
    fn = report_fn(ea)
    assert "XAU_MoneyPerLotForDistance(MathAbs(d.priceImprovement))" in fn
    assert "* r.lots *" in fn
    assert "d.priceImprovement * r.lots * 100.0" not in fn
