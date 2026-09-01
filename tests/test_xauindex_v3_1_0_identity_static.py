from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XauIndex_EA_v3.1.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code_xauindex" / "XauIndex_EA.mq5"
GOLD_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"
DOWNLOAD = ROOT / "frontend" / "src" / "components" / "DownloadSection.jsx"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def body(ea: str, start: str, end: str = "\n}\n") -> str:
    pos = ea.index(start)
    return ea[pos : ea.index(end, pos) + len(end)]


def test_xauindex_source_and_backend_copy_stay_synced():
    assert read(EA) == read(BACKEND_EA)


def test_xauindex_is_versioned_and_branded_independently_from_xauai_sniper():
    ea = read(EA)

    assert '#property version   "3.10"' in ea
    assert '#define XAUAI_EA_VERSION "v3.1.0"' in ea
    assert '#define XAUAI_EA_VERSION_NUM "3.1.0"' in ea

    assert '#property copyright "XauIndex by emriz.eth"' in ea
    assert 'Print("=== XAUINDEX ", XAUAI_EA_VERSION,' in ea
    assert 'XAUAI SNIPER' not in ea


def test_xauindex_v3_1_inherits_gold_v6_12_0_and_earlier_systems():
    # v3.1.0 rebase brings in everything gold shipped through v6.12.0
    ea = read(EA)
    assert "input bool   InpNoLimitTradingMode = true;" in ea
    assert "double SMC_GetConflictPenalty(int dir, bool &hardBlock, string &conflictReason)" in ea
    assert "int XAU_TRI_Evaluate(int ttmIdx, ulong ticket, bool isBuy, double openPx, double curPrice," in ea
    assert 'BotMonitorDecisionEvent("BOT_STATUS_HEARTBEAT"' in ea
    # v6.10.0 Adaptive News Momentum Engine
    assert "NEWS_CONTINUATION_CONFIRMED" in ea or "NEWS_ENTRY_ALLOWED" in ea


def test_xauindex_v3_market_mode_layer_still_intact():
    ea = read(EA)
    assert "enum ENUM_XAU_MARKET_MODE { MARKET_AUTO_DETECT=0, MARKET_GOLD_MODE=1, MARKET_INDEX_MODE=2 };" in ea
    assert "ENUM_XAU_MARKET_MODE XAU_DetectMarketMode(string &reason)" in ea
    assert "bool symOK = (g_marketMode == MARKET_INDEX_MODE) ||" in ea


def test_xauindex_v3_has_a_real_index_entry_engine_not_monitoring_only():
    # the defining change of v3.0.0: Index Mode now generates real trading
    # signals from standard TA principles, instead of only logging
    ea = read(EA)
    for fn in (
        "double XAU_IndexATRPercentile(double &curATR)",
        "int XAU_IndexTrendRegime(string &reasonOut)",
        "double XAU_IndexMomentum(int dir)",
        "bool XAU_IndexSwingPoints(double &swingHigh, double &swingLow)",
        "bool XAU_IndexStructureBOS(int dir, string &reasonOut)",
        "bool XAU_IndexLiquiditySweep(int dir, string &reasonOut)",
        "bool XAU_IndexPullbackEntry(int dir, string &reasonOut)",
        "bool XAU_IndexBreakoutEntry(int dir, double atr, string &reasonOut)",
        "int XAU_IndexScoreSetup(double &scoreOut, string &setupNameOut, string &gradeOut, string &reasonOut)",
    ):
        assert fn in ea, f"missing engine function: {fn}"

    # the old log-only-forever "no index entry strategy exists" gate must be gone
    assert "no index entry strategy is enabled yet" not in ea
    assert "no index entry strategy enabled yet" not in ea


def test_xauindex_v3_volatility_regime_blocks_extreme_and_dead_conditions():
    ea = read(EA)
    fn = body(ea, "int XAU_IndexScoreSetup(double &scoreOut, string &setupNameOut, string &gradeOut, string &reasonOut)")
    assert "volPct >= InpIndexVolExtremePct" in fn
    assert "volPct <= InpIndexVolLowPct" in fn
    assert 'return 0;' in fn


def test_xauindex_v3_engine_grades_map_to_gold_vocabulary():
    ea = read(EA)
    fn = body(ea, "int XAU_IndexScoreSetup(double &scoreOut, string &setupNameOut, string &gradeOut, string &reasonOut)")
    assert 'gradeOut = scoreOut >= InpIndexGradeAPlus ? "A+" :' in fn
    assert '"A"' in fn and '"B"' in fn and '"SKIP"' in fn


def test_xauindex_v3_engine_uses_last_closed_bar_not_repainting_current_bar():
    # matches gold's own OpenTrade(signal, bufATR[1], ...) convention —
    # every price/indicator read in the engine should reference bar shift
    # 1 (or later), never shift 0 (the still-forming current bar)
    ea = read(EA)
    fn = body(ea, "bool XAU_IndexPullbackEntry(int dir, string &reasonOut)")
    assert "iHigh(Symbol(), PERIOD_M5, 1)" in fn
    assert "iHigh(Symbol(), PERIOD_M5, 0)" not in fn


def test_xauindex_v3_gate_wires_real_engine_into_open_trade():
    ea = read(EA)
    gate = body(ea, "if(g_marketMode == MARKET_INDEX_MODE)\n   {\n      static datetime lastIndexBarEval = 0;",
                "\n      return;\n   }\n")
    assert "XAU_IndexScoreSetup(idxScore, idxSetup, idxGrade, idxReason)" in gate
    # live trading only fires when InpIndexModeLogOnly is explicitly false
    assert "if(!InpIndexModeLogOnly && idxSignal != 0 && idxGrade != \"SKIP\"" in gate
    assert "OpenTrade(idxSignal, idxATR, idxSetup" in gate
    # runs once per new M5 bar, not every tick
    assert "datetime curIndexBar = iTime(Symbol(), PERIOD_M5, 0);" in gate
    assert "if(curIndexBar != lastIndexBarEval)" in gate
    # respects the same max-open-trades cap gold's own entries respect
    assert "CountMyPositions() < InpMaxOpenTrades" in gate


def test_xauindex_v3_safety_switch_still_defaults_to_log_only():
    # the engine is real now, but it must not go live by surprise — matches
    # this codebase's established opt-in-only pattern for every capability
    # that changes live-money behavior (e.g. InpNoLimitTradingMode)
    ea = read(EA)
    assert "input bool   InpIndexModeLogOnly = true;" in ea


def test_xauindex_v31_has_a_dedicated_spike_detector():
    ea = read(EA)
    assert "int XAU_IndexFindRecentSpike(double atr, string &reasonOut)" in ea
    fn = body(ea, "int XAU_IndexFindRecentSpike(double atr, string &reasonOut)")
    assert "hugeVsATR = range > atr * InpIndexSpikeATRMultiple" in fn
    assert "mostlyBody = body >= range * InpIndexSpikeBodyRatio" in fn


def test_xauindex_v31_breakout_never_enters_on_the_spike_candle_itself():
    ea = read(EA)
    fn = body(ea, "bool XAU_IndexBreakoutEntry(int dir, double atr, string &reasonOut)")
    assert "if(spikeBar == 1)" in fn
    reject_block = fn[fn.index("if(spikeBar == 1)"):fn.index("if(spikeBar == 1)") + 300]
    assert "return false;" in reject_block


def test_xauindex_v31_breakout_requires_post_spike_confirmation_during_cooldown():
    ea = read(EA)
    fn = body(ea, "bool XAU_IndexBreakoutEntry(int dir, double atr, string &reasonOut)")
    assert "spikeBar >= 2 && spikeBar <= cooldown" in fn
    assert "spikeDir != dir" in fn
    assert "close1 > spikeClose + atr * InpIndexSpikePostConfirmATR" in fn
    assert "close1 < spikeClose - atr * InpIndexSpikePostConfirmATR" in fn


def test_xauindex_v31_pullback_also_rejects_the_spike_bar_and_checks_direction():
    ea = read(EA)
    fn = body(ea, "bool XAU_IndexPullbackEntry(int dir, string &reasonOut)")
    assert "if(spikeBar == 1)" in fn
    assert "spikeDir != dir" in fn


def test_xauindex_v31_has_symbol_relative_spread_gap_gate_not_xauusd_fixed():
    ea = read(EA)
    fn = body(ea, "bool XAU_IndexSpreadGapOK(double atr, string &reasonOut)")
    # relative to this symbol's own ATR and its own rolling spread EMA —
    # never a fixed XAUUSD point constant
    assert "atr * InpIndexSpreadATRMult" in fn
    assert "g_spreadEMA * InpIndexSpreadBaselineMult" in fn
    assert "atr * InpIndexGapATRMult" in fn
    assert "InpMaxSpread" not in fn


def test_xauindex_v31_scorer_blocks_on_spread_gap_before_scoring_setups():
    ea = read(EA)
    fn = body(ea, "int XAU_IndexScoreSetup(double &scoreOut, string &setupNameOut, string &gradeOut, string &reasonOut)")
    assert "XAU_IndexSpreadGapOK(curATR, spreadReason)" in fn
    gate_pos = fn.index("XAU_IndexSpreadGapOK")
    loop_pos = fn.index("for(int d = 1; d >= -1; d -= 2)")
    assert gate_pos < loop_pos, "spread/gap gate must run before setup scoring, not after"


def test_xauindex_v31_boom_crash_profile_actually_changes_behavior():
    ea = read(EA)
    # not just a label: referenced by the spike cooldown, spread gate,
    # breakout gate, and position sizing/lot-cap enforcement
    assert ea.count("XAU_IndexIsBoomCrashProfile()") >= 4

    breakout_fn = body(ea, "bool XAU_IndexBreakoutEntry(int dir, double atr, string &reasonOut)")
    assert "InpIndexBoomCrashAllowBreakout" in breakout_fn

    spread_fn = body(ea, "bool XAU_IndexSpreadGapOK(double atr, string &reasonOut)")
    assert "InpIndexBoomCrashSpreadMult" in spread_fn

    gate = body(ea, "if(g_marketMode == MARKET_INDEX_MODE)\n   {\n      static datetime lastIndexBarEval = 0;",
                "\n      return;\n   }\n")
    assert "InpIndexBoomCrashRiskMult" in gate
    assert "XAU_IndexEnforceBoomCrashLotCap()" in gate


def test_xauindex_v31_boom_crash_has_its_own_conservative_defaults():
    ea = read(EA)
    assert "input double InpIndexBoomCrashRiskMult      = 0.5;" in ea
    assert "input double InpIndexBoomCrashMaxLot        = 0.10;" in ea
    assert "input double InpIndexBoomCrashSpreadMult    = 0.6;" in ea
    assert "input bool   InpIndexBoomCrashAllowBreakout = false;" in ea
    assert "input int    InpIndexBoomCrashSpikeCooldownMult = 2;" in ea


def test_xauindex_v31_hard_lot_cap_enforced_via_partial_close_not_reused_gold_internals():
    ea = read(EA)
    fn = body(ea, "void XAU_IndexEnforceBoomCrashLotCap()")
    assert "vol > InpIndexBoomCrashMaxLot" in fn
    assert "trade.PositionClosePartial(ticket, trimVol)" in fn


def test_xauindex_v31_every_index_decision_logs_a_specific_reason():
    ea = read(EA)
    gate = body(ea, "if(g_marketMode == MARKET_INDEX_MODE)\n   {\n      static datetime lastIndexBarEval = 0;",
                "\n      return;\n   }\n")
    assert "INDEX_ENGINE |" in gate
    assert "idxReason" in gate


def test_xauindex_is_a_separate_file_from_the_gold_only_lineage():
    assert EA != GOLD_EA
    if GOLD_EA.exists():
        assert read(EA) != read(GOLD_EA)


def test_download_page_has_a_separate_xauindex_section_and_endpoints():
    src = read(DOWNLOAD)
    assert "xauindex-download-section" in src
    assert "/download/xauindex/info" in src
    assert "/download/xauindex/ea" in src
    assert "/download/xauindex/package" in src
    assert 'href={`${api}/download/xauindex/ea`}' in src


def test_backend_serves_xauindex_from_its_own_directory_not_the_gold_one():
    server = read(ROOT / "backend" / "server.py")
    assert '"/download/xauindex/info"' in server
    assert '"/download/xauindex/ea"' in server
    assert '"/download/xauindex/package"' in server
    assert 'ROOT_DIR / "ea_code_xauindex" / "XauIndex_EA.mq5"' in server
    assert 'filename_prefix="XauIndex_EA"' in server
