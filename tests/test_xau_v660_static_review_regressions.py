from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.14.0.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def body(ea: str, start: str, end: str = "\n}\n") -> str:
    pos = ea.index(start)
    return ea[pos : ea.index(end, pos) + len(end)]


def test_active_source_and_backend_stay_synced_for_static_review_fixes():
    assert read(EA) == read(BACKEND_EA)


def test_phantom_peak_reconstruction_excludes_entry_candle_after_one_closed_bar():
    ea = read(EA)
    fn = body(ea, "double XAU_ReconstructOpenBasketPeakUSD(double currentPnL)")

    assert "if(startShift <= 1)" in fn
    assert "int barsToCopy = (int)MathMin((double)(startShift - 1), 900.0);" in fn
    assert "CopyLow(Symbol(), PERIOD_M5, 1, barsToCopy, lows)" in fn
    assert "CopyHigh(Symbol(), PERIOD_M5, 1, barsToCopy, highs)" in fn
    assert "MathMin((double)startShift, 900.0)" not in fn


def test_direction_aware_hostile_flip_helper_prevents_favorable_flip_exits():
    ea = read(EA)
    helper = body(ea, "bool XAU_NewHostileStructureFlip(")

    assert "int hostileDir = -tradeDir;" in helper
    assert "return (currentDir == hostileDir && entryDir != hostileDir);" in helper

    basket = body(ea, "bool XAU_BasketStructureBroken(int basketDir)")
    assert "XAU_NewHostileStructureFlip(g_basketEntryBOS, g_smc_bos_dir, basketDir)" in basket
    assert "XAU_NewHostileStructureFlip(g_basketEntryHTF, g_htfConsensusDir, basketDir)" in basket
    assert "g_smc_bos_dir == -g_basketEntryBOS" not in basket
    assert "g_htfConsensusDir == -g_basketEntryHTF" not in basket

    reversal = body(ea, "bool XAU_ReversalConfirmed(")
    assert "int tradeDir = isBuy ? 1 : -1;" in reversal
    assert "XAU_NewHostileStructureFlip(entryBOS, g_smc_bos_dir, tradeDir)" in reversal
    assert "XAU_NewHostileStructureFlip(entryHTF, g_htfConsensusDir, tradeDir)" in reversal
    assert "g_smc_bos_dir == -entryBOS" not in reversal
    assert "g_htfConsensusDir == -entryHTF" not in reversal


def test_ttm_structure_flips_are_hostile_not_merely_opposite_entry_snapshot():
    ea = read(EA)
    fn = body(ea, "string TTM_Evaluate(int idx, bool isBuy, double liveScore,")

    assert "int tradeDir = isBuy ? 1 : -1;" in fn
    assert "bool bosFlipped = XAU_NewHostileStructureFlip(g_ttm[idx].entryBOS, currentBOS, tradeDir);" in fn
    assert "bool htfFlipped = XAU_NewHostileStructureFlip(g_ttm[idx].entryHTF, currentHTF, tradeDir);" in fn
    assert "currentBOS == -g_ttm[idx].entryBOS" not in fn
    assert "currentHTF == -g_ttm[idx].entryHTF" not in fn


def test_ttm_bars_held_counts_only_closed_bars_after_entry_candle():
    ea = read(EA)
    record = body(ea, "struct TradeTTMRecord")
    fn = body(ea, "string TTM_Evaluate(int idx, bool isBuy, double liveScore,")

    assert "datetime entryTime;" in record
    assert "r.entryTime          = TimeCurrent();" in ea
    assert "datetime closedBarTime = iTime(Symbol(), PERIOD_M5, 1);" in fn
    assert "if(closedBarTime <= 0) return \"\";" in fn
    assert "if(closedBarTime <= g_ttm[idx].entryTime)" in fn
    assert "g_ttm[idx].lastEvalBarTime = closedBarTime;" in fn
    assert "iTime(Symbol(), PERIOD_M5, 0)" not in fn
    assert fn.index("closedBarTime <= g_ttm[idx].entryTime") < fn.index("g_ttm[idx].barsHeld++")


def test_startup_sync_version_uses_release_constant_not_stale_591():
    ea = read(EA)
    sync = body(ea, "void XAU_RunStartupIntelligenceSync()", "\n}\n")

    stale = "version=5" + ".9.1"
    assert stale not in sync
    assert "version=%s syncDurationSec=%d" in sync
    assert "XAUAI_EA_VERSION" in sync
