from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.17.12.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def test_current_release_source_is_synced_to_backend():
    assert read(EA) == read(BACKEND_EA)


def test_version_bumped_to_v61712():
    ea = read(BACKEND_EA)
    assert '#define XAUAI_EA_VERSION "v6.17.12"' in ea


def test_header_banner_matches_property_version_for_website_display():
    import re
    ea = read(BACKEND_EA)
    m = re.search(r'v(\d+\.\d+\.\d+)\s*[—\-]+\s*(.+)', ea[:3000])
    assert m is not None
    assert f"v{m.group(1)}" == "v6.17.12"


# ---------------------------------------------------------------------------
# Root cause under investigation: xau_direction_recognition_latency_audit
# found ZERO MARKET_SNAPSHOT/BLOCK_CHECK events logged for the entire
# duration any position is open (8/8 sampled trades, zero exceptions,
# confirmed up to a 40-minute gap on one trade). An exhaustive trace of the
# full OnTick() pipeline (every CountMyPositions()-gated branch, ManageBasket
# and XAU_BasketLifecycleManager's return semantics, the newM5Bar gate,
# entryExecutionBlocked's only usage site, IsXAUFastSymbol,
# XAU_UpdateBlockedSignalOutcomes) found no single explicit "if position
# open, suppress everything" line -- the code's own comments explicitly
# document the opposite intent ("market analysis continues... fresh entries
# are blocked"). Whatever the exact trigger, a real, independently-valuable
# bug WAS found and fixed: the scan watchdog (InpScanWatchdogMin, meant to
# force a recovery scan if none has "happened" in N minutes) was stamping
# its timing anchor (g_lastEntryScanAt) BEFORE the scan pipeline reaches
# ScoreSetups/grade computation/Personality Gate/SmartGuard/
# XAU_RecordMarketSnapshot -- meaning any early return anywhere in that
# ~450-line span was invisible to the watchdog, since the anchor already
# advanced. This explains why InpScanWatchdogMin=7 (minutes) did not recover
# from the observed 40-minute gap: the watchdog thought scans were
# succeeding the whole time.
# ---------------------------------------------------------------------------
def test_watchdog_stamp_moved_after_market_snapshot_not_before_scoresetups():
    ea = read(BACKEND_EA)
    snapshot_call = 'XAU_RecordMarketSnapshot("SCAN_EVALUATED", signal, setupName, grade, setupScore, combinedScore);'
    scoresetups_call = "int signal = ScoreSetups(setupScore, setupName);"
    stamp = "g_lastEntryScanAt = TimeCurrent();"

    snapshot_idx = ea.index(snapshot_call)
    scoresetups_idx = ea.index(scoresetups_call)
    assert scoresetups_idx < snapshot_idx  # ScoreSetups runs well before the snapshot call

    # The stamp must now appear AFTER XAU_RecordMarketSnapshot, not before
    # ScoreSetups. Find the specific v6.17.12 stamp line.
    stamp_marker = "g_lastEntryScanAt = TimeCurrent(); // v6.17.12: watchdog stamp moved here"
    assert stamp_marker in ea
    new_stamp_idx = ea.index(stamp_marker)
    assert new_stamp_idx > snapshot_idx  # stamped AFTER the snapshot call
    assert new_stamp_idx > scoresetups_idx  # and therefore also after ScoreSetups


def test_old_premature_stamp_location_is_gone():
    ea = read(BACKEND_EA)
    # The old buggy line (stamp immediately after indicator buffers load,
    # before ScoreSetups even runs) must no longer exist as a bare statement.
    old_premature_pattern = "if(curBar > 0) g_lastEntryBarSeen = curBar;\n   g_lastEntryScanAt = TimeCurrent();\n   // v6.4.0 UPGRADE 1: classify market personality"
    assert old_premature_pattern not in ea


def test_bar_seen_tracking_unchanged():
    # g_lastEntryBarSeen (a separate, correctly-positioned tracker) must be
    # untouched by this fix -- only the watchdog's own timing anchor moved.
    ea = read(BACKEND_EA)
    assert "if(curBar > 0) g_lastEntryBarSeen = curBar;" in ea


def test_watchdog_input_and_bypass_logic_untouched():
    ea = read(BACKEND_EA)
    assert "input int    InpScanWatchdogMin  = 7;" in ea
    assert "bool watchdogDue = (InpScanWatchdogMin > 0 && secondsSinceScan >= InpScanWatchdogMin * 60);" in ea
    assert "if(!newM5Bar && !watchdogDue && !timerForced)" in ea


def test_prior_fixes_still_intact():
    ea = read(BACKEND_EA)
    assert "bool XAU_AIIsAdvisoryOnly()" in ea
    assert "return true;" in ea  # XAU_AIIsAdvisoryOnly hardcode from v6.17.11
    assert "int pgOppSignalFound = ScoreSetups(pgOppScore, pgOppSetupName, signal);" in ea  # v6.17.10
    assert "int oppSignalFound = ScoreSetups(oppScore, oppSetupName, signal);" in ea  # v6.17.9
    assert "freshM15Dir == -dir && freshM30Dir == -dir" in ea  # v6.17.8
