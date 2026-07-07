from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.17.0.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def test_current_release_source_is_synced_to_backend():
    assert read(EA) == read(BACKEND_EA)


def test_version_bumped_to_v6170():
    ea = read(BACKEND_EA)
    assert '#define XAUAI_EA_VERSION "v6.17.0"' in ea


# ---------------------------------------------------------------------------
# Root cause (proven from live journal MQL5/Logs/20260707.log, 15:00-16:10):
# Active Direction correctly held DIRECTION_SELL_ONLY at STRONG tier for over
# an hour straight (M5+M15 aligned bearish, confirmed LH/LL reversal), but
# TREND_PULLBACK/SQUEEZE_RELEASE/RANGE_REVERSAL/RSI_EXTREME/LONDON_FIX_PIN/
# MULTI_EXTREME all hardcoded their candidate direction to stale HTF
# consensus and never proposed a SELL candidate for the Direction Engine to
# permit -- 28 ADAPTIVE-DIRECTION BLOCK: TREND_PULLBACK BUY events and 33
# "no setup met regime criteria" (zero candidates in either direction)
# events in the same window. The Direction Engine was working correctly;
# candidate generation was structurally incapable of trying the permitted
# direction.
# ---------------------------------------------------------------------------
def test_trend_pullback_direction_can_follow_active_direction_engine():
    ea = read(BACKEND_EA)
    marker = "// === SETUP 1: TREND PULLBACK ==="
    idx = ea.index(marker)
    window = ea[idx: idx + 2200]
    assert "if(g_activeDirection == DIRECTION_SELL_ONLY)      dir = -1;" in window
    assert "else if(g_activeDirection == DIRECTION_BUY_ONLY)  dir = 1;" in window
    # The stale-HTF fallback must still exist -- this is an addition, not a
    # removal of the original HTF-alignment behavior.
    assert "else if(htfBullConsensus)       dir = 1;" in window


def test_squeeze_release_active_direction_overrides_stale_htf_veto():
    ea = read(BACKEND_EA)
    marker = "// === SETUP 4: SQUEEZE RELEASE ==="
    idx = ea.index(marker)
    window = ea[idx: idx + 1400]
    assert "dirConfirmedByActiveDirection" in window
    assert "if(!dirConfirmedByActiveDirection)" in window


def test_range_reversal_both_branches_respect_active_direction():
    ea = read(BACKEND_EA)
    marker = "// === SETUP 2: RANGE REVERSAL ==="
    idx = ea.index(marker)
    window = ea[idx: idx + 2000]
    assert "rangeRevBuyDirConfirmed" in window
    assert "rangeRevSellDirConfirmed" in window


def test_rsi_extreme_london_fix_multi_extreme_respect_active_direction():
    ea = read(BACKEND_EA)
    for marker in ("// === SETUP 5: RSI EXTREME", "// === SETUP 6: LONDON FIX PIN",
                   "// === SETUP 7: DXY REVERSAL"):
        idx = ea.index(marker)
        window = ea[idx: idx + 1600]
        assert "g_activeDirection == DIRECTION_" in window, f"{marker} missing Active Direction override"


def test_htf_trend_follow_unaffected_by_this_fix():
    # HTF_TREND_FOLLOW's entire purpose is to follow HTF -- it should NOT gain
    # a stale-HTF override (that would defeat the setup's design). It stays
    # gated purely by its own existing directionAllowsHtfTf check.
    ea = read(BACKEND_EA)
    marker = "// === SETUP 9: HTF TREND FOLLOW ==="
    idx = ea.index(marker)
    window = ea[idx: idx + 5000]
    assert "directionAllowsHtfTf" in window
    assert "g_activeDirection == DIRECTION_SELL_ONLY)      dir = -1" not in window


def test_asia_range_breakout_untouched_already_direction_agnostic():
    # Setup 8 derives direction from actual price breakout, not HTF bias --
    # confirms it needed no fix (no htfBullConsensus/h1TrendDir dependency).
    ea = read(BACKEND_EA)
    marker = "// === SETUP 8: ASIA RANGE BREAKOUT"
    idx = ea.index(marker)
    window = ea[idx: idx + 1200]
    assert "htfBullConsensus" not in window
    assert "h1TrendDir" not in window
