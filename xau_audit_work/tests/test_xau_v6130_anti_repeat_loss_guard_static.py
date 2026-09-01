from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.14.0.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def body(ea: str, start: str, end: str = "\n}\n") -> str:
    pos = ea.index(start)
    return ea[pos : ea.index(end, pos) + len(end)]


def test_source_and_backend_copy_stay_synced():
    assert read(EA) == read(BACKEND_EA)


def test_same_direction_loss_streak_is_tracked_at_trade_close():
    ea = read(EA)
    assert "int      g_sameDirLossStreak  = 0;" in ea
    assert "int      g_lastLossDir        = 0;" in ea
    hook = body(ea, "int closedDir = (dirStr == \"BUY\") ? 1 : -1;", "\n   }\n")
    assert 'g_sameDirLossStreak = 0;' in hook
    assert 'g_sameDirLossStreak++;' in hook
    assert 'g_sameDirLossStreak = 1; g_lastLossDir = closedDir;' in hook
    assert "g_lastLossClosePx = dPrice;" in hook


def test_anti_repeat_loss_guard_is_adaptive_not_a_blanket_ban():
    ea = read(EA)
    fn = body(ea, "bool XAU_AntiRepeatLossActive(int signal)")
    # only activates on a real streak in the matching direction
    assert "if(g_sameDirLossStreak < InpAntiRepeatLossStreak) return false;" in fn
    assert "if(g_lastLossDir != signal) return false;" in fn
    # lifts as soon as price genuinely recovers half an ATR past the last loss
    assert "bool recovered = (signal == 1) ? (curPrice > g_lastLossClosePx + atr * 0.5)" in fn
    assert "return !recovered;" in fn
    # master on/off switch respected
    assert "if(!InpAntiRepeatLossEnable) return false;" in fn


def test_guard_wired_into_all_three_soft_bypass_sites():
    ea = read(EA)
    # SMART_GUARD_FAST_CONFIRM
    sg = body(ea, 'string sgMsg = StringFormat("SMART-GUARD: %s blocked by adaptive fast confirmation', "\n         }\n      }\n")
    assert "bool antiRepeatBlocks = XAU_AntiRepeatLossActive(signal);" in sg
    assert "if(!antiRepeatBlocks && XAU_ModeAllowsSoftBlockWarning()" in sg

    # STI_REENTRY_WAIT
    sti = body(ea, 'string stiMsg = StringFormat("STI_REENTRY_WAIT', "\n         }\n      }\n")
    assert "bool antiRepeatBlocksSTI = XAU_AntiRepeatLossActive(signal);" in sti
    assert "if(!antiRepeatBlocksSTI && XAU_ModeAllowsSoftBlockWarning()" in sti

    # AI_LOW_CONF_SKIP
    ai = body(ea, 'string blockMsg = StringFormat(\n                  "AI DIRECTOR BLOCK: AI SKIP with confidence', "\n               }\n")
    assert "bool antiRepeatBlocksAI = XAU_AntiRepeatLossActive(signal);" in ai
    assert "if(!antiRepeatBlocksAI && XAU_ModeAllowsSoftBlockWarning()" in ai


def test_memory_floor_cannot_raise_lot_during_active_loss_streak():
    ea = read(EA)
    fn = body(ea, "bool XAU_MemoryRecommendation(int signal, string setupName, string grade,")
    assert "if(memoryFloor > 0.0 && lotMulti < memoryFloor && !XAU_AntiRepeatLossActive(signal))" in fn
    assert "SUPPRESSED (ANTI_REPEAT_LOSS_GUARD active" in fn


def test_catastrophic_win_rate_gets_a_stronger_reduction_than_flat_35pct_tier():
    ea = read(EA)
    fn = body(ea, "bool XAU_MemoryRecommendation(int signal, string setupName, string grade,")
    assert "st.samples >= 20 && st.winRate <= 15.0" in fn
    assert "lotMulti = 0.35;" in fn
    # the escalated tier must be checked before the older flat tier
    assert fn.index("winRate <= 15.0") < fn.index("winRate <= 35.0")


def test_cloud_offline_and_reconnect_tracking_exists():
    ea = read(EA)
    assert "void XAU_CloudRecordSuccess(string context)" in ea
    assert "void XAU_CloudRecordFailure(string context, int httpCode, int err)" in ea
    fn = body(ea, "void XAU_CloudRecordFailure(string context, int httpCode, int err)")
    assert "CLOUD_OFFLINE_LOCAL_MODE" in fn
    assert "g_cloudConsecutiveFails >= InpCloudOfflineFailThreshold" in fn
    success_fn = body(ea, "void XAU_CloudRecordSuccess(string context)")
    assert "CLOUD_RECONNECTED" in success_fn


def test_all_three_cloud_call_sites_report_to_the_shared_tracker():
    ea = read(EA)
    decision = body(ea, 'int code = WebRequest("POST", InpCloudURL + "/api/cloud/monitor/activity",', "\n}\n")
    assert 'XAU_CloudRecordFailure("BOT-DECISION"' in decision
    assert 'XAU_CloudRecordSuccess("BOT-DECISION")' in decision

    heartbeat = body(ea, 'int code = WebRequest("POST", InpCloudURL + "/api/cloud/monitor/heartbeat",', "\n}\n")
    assert 'XAU_CloudRecordFailure("BOT-MONITOR"' in heartbeat
    assert 'XAU_CloudRecordSuccess("BOT-MONITOR")' in heartbeat

    command = body(ea, 'int code = WebRequest("GET", pendingUrl,', "\n   XAU_CloudRecordSuccess(\"BOT-COMMAND\");\n")
    assert 'XAU_CloudRecordFailure("BOT-COMMAND"' in command
    assert 'XAU_CloudRecordSuccess("BOT-COMMAND")' in command


def test_cloud_failure_logs_include_consecutive_fail_count():
    ea = read(EA)
    assert '" consecutiveFails=", g_cloudConsecutiveFails + 1' in ea


def test_no_trade_decision_logic_reads_cloud_call_return_codes():
    # cloud reliability must never gate entries/exits — only the three
    # monitor/command call sites (which never place or block a trade) may
    # reference the WebRequest return code.
    ea = read(EA)
    entry_pipeline = body(ea, "void OpenTrade(int signal, double atr, string reason, double sizeMulti)", "\n}\n")
    assert "WebRequest" not in entry_pipeline
