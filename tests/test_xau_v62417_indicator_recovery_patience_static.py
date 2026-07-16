import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.24.17.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def test_current_release_source_is_synced_to_backend():
    assert read(EA) == read(BACKEND_EA)


def test_version_bumped_to_v62417():
    ea = read(BACKEND_EA)
    assert '#define XAUAI_EA_VERSION "v6.24.17"' in ea
    assert '#define XAUAI_EA_VERSION_NUM "6.24.17"' in ea


def test_header_banner_matches_version_for_website_display():
    ea = read(BACKEND_EA)
    m = re.search(r'v(\d+\.\d+\.\d+)\s*[—\-]+\s*(.+)', ea[:3000])
    assert m is not None
    assert f"v{m.group(1)}" == "v6.24.17"


# ---------------------------------------------------------------------------
# Root cause (24h Mac+VPS watchdog audit, 2026-07-16): the transient-4807
# bucket for EMA_FAST_HTF/H1 (InpContextTF) used a raw attempt-COUNT ceiling
# (transientCeilingFails, default 30). During bursty tick periods that count
# was exhausted in well under 2 seconds of real time -- long before the
# indicator recalculation thread had a realistic chance to catch up -- which
# fell through to a full 11-handle rebuild + 90s backoff + 12s warmup cycle.
# Live evidence: 246 rebuilds in one day on Mac alone, barsCalc==-1 on every
# single failure, and every rebuild eventually recovered anyway (1:1 with
# INDICATOR_RECOVERED) -- proving the data was always reachable with a little
# more real time, not a rebuild. Fix: require a real minimum elapsed-seconds
# floor (streakSecs < minTransientPatienceSec) in addition to the count
# ceiling before ever leaving the no-rebuild transient bucket.
# ---------------------------------------------------------------------------
def test_streak_start_tracked_per_label():
    ea = read(BACKEND_EA)
    assert "datetime   g_indFailStreakStart[20];" in ea
    # reset alongside the existing per-label fail-count reset, both on decay
    # and on success, so a genuinely NEW streak starts its patience clock over
    assert "g_indFailStreakStart[idx] = 0;" in ea
    assert "if(idx >= 0) { g_indFailCounts[idx] = 0; g_indFailStreakStart[idx] = 0; }" in ea


def test_streak_start_stamped_on_first_failure_of_a_new_streak():
    ea = read(BACKEND_EA)
    assert "if(g_indFailCounts[failIdx] == 0) g_indFailStreakStart[failIdx] = TimeCurrent();" in ea


def test_transient_bucket_requires_real_elapsed_seconds_not_just_attempt_count():
    ea = read(BACKEND_EA)
    assert "int minTransientPatienceSec = 30;" in ea
    assert (
        "bool transientRetryOnly = (!staleHandle && err == 4807 &&\n"
        "                              (labelFailCount < transientCeilingFails || streakSecs < minTransientPatienceSec));"
    ) in ea


def test_streak_seconds_computed_from_streak_start_not_last_failure_time():
    ea = read(BACKEND_EA)
    # must derive from g_indFailStreakStart (streak-begin), not g_indFailAtTimes
    # (most-recent-failure) -- using the latter would make streakSecs ~0 on
    # every tick and defeat the whole patience floor
    assert "g_indFailStreakStart[failIdx] > 0)\n" in ea
    assert "(int)(TimeCurrent() - g_indFailStreakStart[failIdx]) : 0;" in ea
