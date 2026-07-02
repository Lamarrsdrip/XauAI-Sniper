from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.7.0.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def body(ea: str, start: str, end: str = "\n}\n") -> str:
    pos = ea.index(start)
    return ea[pos : ea.index(end, pos) + len(end)]


def test_source_and_backend_copy_stay_synced():
    assert read(EA) == read(BACKEND_EA)


def test_ttm_record_stores_a_complete_entry_thesis():
    ea = read(EA)
    struct = body(ea, "struct TradeTTMRecord")
    for field in ("invalidationPrice", "targetZonePrice", "expectedTradeType",
                  "entryReasonFull", "entryRiskDollars"):
        assert field in struct

    record_fn = body(ea, "void TTM_RecordEntry(ulong posId, int signal, string setupName, string grade,")
    assert "r.invalidationPrice  = slPrice;" in record_fn
    assert "r.targetZonePrice    = tpPrice;" in record_fn
    assert "r.expectedTradeType  = XAU_ExpectedTradeTypeFromSetup(setupName);" in record_fn
    assert "r.entryReasonFull    = fullReason;" in record_fn

    # the call site must pass real SL/TP/reason/lots, not leave the new
    # fields defaulted to empty
    assert "TTM_RecordEntry(openedPosId, signal,\n                         lastSignalSetup, g_pendingBrainGrade,\n                         g_pendingBrainCombinedScore,\n                         ArraySize(bufRSI) >= 2 ? bufRSI[1] : 50.0,\n                         atr, price, sl, tp, reason, lots);" in ea


def test_smc_now_has_a_real_conflict_penalty_and_hard_block():
    ea = read(EA)
    assert "double SMC_GetConflictPenalty(int dir, bool &hardBlock, string &conflictReason)" in ea
    fn = body(ea, "double SMC_GetConflictPenalty(int dir, bool &hardBlock, string &conflictReason)")

    # must be a genuine cost, not another bonus — checks BOS-against, opposing
    # OB, and opposing FVG, and hard-blocks when 2+ conflicts stack
    assert "bool bosOpposes = (g_smc_bos_dir != 0 && g_smc_bos_dir != dir);" in fn
    assert "insideOpposingOB" in fn
    assert "insideOpposingFVG" in fn
    assert "if(conflicts >= 2)" in fn
    assert "hardBlock = true;" in fn

    # wired into the scoring pipeline as a real subtraction, not just logged
    pipeline = body(ea, "double smcBonus  = SMC_GetScoreBonus(signal, smcReason);", "g_smcConflictPenalty = smcPenalty;\n")
    assert "SMC_GetConflictPenalty(signal, smcHardBlock, smcConflictReason)" in pipeline
    assert "setupScore = MathMax(0.0, setupScore - smcPenalty);" in pipeline

    # and the hard block actually downgrades grade to SKIP (not just a log line)
    assert 'if(signal != 0 && grade != "SKIP" && g_smcHardBlockActive)' in ea
    assert 'grade = "SKIP";' in ea


def test_htf_trend_follow_requires_a_real_entry_trigger():
    ea = read(EA)
    fn_start = ea.index("// === SETUP 9: HTF TREND FOLLOW ===")
    fn_end = ea.index("s *= g_stratWeight[9];") + len("s *= g_stratWeight[9];")
    setup9 = ea[fn_start:fn_end]

    for trigger in ("pullbackIntoValue", "bosConfirmed", "obReaction", "fvgReaction", "strongMomentumCandle"):
        assert trigger in setup9
    assert "bool hasRealTrigger = pullbackIntoValue || bosConfirmed || obReaction || fvgReaction || strongMomentumCandle;" in setup9
    # both directions must require it, not just document it
    assert "if(dir == 1 && currentRegime != REGIME_DEAD && hasRealTrigger)" in setup9
    assert "if(dir == -1 && currentRegime != REGIME_DEAD && hasRealTrigger)" in setup9


def test_ai_committee_can_now_block_a_confidently_skipped_b_grade():
    ea = read(EA)
    assert "if(lastAIConfidence >= InpAIDirectorMinConf)" in ea
    assert "g_aiHardBlockB = true;" in ea
    assert '"B-CONFIDENT-SKIP-WARN"' in ea  # soft-block-warning mode still respected
    # weaker (non-confident) B-grade skips still only reduce, never block
    assert 'aiVerdictStr = "REDUCE";\n               sizeMulti = MathMin(sizeMulti, 0.50);' in ea


def test_aplus_floor_does_not_restore_size_on_smc_hard_conflict():
    ea = read(EA)
    fn = body(ea, "bool aiWeakConfirmReduced = (lta_aiVerdict ==", "PRE-OPENTRADE LOT AUDIT")
    assert "bool smcHardConflictReduced = g_smcHardBlockActive;" in fn
    assert "!aiWeakConfirmReduced && !smcHardConflictReduced" in fn
    assert "A+/A FLOOR SKIPPED (SMC-HARD-CONFLICT)" in fn


def test_protected_peak_floor_arm_threshold_is_adaptive_not_fixed_usd():
    ea = read(EA)
    fn = body(ea, "bool XAU_ProtectPeakProfitFloor(ulong ticket, bool isBuy, double openPx, double curPrice,")
    assert "input double InpProtectedPeakArmRMultiple" in ea
    assert "double armUSD_accountScaled = InpProtectedPeakMinUSD * AccountSizeRiskMultiplier();" in fn
    assert "double armUSD_rBased        = rDollars * InpProtectedPeakArmRMultiple;" in fn
    assert "if(peak < armUSD) return false;" in fn
    # the old unconditional fixed-USD-only gate must be gone
    assert "if(peak < InpProtectedPeakMinUSD || rDollars <= 0" not in fn


def test_loss_close_firewall_carveout_respects_no_limit_mode_default():
    ea = read(EA)
    fn = body(ea, "bool XAU_EmergencyLossCloseAllowed(string ctx)")
    assert "if(!XAU_NoLimitTradingModeActive())" in fn
    gate_pos = fn.index("if(!XAU_NoLimitTradingModeActive())")
    for gated in ("EARLY_CONVICTION_CUT", "CLEAN_INVALID", "STRUCTURE_FAILFAST", "TTM_STRUCTURAL_EXIT"):
        code_line = f'if(StringFind(c, "{gated}") >= 0) return true;'
        assert code_line in fn
        assert fn.index(code_line) > gate_pos

    # TTM close call site must pass the structural marker only when TTM's own
    # structural flag is set, not unconditionally
    assert 'SafePositionClose(ticket, ttmIsStructural ? "TTM_STRUCTURAL_EXIT" : "TTM_EXIT")' in ea


def test_ai_exit_close_is_overridden_by_healthy_structure():
    ea = read(EA)
    fn_start = ea.index('else if(v.action == -1 && profit > rDollars * 0.3)')
    fn_end = ea.index('else if(v.action == 0)', fn_start)
    block = ea[fn_start:fn_end]

    assert "bool structureStillHealthy = trendAlignedEA && !structureConfirmedEA && momentumScoreEA >= 2;" in block
    assert "AI_EXIT_OVERRIDDEN_BY_STRUCTURE" in block
    assert "SafeModifySL(ticket, protectSL, curTP, isBuy, curPrice, \"AI_EXIT_OVERRIDDEN_BY_STRUCTURE\")" in block
    # full close must be gated behind the else (structure NOT healthy) branch
    assert block.index("structureStillHealthy") < block.index('SafePositionClose(ticket, "AI_DIRECTOR_EXIT_CLOSE")')


def test_bot_decision_and_trade_thesis_status_logging_exist():
    ea = read(EA)
    assert "void XAU_LogBotDecision(string action, int direction, string setupName, string grade," in ea
    assert '"BOT_DECISION: time=%s action=%s direction=%s setup=%s grade=%s confidence=%d%% "' in ea

    assert "void XAU_LogTradeThesisStatus(ulong ticket, bool isBuy, double openPx, double curSL," in ea
    assert '"TRADE_THESIS_STATUS: ticket=%I64u state=%s type=%s peakProfit=%.2f currentProfit=%.2f "' in ea

    # actually wired into the live paths, not just defined
    assert "XAU_LogBotDecision(finalSzMult < originalGradeSizeMulti - 0.001 ? \"REDUCE_SIZE\" : \"ENTER\"," in ea
    assert "XAU_LogTradeThesisStatus(ticket, isBuy, openPx, curSL, lotsOpen, profit, peak);" in ea


def test_no_new_protective_or_restrictive_defaults_introduced_for_gold_mode():
    ea = read(EA)
    # this release must not silently tighten anything the user didn't ask for
    assert "input bool   InpNoLimitTradingMode = true;" in ea  # Codex's default untouched
    assert "input bool   InpProtectedPeakFloorEnable      = true;" in ea
    assert "input bool   InpSMC_Enable" in ea
