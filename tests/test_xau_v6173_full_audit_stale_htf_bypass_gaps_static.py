from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.17.3.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def test_current_release_source_is_synced_to_backend():
    assert read(EA) == read(BACKEND_EA)


def test_version_bumped_to_v6173():
    ea = read(BACKEND_EA)
    assert '#define XAUAI_EA_VERSION "v6.17.3"' in ea


# ---------------------------------------------------------------------------
# Root cause: a full-file audit (triggered by the user asking for a complete
# debug pass, not one bug at a time) found that STRONG_MOMENTUM_OVERRIDE's
# B-grade quality bypass and its Personality-Gate bypass had NO anti-repeat-
# loss guard and NO XAU_StructuralBypassAllowed() gate -- unlike the
# functionally identical SMART-GUARD bypass a few dozen lines away, which had
# both. Both are live by default (InpXAU_StrongMomentumOverride=true,
# InpXAU_SMO_AllowBGradeBalanced=true, InpTradeMode=BALANCED_MODE), so a
# repeated same-direction B-grade signal could be softened into a trade
# through this side door during an active loss streak -- reproducing the
# exact 2026-07-03 incident pattern this session's earlier fixes were meant
# to close, just via an unaudited code path.
# ---------------------------------------------------------------------------
def test_damage_b_quality_bypass_has_antirepeat_and_structural_gate():
    ea = read(BACKEND_EA)
    marker = 'if(!AdaptiveXAUConfirm(signal, "DAMAGE-B-QUALITY-" + setupName,'
    idx = ea.index(marker)
    window = ea[idx: idx + 3200]
    assert "antiRepeatBlocksSMOB" in window
    assert "!antiRepeatBlocksSMOB && XAU_StructuralBypassAllowed()" in window


def test_personality_gate_bypass_has_antirepeat_and_structural_gate():
    # Window widened in v6.17.6: continuationPersonalitySoftPass was added
    # (Codex, v6.17.5) plus a longer explanatory comment (v6.17.6), pushing
    # the STRONG_MOMENTUM_OVERRIDE branch this test checks further from the
    # section marker. Verified directly that the assertion target is still
    # present in the source before widening this window -- this was a test
    # window-size bug, not a code regression.
    # Widened again in v6.17.23: unrelated new code (adaptive timing
    # classifier, banner/changelog comments) earlier in the file pushed the
    # marker-to-target distance to ~4970 chars. Same non-regression as above --
    # verified the target string is still present before widening.
    ea = read(BACKEND_EA)
    marker = "// v6.4.0 UPGRADE 1 — Market Personality Gate"
    idx = ea.index(marker)
    window = ea[idx: idx + 5200]
    assert "!XAU_AntiRepeatLossActive(signal) && XAU_StructuralBypassAllowed()" in window


def test_smart_guard_bypass_unaffected_still_has_its_own_gates():
    # Guard against the fix accidentally touching the sibling gate that was
    # already correct.
    ea = read(BACKEND_EA)
    marker = 'if(!AdaptiveXAUConfirm(signal, "SMART-GUARD",'
    idx = ea.index(marker)
    window = ea[idx: idx + 1200]
    assert "antiRepeatBlocks = XAU_AntiRepeatLossActive(signal)" in window
    assert "!antiRepeatBlocks && XAU_StructuralBypassAllowed()" in window


def test_strong_momentum_precheck_exempts_confirmed_active_direction():
    ea = read(BACKEND_EA)
    marker = "bool XAU_BasicStrongMomentumPrecheck(int signal, string setupName, double combinedScore,"
    idx = ea.index(marker)
    window = ea[idx: idx + 2200]
    assert "activeDirectionConfirmsSignal" in window
    assert "g_htfConsensusDir == -signal && !activeDirectionConfirmsSignal" in window


def test_strong_momentum_override_allowed_exempts_confirmed_active_direction():
    ea = read(BACKEND_EA)
    marker = "bool XAU_StrongMomentumOverrideAllowed(int signal, string setupName, double combinedScore,"
    idx = ea.index(marker)
    window = ea[idx: idx + 2600]
    assert "activeDirectionConfirmsSignalFull" in window


def test_news_momentum_entry_htf_aligned_exempts_active_direction():
    ea = read(BACKEND_EA)
    marker = "bool m15Momentum = signal > 0 ? (m15Close >= m15Open) : (m15Close <= m15Open);"
    idx = ea.index(marker)
    window = ea[idx: idx + 900]
    assert "g_activeDirection == DIRECTION_BUY_ONLY" in window
    assert "g_activeDirection == DIRECTION_SELL_ONLY" in window


def test_news_aftermath_fast_track_htf_aligned_exempts_active_direction():
    ea = read(BACKEND_EA)
    marker = "bool gradeOk = (grade == \"A\" || StringFind(grade, \"A+\") >= 0);"
    idx = ea.index(marker)
    window = ea[idx: idx + 900]
    assert "g_activeDirection == DIRECTION_BUY_ONLY" in window
    assert "g_activeDirection == DIRECTION_SELL_ONLY" in window


def test_header_banner_matches_property_version_for_website_display():
    # Root cause of the user's earlier "download still shows v6.14.0" report:
    # backend/server.py's _get_ea_meta() regex-parses the first 3000 chars of
    # this file for "vX.Y.Z --- <edition>" -- NOT the #property version/
    # XAUAI_EA_VERSION defines further down. Every version bump this session
    # (v6.15.0-v6.17.2) updated the defines but left this top banner at
    # v6.14.0, so the live site kept showing v6.14.0 regardless. This test
    # locks the parser's actual behavior so a future bump can't silently
    # repeat the same mistake.
    import re
    ea = read(BACKEND_EA)
    m = re.search(r'v(\d+\.\d+\.\d+)\s*[—\-]+\s*(.+)', ea[:3000])
    assert m is not None
    assert f"v{m.group(1)}" == "v6.17.3"
    edition = m.group(2).strip().rstrip("|").strip()
    assert edition and "6.14.0" not in edition


def test_prior_fixes_still_intact():
    ea = read(BACKEND_EA)
    assert "if(g_activeDirection == DIRECTION_SELL_ONLY)      dir = -1;" in ea  # v6.17.0
    assert "activeDirectionConfirmsSell" in ea  # v6.17.2 global veto fix
    assert "INDICATOR_HANDLE_CREATED" in ea  # v6.17.1
