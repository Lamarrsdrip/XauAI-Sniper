from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.17.1.mq5"
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


def test_version_bumped_to_v6171():
    ea = read(BACKEND_EA)
    assert '#define XAUAI_EA_VERSION "v6.17.1"' in ea


# ---------------------------------------------------------------------------
# Root cause (proven from live MQL5/Logs/20260707.log, both the local Mac
# instance and matching the VPS-reported symptom): g_indicatorBufferFailCount
# only reset to 0 after a FULLY CLEAN pass of all 14 entry buffers in the same
# scan (CheckForEntry's "g_indicatorBufferFailCount = 0;" line). A single
# buffer's transient ERR_INDICATOR_DATA_NOT_FOUND (4807) blip -- explicitly
# documented in the v5.8.51 comment as a normal, expected, transient MT5 quirk
# at new-bar boundaries -- therefore accumulated FOREVER across the session
# with no decay, so isolated blips hours apart eventually crossed
# InpIndicatorReloadFails (default 3) and triggered a real handle rebuild +
# InpIndicatorWarmupSec (default 12s) warm-up, over and over, even though the
# handles were never actually broken. This is the rebuild loop both the user
# and the Command Center observed.
# ---------------------------------------------------------------------------
def test_fail_counter_resets_on_bounded_time_between_failures():
    # v6.17.7 superseded the single global g_indicatorBufferFailCount with a
    # per-label streak (see test_xau_v6177's indicator-fail-streak tests) --
    # the SAME decay-based reset behavior this test checks for now lives on
    # g_indFailCounts[idx]/g_indFailAtTimes[idx] instead of the old globals.
    ea = read(BACKEND_EA)
    fn = body(ea, "bool CopyEntryBuffer(int handle, int buffer, int start, int count, double &target[], string label)")
    assert "indicatorFailDecaySec" in fn
    assert "g_indFailCounts[failIdx] = 0;" in fn  # decay reset before re-incrementing
    assert "g_indFailCounts[failIdx]++;" in fn


def test_warmup_is_still_bounded_and_not_removed():
    ea = read(BACKEND_EA)
    fn = body(ea, "bool CopyEntryBuffer(int handle, int buffer, int start, int count, double &target[], string label)")
    assert "g_indicatorWarmupUntil > 0 && TimeCurrent() < g_indicatorWarmupUntil" in fn
    assert "InpIndicatorWarmupSec" in ea  # warm-up duration input untouched


def test_valid_handle_returns_true_immediately_without_touching_fail_state():
    ea = read(BACKEND_EA)
    fn = body(ea, "bool CopyEntryBuffer(int handle, int buffer, int start, int count, double &target[], string label)")
    # A successful CopyBuffer must return true before any fail-counter logic runs
    # (and, per v6.17.7, resets only THIS label's own streak on success).
    ok_idx = fn.index("if(got >= count)")
    reset_idx = fn.index("XAU_ResetIndicatorFailStreak(label);")
    fail_idx = fn.index("g_indFailCounts[failIdx]++;")
    assert ok_idx < reset_idx < fail_idx


def test_transient_failure_does_not_immediately_force_rebuild():
    ea = read(BACKEND_EA)
    fn = body(ea, "bool CopyEntryBuffer(int handle, int buffer, int start, int count, double &target[], string label)")
    # Rebuild only fires once the (decay-aware, per-label) count reaches
    # InpIndicatorReloadFails, or the handle is truly INVALID_HANDLE -- never
    # on a single transient blip alone, and never combined across unrelated
    # labels (v6.17.7).
    assert "InpIndicatorReloadFails > 0 && labelFailCount >= InpIndicatorReloadFails" in fn
    assert "staleHandle = (handle == INVALID_HANDLE)" in fn


def test_recovery_backoff_between_rebuilds_still_enforced():
    ea = read(BACKEND_EA)
    fn = body(ea, "bool CopyEntryBuffer(int handle, int buffer, int start, int count, double &target[], string label)")
    assert "InpIndicatorRecoveryBackoffSec" in fn
    assert "rebuildAllowed" in fn


def test_decision_cycles_resume_after_warmup_clears():
    ea = read(BACKEND_EA)
    fn = body(ea, "bool CopyEntryBuffer(int handle, int buffer, int start, int count, double &target[], string label)")
    assert 'g_indicatorWarmupUntil = 0' in fn
    assert "INDICATOR_RECOVERED" in fn


def test_new_lifecycle_telemetry_tags_present():
    ea = read(BACKEND_EA)
    for tag in ("INDICATOR_HANDLE_CREATED", "INDICATOR_NOT_READY", "INDICATOR_COPY_RETRY",
                "INDICATOR_HANDLE_INVALID", "INDICATOR_REBUILD", "INDICATOR_RECOVERED"):
        assert tag in ea, f"missing telemetry tag {tag}"


def test_v617_active_direction_candidate_fix_still_intact():
    # Guard against this indicator-lifecycle fix accidentally touching the
    # v6.17.0 stale-HTF direction fix shipped in the same file.
    ea = read(BACKEND_EA)
    marker = "// === SETUP 1: TREND PULLBACK ==="
    idx = ea.index(marker)
    window = ea[idx: idx + 2200]
    assert "if(g_activeDirection == DIRECTION_SELL_ONLY)      dir = -1;" in window
    assert "else if(g_activeDirection == DIRECTION_BUY_ONLY)  dir = 1;" in window
