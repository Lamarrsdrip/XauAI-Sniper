from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.17.6.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def test_current_release_source_is_synced_to_backend():
    assert read(EA) == read(BACKEND_EA)


def test_version_bumped_to_v6176():
    ea = read(BACKEND_EA)
    assert '#define XAUAI_EA_VERSION "v6.17.6"' in ea


def test_header_banner_matches_property_version_for_website_display():
    import re
    ea = read(BACKEND_EA)
    m = re.search(r'v(\d+\.\d+\.\d+)\s*[—\-]+\s*(.+)', ea[:3000])
    assert m is not None
    assert f"v{m.group(1)}" == "v6.17.6"


# ---------------------------------------------------------------------------
# Profit-impact audit (user-requested full decision-funnel investigation).
# Root cause, proven from the live MT5 journal (2026-07-07 19:55:11, running
# v6.17.4): a STRONG-tier Active-Direction-confirmed SELL BREAKOUT
# (signalPrice=4126.63, currentRegime already REGIME_BREAKOUT_DOWN) was
# hard-blocked by "PERSONALITY GATE BLOCK: BREAKOUT grade not A/A+ in RANGE
# -- skipping" because g_marketPersonality (a slower ADX/ATR-based
# classifier) still read MKT_RANGE. Price fell from 4126.63 to a confirmed
# swing low of 4092.19 within the next hour (~34pts, ~3.4R at this EA's
# typical SL distance), with the Direction Engine holding STRONG SELL_ONLY
# essentially the whole way and no meaningful adverse excursion first --
# a real, quantified missed profitable trade, not a hypothetical.
#
# Codex's v6.17.5 had already added the correct structural exemption
# (continuationPersonalitySoftPass: confirmed breakout continuation + regime
# alignment + Active Direction not hostile) but left it gated behind
# XAU_StructuralBypassAllowed(), which only opens under InpAIMode=AI_DIRECTOR
# -- NOT the default AI_FILTER_ONLY. So the fix never actually fired under
# default settings. This is the same Category A (structural) vs Category B
# (AI-opinion) miscategorization already fixed elsewhere this session.
#
# Separately investigated: SQUEEZE_RELEASE candidates blocked by
# "momentum slowdown" (PROFIT GUARDIAN) and "FAILED-IMPULSE BLOCK" the same
# day were traced to real price action and found to be genuinely late
# chase-entries into an already-exhausted move (price never made a new low
# beyond the 4092.19 already established before those signals fired) --
# i.e. those specific blocks were CORRECT selectivity, not overblocking.
# Deliberately NOT touched; no evidence justified a change there.
# ---------------------------------------------------------------------------
def test_continuation_personality_soft_pass_no_longer_requires_ai_director_mode():
    ea = read(BACKEND_EA)
    marker = "// v6.4.0 UPGRADE 1 — Market Personality Gate"
    idx = ea.index(marker)
    window = ea[idx: idx + 4200]
    assert "if(continuationPersonalitySoftPass && !XAU_AntiRepeatLossActive(signal))" in window
    # Must NOT require XAU_StructuralBypassAllowed() on this specific branch.
    continuation_branch_start = window.index("if(continuationPersonalitySoftPass")
    continuation_branch_end = window.index("else if(strongMomentumPrecheck")
    continuation_branch = window[continuation_branch_start:continuation_branch_end]
    assert "XAU_StructuralBypassAllowed" not in continuation_branch


def test_strong_momentum_override_branch_still_requires_ai_director_mode():
    # STRONG_MOMENTUM_OVERRIDE (an AI-opinion-flavored quality signal, distinct
    # from the structural breakout-continuation read) must keep its
    # AI-authority-mode gate -- this fix is a narrow, evidence-backed carve-out,
    # not a general loosening of every PERSONALITY-gate bypass.
    ea = read(BACKEND_EA)
    marker = "else if(strongMomentumPrecheck && InpXAU_SMO_AllowBGradeBalanced &&"
    idx = ea.index(marker)
    window = ea[idx: idx + 200]
    assert "XAU_StructuralBypassAllowed()" in window


def test_anti_repeat_loss_guard_still_enforced_on_the_fixed_branch():
    ea = read(BACKEND_EA)
    marker = "if(continuationPersonalitySoftPass && !XAU_AntiRepeatLossActive(signal))"
    assert marker in ea


def test_squeeze_release_momentum_slowdown_gate_untouched():
    # Confirmed from real journal evidence that this gate is working correctly
    # (blocked two genuinely late SQUEEZE_RELEASE chase-entries on 2026-07-07)
    # -- must remain a hard block, not softened by this fix.
    ea = read(BACKEND_EA)
    fn_start = ea.index("bool momentumHardBlock = (momentumBad && !breakoutContinuation && !momentumSoftMode);")
    window = ea[fn_start: fn_start + 500]
    assert "bool allow = (fastScore >= requiredFast && fastAgainst < 2 && !momentumHardBlock);" in window


def test_prior_session_fixes_still_intact():
    ea = read(BACKEND_EA)
    assert "if(g_activeDirection == DIRECTION_SELL_ONLY)      dir = -1;" in ea  # v6.17.0
    assert "activeDirectionConfirmsSell" in ea  # v6.17.2
    assert "antiRepeatBlocksSMOB" in ea  # v6.17.3
    assert "InpMaxTransitionWaitBars" in ea  # v6.17.4
    assert "OPEN_TRADE_CALLED" in ea  # v6.17.5 (Codex)
