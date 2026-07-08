from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.17.8.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def test_current_release_source_is_synced_to_backend():
    assert read(EA) == read(BACKEND_EA)


def test_version_bumped_to_v6178():
    ea = read(BACKEND_EA)
    assert '#define XAUAI_EA_VERSION "v6.17.8"' in ea


def test_header_banner_matches_property_version_for_website_display():
    import re
    ea = read(BACKEND_EA)
    m = re.search(r'v(\d+\.\d+\.\d+)\s*[—\-]+\s*(.+)', ea[:3000])
    assert m is not None
    assert f"v{m.group(1)}" == "v6.17.8"


# ---------------------------------------------------------------------------
# Root cause, proven from the live MT5 journal (2026-07-08, 00:50-03:45,
# v6.17.7): TREND_PULLBACK repeatedly proposed BUY (via htfBullConsensus, an
# EMA-vs-EMA CROSS measure -- slow, lagging) while SmartGuard's own
# AdaptiveXAUConfirm (TFDirectionByEMA, a PRICE-vs-single-EMA measure -- fast,
# current) showed M15/M30/H1 all AGAINST BUY, every single cycle for ~3
# hours straight (00:50, 01:20, 01:30, 01:35, 01:45, 03:00, 03:10, 03:20,
# 03:25, 03:35, 03:40, 03:45 -- same fastScore=20/85 or 0/85 block, same
# "multiple fast TFs against" reason, repeating). Active Direction was
# DIRECTION_BOTH_ALLOWED at every one of these timestamps -- neither
# direction was structurally forced, but TREND_PULLBACK's fallback still
# blindly trusted the stale htfBullConsensus cross instead of the fresher
# M15/M30 reads its own downstream gate was about to check anyway.
# ---------------------------------------------------------------------------
def test_trend_pullback_defers_to_fresh_m15_m30_when_active_direction_neutral():
    ea = read(BACKEND_EA)
    marker = "int dir;\n      if(g_activeDirection == DIRECTION_SELL_ONLY)      dir = -1;"
    idx = ea.index(marker)
    # v6.17.9 widened this window: the override was extended to also apply
    # during TRANSITION_WAIT (Case C), not just BOTH_ALLOWED.
    window = ea[idx: idx + 2900]
    assert "if(g_activeDirection == DIRECTION_BOTH_ALLOWED || g_activeDirection == DIRECTION_TRANSITION_WAIT)" in window
    assert 'TFDirectionByEMA(dir, PERIOD_M15, 0.05, freshWhyM15)' in window
    assert 'TFDirectionByEMA(dir, InpContextTF, 0.05, freshWhyM30)' in window
    assert "if(freshM15Dir == -dir && freshM30Dir == -dir)" in window
    assert "dir = -dir;" in window


def test_override_requires_both_m15_and_m30_to_disagree_not_just_one():
    # A single noisy timeframe must not flip the candidate -- both fast reads
    # must independently confirm the opposite direction.
    ea = read(BACKEND_EA)
    marker = "if(g_activeDirection == DIRECTION_BOTH_ALLOWED || g_activeDirection == DIRECTION_TRANSITION_WAIT)\n      {\n         string freshWhyM15"
    assert marker in ea
    idx = ea.index(marker)
    window = ea[idx: idx + 600]
    assert "freshM15Dir == -dir && freshM30Dir == -dir" in window
    assert "freshM15Dir == -dir || freshM30Dir == -dir" not in window


def test_override_only_applies_when_active_direction_is_neutral():
    # If Active Direction has already made a STRONG/MEDIUM call (SELL_ONLY/
    # BUY_ONLY), that call must NOT be second-guessed by this override --
    # only the genuinely undecided BOTH_ALLOWED/TRANSITION_WAIT cases trigger it.
    ea = read(BACKEND_EA)
    marker = "if(g_activeDirection == DIRECTION_SELL_ONLY)      dir = -1;"
    idx = ea.index(marker)
    window = ea[idx: idx + 2900]
    override_idx = window.index("if(g_activeDirection == DIRECTION_BOTH_ALLOWED || g_activeDirection == DIRECTION_TRANSITION_WAIT)")
    # The override check must come AFTER the SELL_ONLY/BUY_ONLY branches, and
    # be a separate, narrower condition -- not replacing them.
    assert window.index("dir = -1;") < override_idx
    assert window.index("dir = 1;") < override_idx


def test_missed_symmetric_opportunity_telemetry_superseded_by_full_recheck():
    # v6.17.9 upgraded this from a diagnostic-only YES/NO flag into a full,
    # ACTIVE Symmetric Opportunity Recheck (see
    # test_xau_v6179_symmetric_opportunity_recheck_static.py) -- the simple
    # MissedSymmetricOpportunity=YES/NO strings no longer exist by design,
    # replaced by the richer SYMMETRIC_OPPORTUNITY_RECHECK telemetry line.
    ea = read(BACKEND_EA)
    assert "MissedSymmetricOpportunity" not in ea
    assert "SYMMETRIC_OPPORTUNITY_RECHECK" in ea


def test_smart_guard_hard_block_return_still_present():
    # The v6.17.9 Symmetric Opportunity Recheck must not have removed the
    # actual hard block -- SmartGuard must still return when neither the
    # original nor the opposite-direction retry passes.
    ea = read(BACKEND_EA)
    marker = 'sgMsg += " | " + symMsg;'
    idx = ea.index(marker)
    window = ea[idx: idx + 560]
    assert 'Print("TRADE BLOCKED BECAUSE: ", sgMsg);' in window
    assert "return;" in window


def test_prior_session_fixes_still_intact():
    ea = read(BACKEND_EA)
    assert "if(g_activeDirection == DIRECTION_SELL_ONLY)      dir = -1;" in ea  # v6.17.0
    assert "activeDirectionConfirmsSell" in ea  # v6.17.2
    assert "antiRepeatBlocksSMOB" in ea  # v6.17.3
    assert "InpMaxTransitionWaitBars" in ea  # v6.17.4
    assert "continuationPersonalitySoftPass" in ea  # v6.17.6
    assert "spread / 0.0040 * 100.0" in ea  # v6.17.7 ADX proxy fix
    assert "bool OpenTrade(int signal, double atr, string reason, double sizeMulti)" in ea  # v6.17.7
