from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.12.0.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def body(ea: str, start: str, end: str = "\n}\n") -> str:
    pos = ea.index(start)
    return ea[pos : ea.index(end, pos) + len(end)]


def test_source_and_backend_copy_stay_synced():
    assert read(EA) == read(BACKEND_EA)


def test_ttm_record_carries_full_tri_state():
    ea = read(EA)
    struct = body(ea, "struct TradeTTMRecord")
    for field in ("triActive", "triEnteredAt", "triWorstAdversePct", "triWorstAdverseUSD",
                  "triMomentumAtEntry", "triTrendAlignedAtEntry", "triAIConfAtEntry",
                  "triHTFAtEntry", "triClassification", "triClassifiedAt", "triExitTaken"):
        assert field in struct


def test_recovery_mode_is_entered_not_closed_on_near_sl():
    ea = read(EA)
    fn = body(ea, "int XAU_TRI_Evaluate(int ttmIdx, ulong ticket, bool isBuy, double openPx, double curPrice,")

    # entering recovery mode must never itself close/reduce the position —
    # only sets state and returns MONITOR
    enter_block = fn[fn.index("if(!g_ttm[ttmIdx].triActive)"):fn.index("// ---- STEP 2")]
    assert "SafePositionClose" not in enter_block
    assert "SafePositionClosePartial" not in enter_block
    assert "return TRI_ACTION_MONITOR;" in enter_block
    assert "g_ttm[ttmIdx].triActive              = true;" in enter_block


def test_failed_recovery_never_forces_an_early_exit():
    ea = read(EA)
    fn = body(ea, "int XAU_TRI_Evaluate(int ttmIdx, ulong ticket, bool isBuy, double openPx, double curPrice,")
    failed_block = fn[fn.index("if(!reclaimedBreakeven)"):fn.index("// ---- STEP 3")]

    assert '"FAILED"' in failed_block
    assert "SafePositionClose" not in failed_block
    assert "SafePositionClosePartial" not in failed_block
    assert "return TRI_ACTION_MONITOR;" in failed_block


def test_weak_exit_is_only_ever_reachable_at_breakeven_or_better():
    ea = read(EA)
    fn = body(ea, "int XAU_TRI_Evaluate(int ttmIdx, ulong ticket, bool isBuy, double openPx, double curPrice,")

    # the classification block (where WEAK_EXIT is decided) only runs after
    # reclaimedBreakeven — i.e. profit >= 0.0 — was already confirmed true
    assert "bool reclaimedBreakeven = (profit >= 0.0);" in fn
    assert fn.index("bool reclaimedBreakeven = (profit >= 0.0);") < fn.index("if(recoveryScore < weakFloor)")
    assert "if(!reclaimedBreakeven)" in fn
    assert fn.index("if(!reclaimedBreakeven)") < fn.index("if(recoveryScore < weakFloor)")


def test_strong_recovery_never_triggers_any_close():
    ea = read(EA)
    fn = body(ea, "int XAU_TRI_Evaluate(int ttmIdx, ulong ticket, bool isBuy, double openPx, double curPrice,")
    strong_block = fn[fn.index('if(recoveryScore >= strongThreshold)'):fn.index("if(recoveryScore < weakFloor)")]
    assert "SafePositionClose" not in strong_block
    assert "return TRI_ACTION_STRONG_CONTINUE;" in strong_block


def test_ambiguous_reclaim_does_not_act_either_way():
    ea = read(EA)
    fn = body(ea, "int XAU_TRI_Evaluate(int ttmIdx, ulong ticket, bool isBuy, double openPx, double curPrice,")
    # the final fallthrough (between weak floor and strong threshold) must
    # not close or classify definitively — matches "never exit solely
    # because price returned to breakeven"
    tail = fn[fn.index("if(recoveryScore < weakFloor)"):]
    ambiguous_tail = tail[tail.index("}\n") + 2:]
    assert "SafePositionClose" not in ambiguous_tail
    assert "return TRI_ACTION_MONITOR;" in ambiguous_tail


def test_weak_exit_wired_into_manage_positions_and_only_closes_at_be_or_better():
    ea = read(EA)
    manage = body(ea, "void ManagePositions()", "END TRADE THESIS MONITOR")
    assert "XAU_TRI_Evaluate(ttmIdx, ticket, isBuy, openPx, curPrice," in manage
    assert "if(triAction == TRI_ACTION_WEAK_EXIT)" in manage
    assert 'SafePositionClose(ticket, "TRI_WEAK_RECOVERY_EXIT")' in manage
    assert "XAU_TRI_RecordReEntryWatch(isBuy ? 1 : -1, g_ttm[ttmIdx].setupName, curPrice, g_ttm[ttmIdx].invalidationPrice);" in manage


def test_smart_reentry_requires_a_fresh_trigger_not_a_hard_block():
    ea = read(EA)
    assert "bool XAU_TRI_FreshTriggerPresent(int dir)" in ea
    fresh_fn = body(ea, "bool XAU_TRI_FreshTriggerPresent(int dir)")
    for trigger in ("pullbackIntoValue", "bosConfirmed", "obReaction", "fvgReaction", "strongMomentumCandle"):
        assert trigger in fresh_fn

    gate = body(ea, "if(XAU_TRI_InReEntryWatch(signal, triWatchSetup) && !XAU_TRI_FreshTriggerPresent(signal))", "\n      }\n   }\n")
    assert "XAU_ModeAllowsSoftBlockWarning()" in gate  # respects soft-block-warning mode like every other gate
    assert 'grade = "SKIP";' in gate


def test_tri_never_bypasses_the_loss_close_firewall():
    ea = read(EA)
    # TRI's only close path (TRI_WEAK_RECOVERY_EXIT) must NOT be added to the
    # emergency allowlist — it should never need to be, since it only closes
    # at profit >= 0, which the firewall already always allows.
    emergency = body(ea, "bool XAU_EmergencyLossCloseAllowed(string ctx)")
    assert "TRI_WEAK_RECOVERY_EXIT" not in emergency


def test_trade_thesis_status_surfaces_recovery_mode():
    ea = read(EA)
    fn = body(ea, "void XAU_LogTradeThesisStatus(ulong ticket, bool isBuy, double openPx, double curSL,")
    assert 'recoveryMode = "ACTIVE";' in fn
    assert 'recoveryMode = "FAILED_NO_FORCED_EXIT";' in fn
    assert "recoveryMode=%s recoveryWorstPct=%.0f recoveryClassification=%s" in fn


def test_tri_thresholds_are_adaptive_inputs_not_hardcoded():
    ea = read(EA)
    for inp in ("InpTRI_Enable", "InpTRI_NearSLPct", "InpTRI_StrongThreshold",
                "InpTRI_WeakFloor", "InpTRI_FailedAfterBars", "InpTRI_AdaptThresholds",
                "InpTRI_ReEntryTriggerBars"):
        assert inp in ea

    fn = body(ea, "int XAU_TRI_Evaluate(int ttmIdx, ulong ticket, bool isBuy, double openPx, double curPrice,")
    # regime-aware threshold adjustment, not one fixed number
    assert "if(CleanChoppyRegime()) strongThreshold += 8.0;" in fn
    assert "InpTRI_AdaptThresholds ? g_triAdaptStrongThreshold : InpTRI_StrongThreshold" in fn
