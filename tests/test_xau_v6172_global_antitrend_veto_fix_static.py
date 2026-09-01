from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.17.2.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def test_current_release_source_is_synced_to_backend():
    assert read(EA) == read(BACKEND_EA)


def test_version_bumped_to_v6172():
    ea = read(BACKEND_EA)
    assert '#define XAUAI_EA_VERSION "v6.17.2"' in ea


# ---------------------------------------------------------------------------
# Root cause (proven from the live journal, same day as v6.17.0 shipped): the
# v6.17.0 fix correctly made TREND_PULLBACK propose SELL when Active Direction
# confirmed a STRONG-tier bearish reversal -- but a SEPARATE global veto at the
# end of ScoreSetups() (added in v6.1.3/v6.1.4, before the Direction Engine
# existed) re-applied the old "HTF+H1 agreement always wins" assumption and
# zeroed the candidate right back out, logging "ANTI-TREND VETO BACKSTOP:
# TREND_PULLBACK SELL during htfBullConsensus (should not happen in v6.1.4)"
# -- it did happen, on purpose, because v6.17.0 made it possible. The v6.17.0
# fix was necessary but not sufficient; this closes the gap.
# ---------------------------------------------------------------------------
def test_global_antitrend_veto_exempts_active_direction_confirmed_sell():
    ea = read(BACKEND_EA)
    marker = "// v6.1.3 — GLOBAL ANTI-TREND VETO (last line of defence)"
    idx = ea.index(marker)
    window = ea[idx: idx + 2600]
    assert "activeDirectionConfirmsSell" in window
    assert "activeDirectionConfirmsBuy" in window
    assert "!activeDirectionConfirmsSell &&\n      bestType != 1" in window


def test_backstop_veto_exempts_active_direction_confirmed_reversal():
    ea = read(BACKEND_EA)
    marker = "ANTI-TREND VETO BACKSTOP: TREND_PULLBACK SELL during htfBullConsensus"
    idx = ea.rindex(marker)  # the actual veto site, not the comment mentioning it
    window = ea[max(0, idx - 400): idx + 200]
    assert "!activeDirectionConfirmsSell && bestType == 1" in window


def test_veto_still_fires_when_active_direction_has_not_confirmed_reversal():
    # The veto must remain a real safety net -- it should still zero out a
    # genuinely stale/unconfirmed counter-trend candidate (Active Direction
    # NOT SELL_ONLY/BUY_ONLY), not just be disabled outright.
    ea = read(BACKEND_EA)
    marker = "// v6.1.3 — GLOBAL ANTI-TREND VETO (last line of defence)"
    idx = ea.index(marker)
    window = ea[idx: idx + 2600]
    assert 'bestDir = 0; bestScore = 0; bestName = "";' in window


def test_v617_active_direction_candidate_fix_still_intact():
    ea = read(BACKEND_EA)
    marker = "// === SETUP 1: TREND PULLBACK ==="
    idx = ea.index(marker)
    window = ea[idx: idx + 2200]
    assert "if(g_activeDirection == DIRECTION_SELL_ONLY)      dir = -1;" in window


def test_indicator_lifecycle_fix_still_intact():
    ea = read(BACKEND_EA)
    for tag in ("INDICATOR_HANDLE_CREATED", "INDICATOR_NOT_READY", "INDICATOR_REBUILD",
                "INDICATOR_RECOVERED"):
        assert tag in ea
