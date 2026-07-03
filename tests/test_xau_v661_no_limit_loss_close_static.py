from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.12.0.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def body(ea: str, start: str, end: str = "\n}\n") -> str:
    pos = ea.index(start)
    return ea[pos : ea.index(end, pos) + len(end)]


def test_v661_source_and_download_source_are_synced():
    assert read(EA) == read(BACKEND_EA)


def test_no_limit_mode_defaults_and_startup_log_are_explicit():
    ea = read(EA)

    assert "input bool   InpNoLimitTradingMode = true;" in ea
    assert "input bool   InpDisableAllDailyLocks = true;" in ea
    assert "input bool   InpNoDailyLimitMode = true;" in ea
    assert "return (InpNoLimitTradingMode || InpDisableAllDailyLocks || InpNoDailyLimitMode);" in ea
    assert "NO_LIMIT_RESOLVED:" in ea
    for token in (
        "NoLimitTradingMode=%s",
        "DailyGrowthLock=%s",
        "DailyProfitLock=%s",
        "DailyPause=%s",
        "Cooldown=%s",
        "StopForDay=%s",
        "ForceCloseByDailyLock=%s",
    ):
        assert token in ea


def test_no_limit_bypasses_daily_growth_lock_and_day_giveback_close_paths():
    ea = read(EA)
    growth_daily = body(ea, "bool XAU_GrowthDailyLockTriggered(string &why)")
    expectancy = body(ea, "bool ExpectancyDayGivebackGuard()")
    growth_manage = body(ea, "bool XAU_GrowthGuardManagePosition(")

    assert "if(XAU_NoLimitTradingModeActive())" in growth_daily
    assert "BotMonitorDecisionEvent(\"DAILY_LOCK_IGNORED\", \"OVERRIDE\"" in growth_daily
    assert "return false;" in growth_daily
    assert "if(XAU_NoLimitTradingModeActive()) return false;" in expectancy
    assert "if(!InpGrowthGuardEnable || XAU_NoLimitTradingModeActive()) return false;" in growth_manage
    assert "GROWTH_HARD_LOSS_EXIT BASKET" in growth_manage
    assert 'SafePositionClose(ticket, "GROWTH_BASKET_LOSS")' in growth_manage
    assert "if(!noLimitMode && InpGrowthGuardEnable)" in ea
    assert "if(!noLimitMode && ExpectancyDayGivebackGuard())" in ea


def test_no_limit_bypasses_pause_and_cooldown_arming():
    ea = read(EA)

    assert "if(!XAU_NoLimitTradingModeActive() && todayReEntryCount >= InpMaxReEntriesPerDay)" in ea
    assert "if(!XAU_NoLimitTradingModeActive() && lastTradeDir != 0" in ea
    assert "if(!noLimitMode && !entryExecutionBlocked && lastTradeClose > 0" in ea
    assert "if(!noLimitMode && !entryExecutionBlocked && IsInStreakPause())" in ea

    startup = body(ea, "string StartupCooldownReason()")
    assert "if(XAU_NoLimitTradingModeActive())" in startup
    assert "return \"\";" in startup

    growth_pause = body(ea, "void XAU_GrowthSetPause(int minutes, string reason)")
    assert "if(XAU_NoLimitTradingModeActive()) return;" in growth_pause

    register = body(ea, "void RegisterClosedTradeCooldown(bool wasWin, bool wasLoss, double profit)")
    assert "if(XAU_NoLimitTradingModeActive()) return;" in register

    streak = body(ea, "void RecordCloseForStreak(bool wasLoss)")
    assert "if(XAU_NoLimitTradingModeActive()) return;" in streak

    spread = body(ea, "string SpreadKillReason()")
    assert "if(!XAU_NoLimitTradingModeActive() && g_spreadSpikeUntil > 0" in spread


def test_negative_position_close_firewall_wraps_every_ea_close_path():
    ea = read(EA)
    firewall = body(ea, "bool XAU_LossCloseFirewallAllows(")
    safe_close = body(ea, "bool SafePositionClose(ulong ticket, string ctx = \"\")")
    safe_partial = body(ea, "bool SafePositionClosePartial(ulong ticket, double lots, string ctx = \"\")")
    close_all = body(ea, "void CloseAll(string reason = \"FORCE_CLOSE\")")

    assert "double pnl = PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);" in firewall
    assert "if(pnl >= 0.0) return true;" in firewall
    assert "if(XAU_EmergencyLossCloseAllowed(ctx)) return true;" in firewall
    assert "LOSS_CLOSE_BLOCKED" in firewall
    assert "XAU_PopPendingExitReason(posId);" in firewall
    assert "XAU_PopPendingExitReason(ticket);" in firewall

    assert "if(!XAU_LossCloseFirewallAllows(ticket, ctx, 0.0)) return false;" in safe_close
    assert "bool ok = trade.PositionClose(ticket);" in safe_close
    assert "if(!XAU_LossCloseFirewallAllows(ticket, ctx, lots)) return false;" in safe_partial
    assert "bool ok = trade.PositionClosePartial(ticket, lots);" in safe_partial
    assert "SafePositionClose(posInfo.Ticket(), reason)" in close_all

    assert ea.count("trade.PositionClose(ticket)") == 1
    assert ea.count("trade.PositionClosePartial(ticket, lots)") == 1


def test_loss_firewall_does_not_whitelist_normal_ea_exit_reasons():
    ea = read(EA)
    emergency = body(ea, "bool XAU_EmergencyLossCloseAllowed(string ctx)")

    for allowed in ("BROKER_SL", "STOP_OUT", "MARGIN", "EMERGENCY"):
        assert allowed in emergency

    # v6.7.0 ADAPTIVE ENTRY/EXIT ARBITER: EARLY_CONVICTION_CUT, CLEAN_INVALID,
    # STRUCTURE_FAILFAST and TTM_STRUCTURAL_EXIT are now recognized, but ONLY
    # inside an `if(!XAU_NoLimitTradingModeActive())` guard — confirmed by the
    # user as the resolution to a direct conflict with No-Limit Trading Mode's
    # "ride every trade to SL" default. No-Limit mode itself (default ON)
    # keeps its original, unconditional behavior for every one of these.
    assert "if(!XAU_NoLimitTradingModeActive())" in emergency
    gate_pos = emergency.index("if(!XAU_NoLimitTradingModeActive())")
    for gated in ("EARLY_CONVICTION_CUT", "CLEAN_INVALID", "STRUCTURE_FAILFAST", "TTM_STRUCTURAL_EXIT"):
        code_line = f'if(StringFind(c, "{gated}") >= 0) return true;'
        assert code_line in emergency
        assert emergency.index(code_line) > gate_pos, f"{gated} check must appear after the No-Limit-mode guard, not unconditionally"

    for blocked in (
        "AI_DIRECTOR_EXIT_CLOSE",
        "SMART_EXIT",
        "GROWTH_BASKET_LOSS",
        "GROWTH_DAILY_LOCK",
        "EA_MARKET_CLOSE",
        "NEWS_EXIT",
        "SESSION_EXIT",
        "COOLDOWN",
    ):
        assert blocked not in emergency

    # CLEAN_STAGNANT/CLEAN_STALE are deliberately excluded from the No-Limit-off
    # carve-out (regime/momentum alone isn't objective structural invalidation) —
    # confirm neither has its own recognized StringFind check, without banning
    # the words entirely (the code comments name them to explain the exclusion).
    for still_unguarded in ("CLEAN_STAGNANT", "CLEAN_STALE"):
        assert f'if(StringFind(c, "{still_unguarded}") >= 0) return true;' not in emergency


def test_closed_trade_reports_include_exact_close_audit_fields():
    ea = read(EA)
    json_writer = body(ea, "void XAU_IntelAppendJson(")
    csv_writer = body(ea, "void XAU_IntelAppend(string eventName, string decisionId, ulong posId, int dir,")

    for field in (
        "CloseReasonExact",
        "ClosedBy",
        "WasSLHit",
        "WasEAForcedClose",
        "FloatingProfitAtClose",
    ):
        assert field in json_writer
        assert field in csv_writer

    assert "TRADE-CLOSE-AUDIT" in ea
    assert "XAU_ClosedByField(true, closeReasonExact, \"EXIT\")" in ea
    assert "XAU_WasSLHitField(true, closeReasonExact)" in ea
    assert "XAU_WasEAForcedCloseField(true, closeReasonExact, closedBy)" in ea


def test_manual_closes_are_not_polluted_by_stale_ea_pending_reasons():
    ea = read(EA)
    resolver = body(ea, "string XAU_ResolveExitReason(ulong posId, ENUM_DEAL_REASON dealReason, double profit)")

    assert "DEAL_REASON_CLIENT" in resolver
    assert "DEAL_REASON_MOBILE" in resolver
    assert "DEAL_REASON_WEB" in resolver
    assert resolver.index("DEAL_REASON_CLIENT") < resolver.index("if(StringLen(pending) > 0)")
