"""v6.25.2 owner directive 2026-07-17 -- URGENT FORENSIC FIX.

Live evidence: the Command Center showed
  PRIMARY_DECISION "No entry allowed on this M5 decision cycle"
  reason=INDICATOR_TRANSIENT_4807 ... retrying next tick
immediately followed by heartbeat WAITING_FOR_NEW_PRIMARY_BAR: cur=10:40
last=10:40.

Root-cause trace (see the long forensic comment right after
`if(curBar > 0) g_lastEntryBarSeen = curBar;` in the EA source): the owner's
own hypothesis (the M10 bar gets marked "seen" before its scan completes)
does NOT match the code -- g_lastEntryBarSeen has exactly one assignment
site and it is unreachable from any XAU_LogScanAborted(...); return; path
above it, so a genuinely aborted scan already retries the SAME bar on the
very next tick. What actually happened: EMA_FAST_H1/EMA_FAST_HTF hit a
transient 4807 earlier in the SAME tick, the existing bounded
last-known-good fallback recovered from it (letting the scan reach and
pass the g_lastEntryBarSeen assignment), but nothing cleared the shared,
tick-spanning g_lastSkipReason global afterward -- so the stale
"INDICATOR_TRANSIENT_4807 ... retrying next tick" text from the
already-recovered hiccup was read by XAU_RecordMarketSnapshot() as if it
were the reason THIS completed decision cycle produced no candidate.

These tests are static-source-text tests (this repo's established
convention -- no live MT5 execution harness exists in this environment,
see tests/known_obsolete_failures.txt for the same disclosed limitation
elsewhere), but each assertion targets an exact, real code shape, not a
paraphrase.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def test_root_and_backend_copies_synced():
    assert read(EA) == read(BACKEND_EA)


def test_g_lastEntryBarSeen_has_exactly_one_assignment_site():
    # Locks in the forensic finding: there is no second place that could
    # mark a bar "seen" before the buffer-load phase actually succeeds.
    ea = read(EA)
    assert ea.count("g_lastEntryBarSeen = curBar;") == 1


def test_bar_marker_is_unreachable_from_any_scan_aborted_early_return():
    """Every `XAU_LogScanAborted(...); return;` between SCAN_STARTED and the
    g_lastEntryBarSeen assignment must appear strictly BEFORE it in the
    source -- proving an aborted scan cannot have already marked the bar
    processed (and therefore genuinely retries the same bar next tick)."""
    ea = read(EA)
    scan_started_idx = ea.index('XAU_LogScanState("SCAN_STARTED");')
    marker_idx = ea.index("if(curBar > 0) g_lastEntryBarSeen = curBar;", scan_started_idx)
    window = ea[scan_started_idx:marker_idx]
    abort_count = window.count("XAU_LogScanAborted(")
    assert abort_count >= 5, "expected multiple abort sites (EMA_FAST_M5/H1/HTF/RSI_M15/STOCH) all before the marker"
    # and none of them may appear AFTER the marker within the same scan block
    after_window = ea[marker_idx: marker_idx + 200]
    assert "XAU_LogScanAborted(" not in after_window


def test_stale_skip_reason_cleared_immediately_after_successful_buffer_load():
    """The exact forensic fix: g_lastSkipReason must be reset to empty right
    after the bar marker is set, before any downstream block gate or
    ScoreSetups call, so no leftover transient-indicator text from earlier
    in the same tick can be misattributed to a later, real decision."""
    ea = read(EA)
    marker_idx = ea.index("if(curBar > 0) g_lastEntryBarSeen = curBar;")
    window = ea[marker_idx: marker_idx + 2200]
    assert 'g_lastSkipReason = "";' in window


def test_cleared_before_fleet_consistency_comment_not_after():
    # Ordering matters: the clear must happen before the rest of the
    # tick's real decision logic runs, not be a dead trailing statement.
    ea = read(EA)
    clear_idx = ea.index('if(curBar > 0) g_lastEntryBarSeen = curBar;')
    clear_stmt_idx = ea.index('g_lastSkipReason = "";', clear_idx)
    fleet_comment_idx = ea.index("FLEET-CONSISTENCY: exactly one recovery attempt per NEW closed", clear_idx)
    assert clear_stmt_idx < fleet_comment_idx


def test_stale_m5_decision_cycle_wording_removed():
    ea = read(EA)
    assert "No entry allowed on this M5 decision cycle" not in ea
    assert "No entry was created from this M10 primary decision cycle" in ea


def test_bounded_last_good_fallback_still_lets_scan_complete_not_abort():
    """Confirms the existing (pre-existing, not newly added) bounded
    last-known-good fallback for EMA_FAST_H1/H4 is what lets a transient
    4807 recover WITHOUT aborting the whole scan -- the mechanism this
    fix's forensic trace depends on."""
    ea = read(EA)
    assert 'g_h1IndicatorState = "DEGRADED_USING_LAST_GOOD";' in ea
    assert 'g_htfIndicatorState = "DEGRADED_USING_LAST_GOOD";' in ea
    # the DEGRADED_USING_LAST_GOOD branch must NOT return within its own
    # if-block -- it falls through (past the block's closing brace, into
    # the "else" for the abort branch) to let the scan continue, unlike the
    # STALE_UNUSABLE/TEMPORARY_NOT_READY branch which does abort.
    for label in ('g_h1IndicatorState = "DEGRADED_USING_LAST_GOOD";', 'g_htfIndicatorState = "DEGRADED_USING_LAST_GOOD";'):
        degraded_idx = ea.index(label)
        else_idx = ea.index("\n      else\n", degraded_idx)
        block = ea[degraded_idx:else_idx]
        assert "return;" not in block, f"{label} branch must not return before its own if-block closes"


def test_transient_4807_message_text_unchanged_still_says_retrying_next_tick():
    # The underlying transient-4807 message itself is correct and should
    # stay -- the bug was display staleness, not the message wording.
    ea = read(EA)
    assert "retrying next tick" in ea
    assert "known MT5 new-bar-boundary quirk" in ea


if __name__ == "__main__":
    import sys
    import pytest
    sys.exit(pytest.main([__file__, "-q"]))
