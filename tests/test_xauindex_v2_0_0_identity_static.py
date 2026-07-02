from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XauIndex_EA_v2.0.mq5"
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

    # its own fresh version line, not a continuation of the 6.x gold lineage
    assert '#property version   "2.00"' in ea
    assert '#define XAUAI_EA_VERSION "v2.0.0"' in ea
    assert '#define XAUAI_EA_VERSION_NUM "2.0.0"' in ea

    # user-facing product name must say XauIndex, not XauAI Sniper, so the
    # two products are never confused with one another on a customer's MT5
    assert '#property copyright "XauIndex by emriz.eth"' in ea
    assert 'Print("=== XAUINDEX ", XAUAI_EA_VERSION,' in ea
    assert 'XAUAI SNIPER' not in ea


def test_xauindex_v2_inherits_no_limit_trading_mode_from_gold():
    # v2.0.0 rebuild: XauIndex was forked before Codex's No-Limit Trading
    # Mode existed on gold. Rebuilding on the current gold base must bring
    # it in, with the same safe default gold ships (never silently ON by
    # surprise, never silently OFF either — matches gold's own default).
    ea = read(EA)
    assert "input bool   InpNoLimitTradingMode = true;" in ea
    assert "bool XAU_NoLimitTradingModeActive()" in ea


def test_xauindex_v2_inherits_adaptive_arbiter_and_tri_from_gold():
    ea = read(EA)
    # Adaptive Entry/Exit Arbiter (gold v6.7.0)
    assert "double SMC_GetConflictPenalty(int dir, bool &hardBlock, string &conflictReason)" in ea
    assert "g_aiHardBlockB" in ea
    # Trade Recovery Intelligence (gold v6.8.0)
    assert "int XAU_TRI_Evaluate(int ttmIdx, ulong ticket, bool isBuy, double openPx, double curPrice," in ea
    assert 'SafePositionClose(ticket, "TRI_WEAK_RECOVERY_EXIT")' in ea
    # Command Center live-feed fix (gold v6.9.0)
    assert 'BotMonitorDecisionEvent("BOT_STATUS_HEARTBEAT"' in ea
    assert 'WebRequest("POST", InpCloudURL + "/api/cloud/monitor/thesis-status"' in ea


def test_xauindex_v2_market_mode_layer_still_intact():
    # the port must not have dropped or broken the Gold/Index detection
    # layer that makes this product different from gold in the first place
    ea = read(EA)
    assert "enum ENUM_XAU_MARKET_MODE { MARKET_AUTO_DETECT=0, MARKET_GOLD_MODE=1, MARKET_INDEX_MODE=2 };" in ea
    assert "ENUM_XAU_MARKET_MODE XAU_DetectMarketMode(string &reason)" in ea
    assert "double XAU_CalcIndexLot(string symbol, double riskAmountUSD, double slDistance," in ea
    gate = body(ea, "if(g_marketMode == MARKET_INDEX_MODE && InpIndexModeLogOnly)\n   {\n      static datetime lastIndexIdleLog")
    assert "g_lastSkipReason = \"INDEX_MODE_MONITORING_ONLY: no index entry strategy enabled yet\";" in gate
    assert "return;" in gate
    # heartbeat's wrong-symbol check must not fire for a legitimate index symbol
    assert "bool symOK = (g_marketMode == MARKET_INDEX_MODE) ||" in ea


def test_xauindex_is_a_separate_file_from_the_gold_only_lineage():
    # the two products must not be the same file on disk — XauAI Sniper
    # (gold-only, maintained separately) must be free to version independently
    # (e.g. Codex's own v6.6.x line) without touching XauIndex at all.
    assert EA != GOLD_EA
    if GOLD_EA.exists():
        assert read(EA) != read(GOLD_EA)


def test_download_page_has_a_separate_xauindex_section_and_endpoints():
    src = read(DOWNLOAD)
    assert "xauindex-download-section" in src
    assert "/download/xauindex/info" in src
    assert "/download/xauindex/ea" in src
    assert "/download/xauindex/package" in src
    # must not silently reuse the gold EA's download endpoint
    assert 'href={`${api}/download/xauindex/ea`}' in src


def test_backend_serves_xauindex_from_its_own_directory_not_the_gold_one():
    server = read(ROOT / "backend" / "server.py")
    assert '"/download/xauindex/info"' in server
    assert '"/download/xauindex/ea"' in server
    assert '"/download/xauindex/package"' in server
    assert 'ROOT_DIR / "ea_code_xauindex" / "XauIndex_EA.mq5"' in server
    assert 'filename_prefix="XauIndex_EA"' in server
