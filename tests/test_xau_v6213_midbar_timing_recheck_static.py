"""
Regression tests for the v6.21.3 mid-bar timing-recheck fix (2026-07-13
forensic incident): a pending entry confirmation's wall-clock delay could
expire mid-candle but not get re-evaluated until the next M5 bar opened
(proven live: 150s target, 297s actual elapsed before recheck), because the
top-level scan gate required a new M5 bar (or a 7-minute watchdog) to even
reach XAU_TimingEngineConfirmsEntry().

Static-source tests, matching this repo's established convention.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.23.1.mq5"
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


def test_repo_source_is_synced_to_backend():
    assert read(EA) == read(BACKEND_EA)


def test_pending_confirm_due_bypasses_the_m5_bar_gate():
    ea = read(EA)
    idx = ea.index("double pendingRequiredDelay")
    window = ea[idx:idx + 1400]
    assert "g_pendingEntryConfirm.active" in window
    assert "XAU_EffectiveAdaptiveEntryDelaySeconds(g_pendingEntryConfirm.dir)" in window
    assert "TimeCurrent() - g_pendingEntryConfirm.firstSeenTime) >= pendingRequiredDelay" in window
    assert "if(!newM5Bar && !watchdogDue && !timerForced && !pendingConfirmDue)" in window


def test_new_candidate_detection_still_m5_bar_cadenced():
    # The fix must be scoped to an ALREADY-ARMED pending confirmation, not a
    # general per-tick rescan -- fresh candidate detection stays on the M5
    # cadence exactly as before (cost/architecture unchanged).
    ea = read(EA)
    idx = ea.index("bool pendingConfirmDue")
    window = ea[idx:idx + 1400]
    # the skip-and-return branch (brand new candidates get no scan) is
    # unchanged in structure -- still keyed on newM5Bar/watchdogDue/timerForced
    assert "WAITING_FOR_NEW_M5_BAR: cur=%s last=%s sinceScan=%ds" in window


def test_bypass_is_logged_distinctly_from_a_real_new_bar():
    ea = read(EA)
    assert "TIMING_ENGINE: PENDING_CONFIRM_DUE_MIDBAR" in ea
    idx = ea.index("TIMING_ENGINE: PENDING_CONFIRM_DUE_MIDBAR")
    log_call = ea[ea.rindex("PrintFormat(", 0, idx):idx + 500]
    assert "elapsed=" in log_call and "target=" in log_call


def test_anti_chase_logic_in_timing_engine_unchanged():
    ea = read(EA)
    fn = body(ea, "bool XAU_TimingEngineConfirmsEntry(int dir, string setup, string grade, double sizeMulti, double atr)")
    for reason in ("PRICE_RAN_TOO_FAR_CHASE", "STRUCTURE_FLIPPED", "STILL_LATE_CHASE_AFTER_DELAY", "SPREAD_TOO_WIDE"):
        assert reason in fn, f"missing anti-chase path: {reason}"
    assert "InpCancelIfPriceMovedTooFarATR" in fn


def test_timing_engine_still_computes_wall_clock_elapsed_not_bar_count():
    ea = read(EA)
    fn = body(ea, "bool XAU_TimingEngineConfirmsEntry(int dir, string setup, string grade, double sizeMulti, double atr)")
    assert "double elapsedSec = (double)(TimeCurrent() - g_pendingEntryConfirm.firstSeenTime);" in fn
    assert "if(elapsedSec < delaySec)" in fn


def test_counter_excursion_never_calls_the_timing_engine():
    ea = read(EA)
    entry_fn = body(ea, "void XAU_TryCounterExcursionEntry(int originalSignal, string setupName, string grade,")
    assert "XAU_TimingEngineConfirmsEntry" not in entry_fn
    assert "g_pendingEntryConfirm" not in entry_fn


def test_reentry_routes_through_the_same_shared_timing_engine_not_a_separate_bar_wait():
    ea = read(EA)
    reentry_fn = body(ea, "void CheckReEntryOpportunity()")
    assert "XAU_TimingEngineConfirmsEntry(lastClose.dir, \"RE_ENTRY\", \"A\", InpReEntrySize, bufATR[1])" in reentry_fn
    # RE_ENTRY must not have its own bar-boundary wait bolted on separately
    assert "newM5Bar" not in reentry_fn
