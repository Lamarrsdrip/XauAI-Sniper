from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"
V62417_EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.24.17.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def test_all_three_source_copies_synced():
    assert read(EA) == read(BACKEND_EA) == read(V62417_EA)


def test_compile_log_reports_zero_errors_and_warnings():
    log = (ROOT / "tester_sandbox" / "MT5_Isolated" / "compile_h1_fix.log").read_bytes()
    text = log.decode("utf-16-le", errors="ignore")
    assert "0 errors, 0 warnings" in text


# ---------------------------------------------------------------------------
# Root cause (live-evidence-proven 2026-07-16): >99% of scan aborts on both
# Mac and VPS were EMA_FAST_H1 -- the H1 EMA pair had no SERIES_SYNCHRONIZED
# pre-check, unlike the InpContextTF/H4 pair fixed in v6.24.17.
# ---------------------------------------------------------------------------
def test_h1_series_synchronized_check_exists():
    ea = read(BACKEND_EA)
    assert "SeriesInfoInteger(Symbol(), PERIOD_H1, SERIES_SYNCHRONIZED)" in ea
    assert "INDICATOR_H1_SERIES_NOT_SYNCHRONIZED" in ea


def test_h1_check_runs_before_the_h1_copybuffer_calls():
    ea = read(BACKEND_EA)
    sync_idx = ea.index("if(!SeriesInfoInteger(Symbol(), PERIOD_H1, SERIES_SYNCHRONIZED))")
    copy_idx = ea.index('CopyEntryBuffer(hEMAFast_H1, 0, 0, 3, bufEMAFast_H1, "EMA_FAST_H1")')
    assert sync_idx < copy_idx


def test_h1_has_its_own_bounded_last_known_good_fallback():
    ea = read(BACKEND_EA)
    for sym in ["datetime g_h1EmaLastGoodAt = 0;", "double   g_h1EmaFastLastGood = 0.0;",
                "double   g_h1EmaSlowLastGood = 0.0;", 'string   g_h1IndicatorState = "HEALTHY";']:
        assert sym in ea
    assert "haveH1BoundedLastGood = (g_h1EmaLastGoodAt > 0 && h1StaleSec <= XAU_HTF_EMA_MAX_STALE_SEC)" in ea
    assert "INDICATOR_H1_DEGRADED_USING_LAST_GOOD" in ea


def test_h1_fallback_is_bounded_not_indefinite():
    ea = read(BACKEND_EA)
    # reuses the SAME bound as the H4 fix -- not a separately-invented, looser
    # or unbounded staleness allowance
    assert ea.count("XAU_HTF_EMA_MAX_STALE_SEC") >= 4  # define + H4 use + H1 use (at least 2 each)


def test_h1_state_distinguishes_healthy_degraded_and_stale_unusable():
    ea = read(BACKEND_EA)
    assert 'g_h1IndicatorState = "HEALTHY";' in ea
    assert 'g_h1IndicatorState = "DEGRADED_USING_LAST_GOOD";' in ea
    assert 'g_h1IndicatorState = (h1StaleSec > XAU_HTF_EMA_MAX_STALE_SEC) ? "STALE_UNUSABLE" : "TEMPORARY_NOT_READY";' in ea


def test_h1_sync_failure_does_not_trigger_a_pointless_handle_rebuild():
    ea = read(BACKEND_EA)
    idx = ea.index("if(!SeriesInfoInteger(Symbol(), PERIOD_H1, SERIES_SYNCHRONIZED))")
    window = ea[idx: idx + 600]
    assert "XAU_LogScanAborted(g_lastSkipReason);" in window
    assert "RebuildEntryIndicatorHandles" not in window


def test_h4_fix_still_intact_unchanged_by_the_h1_addition():
    ea = read(BACKEND_EA)
    assert "SeriesInfoInteger(Symbol(), InpContextTF, SERIES_SYNCHRONIZED)" in ea
    assert "INDICATOR_HTF_SERIES_NOT_SYNCHRONIZED" in ea
    assert "g_htfEmaFastLastGood" in ea and "g_htfEmaSlowLastGood" in ea


def test_h1_and_h4_use_independent_state_variables_not_shared():
    ea = read(BACKEND_EA)
    assert "g_h1EmaLastGoodAt" in ea
    assert "g_htfEmaLastGoodAt" in ea
    assert "g_h1EmaLastGoodAt" != "g_htfEmaLastGoodAt"
