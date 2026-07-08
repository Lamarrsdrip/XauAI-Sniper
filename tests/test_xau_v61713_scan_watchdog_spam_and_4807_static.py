from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.17.13.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def body(src: str, signature: str) -> str:
    idx = src.index(signature)
    start = src.index("{", idx)
    depth = 0
    for i in range(start, len(src)):
        if src[i] == "{":
            depth += 1
        elif src[i] == "}":
            depth -= 1
            if depth == 0:
                return src[start:i + 1]
    raise AssertionError(f"unbalanced braces for {signature}")


def test_current_release_source_is_synced_to_backend():
    assert read(EA) == read(BACKEND_EA)


def test_version_bumped_to_v61713():
    ea = read(BACKEND_EA)
    assert '#define XAUAI_EA_VERSION "v6.17.13"' in ea


def test_header_banner_matches_property_version_for_website_display():
    import re
    ea = read(BACKEND_EA)
    m = re.search(r'v(\d+\.\d+\.\d+)\s*[—\-]+\s*(.+)', ea[:3000])
    assert m is not None
    assert f"v{m.group(1)}" == "v6.17.13"


# ---------------------------------------------------------------------------
# Root cause, confirmed from the LIVE MT5 journal (2026-07-08, MQL5/Logs/
# 20260708.log, terminal instance at
# "Program Files/MetaTrader 5/MQL5/Logs/"): EMA_FAST_M5 failed every scan
# attempt with err=4807 (ERR_INDICATOR_DATA_NOT_FOUND) -- the exact error
# this file's own v6.17.1 comment already documents as "a transient MT5
# quirk at new-bar boundaries." Despite that, hitting InpIndicatorReloadFails
# (3) consecutive 4807s still triggered a full handle rebuild every time,
# which the live evidence proved does NOT help: the freshly-rebuilt handle
# copied successfully exactly ONCE, then failed with the SAME err=4807
# again almost immediately, repeating in a ~90s rebuild/warmup/fail loop
# that ran for 20+ minutes straight (1178+ seconds observed) with ZERO
# completed scans -- while the position-open bug and the flat/no-position
# case are BOTH explained by this single mechanism, since it fires
# regardless of position state. Compounding this, the watchdog's own
# "forcing entry scan" Print was completely unthrottled, producing dozens
# of identical log lines per SECOND for the entire duration.
# ---------------------------------------------------------------------------
def test_err_4807_no_longer_triggers_a_rebuild():
    ea = read(BACKEND_EA)
    fn = body(ea, "bool CopyEntryBuffer(int handle, int buffer, int start, int count, double &target[], string label)")
    assert "bool transientRetryOnly = (!staleHandle && err == 4807 && labelFailCount < transientCeilingFails);" in fn
    assert "INDICATOR_TRANSIENT_4807" in fn
    # The transient path must return false (retry next tick) WITHOUT reaching
    # the rebuild block.
    transient_idx = fn.index("if(transientRetryOnly)")
    rebuild_idx = fn.index("if(RebuildEntryIndicatorHandles(why))")
    assert transient_idx < rebuild_idx


def test_transient_4807_path_has_a_safety_ceiling():
    # Must not unconditionally trust "it's always transient" forever -- if a
    # genuinely broken handle happens to also present as 4807, this must
    # eventually escalate to the normal rebuild path.
    ea = read(BACKEND_EA)
    assert "int transientCeilingFails = MathMax(20, InpIndicatorReloadFails * 10);" in ea
    assert "labelFailCount < transientCeilingFails" in ea


def test_stale_handle_and_other_errors_still_rebuild_normally():
    # Only the specific, already-documented-as-transient 4807 case skips the
    # rebuild -- a truly invalid handle, or any OTHER error code, must still
    # go through the existing rebuild/backoff machinery unchanged.
    ea = read(BACKEND_EA)
    fn = body(ea, "bool CopyEntryBuffer(int handle, int buffer, int start, int count, double &target[], string label)")
    assert "if(staleHandle || (InpIndicatorReloadFails > 0 && labelFailCount >= InpIndicatorReloadFails))" in fn


# ---------------------------------------------------------------------------
# Watchdog spam: the live journal showed 14+ identical unthrottled
# "SCAN WATCHDOG: forcing entry scan" lines within a single second.
# ---------------------------------------------------------------------------
def test_watchdog_print_is_now_throttled():
    ea = read(BACKEND_EA)
    marker = "if(watchdogDue && !newM5Bar)"
    idx = ea.index(marker)
    window = ea[idx: idx + 500]
    assert "g_lastWatchdogLog" in window
    assert "InpScanSkipLogSec" in window


def test_watchdog_log_timestamp_declared():
    ea = read(BACKEND_EA)
    assert "datetime   g_lastWatchdogLog = 0;" in ea


# ---------------------------------------------------------------------------
# Explicit scan-cycle state logging, per the requested taxonomy:
# SCAN_STARTED / SCAN_ABORTED reason=<exact> / SCAN_COMPLETED_*
# ---------------------------------------------------------------------------
def test_scan_started_logged_before_indicator_loads():
    ea = read(BACKEND_EA)
    marker = 'XAU_LogScanState("SCAN_STARTED");'
    assert marker in ea
    idx = ea.index(marker)
    first_copy_idx = ea.index('if(!CopyEntryBuffer(hEMAFast, 0, 0, 12, bufEMAFast, "EMA_FAST_M5"))')
    assert idx < first_copy_idx


def test_all_14_indicator_buffers_log_scan_aborted_with_exact_reason():
    ea = read(BACKEND_EA)
    start = ea.index('XAU_LogScanState("SCAN_STARTED");')
    end = ea.index("g_indicatorBufferFailCount = 0;", start)
    window = ea[start:end]
    assert window.count("XAU_LogScanAborted(g_lastSkipReason)") == 14


def test_scan_completed_logged_with_candidate_vs_no_trade_distinction():
    ea = read(BACKEND_EA)
    marker = 'XAU_RecordMarketSnapshot("SCAN_EVALUATED", signal, setupName, grade, setupScore, combinedScore);'
    idx = ea.index(marker)
    window = ea[idx: idx + 400]
    assert 'XAU_LogScanState((signal != 0 && grade != "SKIP") ? "SCAN_COMPLETED_CANDIDATE" : "SCAN_COMPLETED_NO_TRADE");' in window


def test_scan_state_logging_deduplicates_identical_repeats():
    ea = read(BACKEND_EA)
    fn = body(ea, "void XAU_LogScanState(string state)")
    assert "g_lastScanStateLogged" in fn
    assert "state == g_lastScanStateLogged" in fn
    # Must not print every single occurrence of the same state -- only the
    # transition, plus a periodic (not per-tick) resurface.
    assert "lastResurfaceAt" in fn
    assert ">= 60" in fn


def test_scan_aborted_helper_reuses_state_dedup():
    ea = read(BACKEND_EA)
    fn = body(ea, "void XAU_LogScanAborted(string reason)")
    assert "XAU_LogScanState" in fn


# ---------------------------------------------------------------------------
# Unified with the prior open-position-blackout investigation (v6.17.12):
# that fix (watchdog timestamp moved to after a scan completes) is what made
# THIS bug visible/provable in the first place -- before it, the watchdog
# never fired at all during a stall, so this indicator issue was silently
# masked. Confirm the v6.17.12 fix is still intact.
# ---------------------------------------------------------------------------
def test_v61712_watchdog_completion_timestamp_fix_still_intact():
    ea = read(BACKEND_EA)
    assert "g_lastEntryScanAt = TimeCurrent(); // v6.17.12: watchdog stamp moved here" in ea


def test_prior_fixes_still_intact():
    ea = read(BACKEND_EA)
    assert "bool XAU_AIIsAdvisoryOnly()" in ea
    assert "int pgOppSignalFound = ScoreSetups(pgOppScore, pgOppSetupName, signal);" in ea  # v6.17.10
    assert "int oppSignalFound = ScoreSetups(oppScore, oppSetupName, signal);" in ea  # v6.17.9
    assert "freshM15Dir == -dir && freshM30Dir == -dir" in ea  # v6.17.8
