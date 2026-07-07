from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.17.4.mq5"
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


def test_version_bumped_to_v6174():
    ea = read(BACKEND_EA)
    assert '#define XAUAI_EA_VERSION "v6.17.4"' in ea


def test_header_banner_matches_property_version_for_website_display():
    import re
    ea = read(BACKEND_EA)
    m = re.search(r'v(\d+\.\d+\.\d+)\s*[—\-]+\s*(.+)', ea[:3000])
    assert m is not None
    assert f"v{m.group(1)}" == "v6.17.4"


# ---------------------------------------------------------------------------
# Root cause (user report, same day as v6.17.2/v6.17.3): WEAK-tier opposition
# inside XAU_ComputeActiveDirection has no natural time limit --
# XAU_AssessFailureAndSweep is a rolling 8-bar lookback comparison, so a
# genuinely choppy/grinding market can keep re-triggering "failed
# continuation" bar after bar without ever confirming a real reversal, and
# the pullback-recognition branch (BOTH_ALLOWED) is explicitly gated OFF
# by noWeakSignalEither whenever that flag is true. Result: TRANSITION_WAIT
# could hold indefinitely with HTF_TREND_FOLLOW/TREND_PULLBACK withheld and
# zero setups scoring in either direction -- a de facto permanent no-trade
# state, confirmed from the live journal.
# ---------------------------------------------------------------------------
def test_input_max_transition_wait_bars_exists_with_sane_default():
    ea = read(BACKEND_EA)
    assert "input int    InpMaxTransitionWaitBars = 6;" in ea


def test_overstay_guard_function_releases_to_both_allowed():
    ea = read(BACKEND_EA)
    fn = body(ea, "ENUM_XAU_ACTIVE_DIRECTION XAU_ResolveOrReleaseTransitionWait(int enteringStreak, string &reason)")
    assert "g_transitionWaitStreak = enteringStreak + 1;" in fn
    assert "InpMaxTransitionWaitBars > 0 && g_transitionWaitStreak > InpMaxTransitionWaitBars" in fn
    assert "return DIRECTION_BOTH_ALLOWED;" in fn
    assert "g_transitionWaitStreak = 0;" in fn  # clears after releasing, doesn't just keep counting


def test_weak_tier_routes_through_overstay_guard():
    ea = read(BACKEND_EA)
    marker = "// ---- WEAK opposition ----"
    idx = ea.index(marker)
    window = ea[idx: idx + 1300]
    assert "return XAU_ResolveOrReleaseTransitionWait(enteringTransitionWaitStreak, reason);" in window


def test_medium_tier_htf_fighting_branches_route_through_overstay_guard():
    ea = read(BACKEND_EA)
    marker = "if(mediumBear)"
    idx = ea.index(marker)
    window = ea[idx: idx + 700]
    assert "XAU_ResolveOrReleaseTransitionWait(enteringTransitionWaitStreak, reason)" in window
    marker2 = "if(mediumBull)"
    idx2 = ea.index(marker2)
    window2 = ea[idx2: idx2 + 700]
    assert "XAU_ResolveOrReleaseTransitionWait(enteringTransitionWaitStreak, reason)" in window2


def test_streak_resets_to_zero_at_top_of_every_call():
    ea = read(BACKEND_EA)
    fn = body(ea, "ENUM_XAU_ACTIVE_DIRECTION XAU_ComputeActiveDirection(int htfBias, string &reason)")
    assert "int enteringTransitionWaitStreak = g_transitionWaitStreak;" in fn
    assert "g_transitionWaitStreak = 0;" in fn


def test_strong_tier_thresholds_unchanged_by_this_fix():
    # The overstay guard must only affect indecision (WEAK/MEDIUM-fighting-HTF)
    # -- a genuine STRONG confirmation must still unlock immediately, same bar,
    # with no dependency on the overstay counter.
    ea = read(BACKEND_EA)
    marker = "if(strongBear)"
    idx = ea.index(marker)
    window = ea[idx: idx + 900]
    assert "XAU_ResolveOrReleaseTransitionWait" not in window
    assert "return DIRECTION_SELL_ONLY;" in window


def test_prior_fixes_still_intact():
    ea = read(BACKEND_EA)
    assert "if(g_activeDirection == DIRECTION_SELL_ONLY)      dir = -1;" in ea  # v6.17.0
    assert "activeDirectionConfirmsSell" in ea  # v6.17.2
    assert "antiRepeatBlocksSMOB" in ea  # v6.17.3
    assert "INDICATOR_HANDLE_CREATED" in ea  # v6.17.1
