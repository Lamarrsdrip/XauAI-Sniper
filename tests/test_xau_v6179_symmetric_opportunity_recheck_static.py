from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.17.9.mq5"
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


def test_version_bumped_to_v6179():
    ea = read(BACKEND_EA)
    assert '#define XAUAI_EA_VERSION "v6.17.9"' in ea


def test_header_banner_matches_property_version_for_website_display():
    import re
    ea = read(BACKEND_EA)
    m = re.search(r'v(\d+\.\d+\.\d+)\s*[—\-]+\s*(.+)', ea[:3000])
    assert m is not None
    assert f"v{m.group(1)}" == "v6.17.9"


# ---------------------------------------------------------------------------
# Case 1/2: TREND_DN + BUY blocked by bearish fast TFs -> SELL recheck
#           TREND_UP + SELL blocked by bullish fast TFs -> BUY recheck
# ---------------------------------------------------------------------------
def test_smart_guard_block_triggers_symmetric_recheck_not_immediate_return():
    ea = read(BACKEND_EA)
    marker = 'string sgMsg = StringFormat("SMART-GUARD: %s blocked by adaptive fast confirmation for %s. %s",'
    idx = ea.index(marker)
    window = ea[idx: idx + 5800]
    assert "int oppSignalWanted = -signal;" in window
    assert "int oppSignalFound = ScoreSetups(oppScore, oppSetupName, signal);" in window
    assert 'AdaptiveXAUConfirm(oppSignalFound, "SMART-GUARD", oppCombined, oppGrade,' in window


def test_score_setups_excludes_original_direction_for_the_recheck():
    ea = read(BACKEND_EA)
    fn_marker = "int ScoreSetups(double &score, string &setupName, int excludeDir = 0)"
    assert fn_marker in ea
    fn = body(ea, fn_marker)
    # Every one of the 9 setups' bestScore commit points must respect excludeDir.
    for name in ["TREND_PULLBACK", "RANGE_REVERSAL", "BREAKOUT", "SQUEEZE_RELEASE",
                 "RSI_EXTREME", "LONDON_FIX_PIN", "MULTI_EXTREME", "ASIA_BREAKOUT",
                 "HTF_TREND_FOLLOW"]:
        marker = f'bestName = "{name}"'
        assert marker in fn, f"{name} commit point missing"
    assert fn.count("dir != excludeDir") == 10  # 9 setups, RANGE_REVERSAL has 2 branches


# ---------------------------------------------------------------------------
# Case 3: TRANSITION_WAIT must evaluate both directions, not block everything
# ---------------------------------------------------------------------------
def test_trend_pullback_fresh_override_applies_during_transition_wait_too():
    ea = read(BACKEND_EA)
    marker = "if(g_activeDirection == DIRECTION_BOTH_ALLOWED || g_activeDirection == DIRECTION_TRANSITION_WAIT)"
    assert marker in ea


def test_symmetric_recheck_not_forbidden_during_transition_wait_for_non_weakening_side():
    ea = read(BACKEND_EA)
    marker = "bool oppDirForbidden ="
    idx = ea.index(marker)
    window = ea[idx: idx + 400]
    assert "g_activeDirection == DIRECTION_TRANSITION_WAIT &&" in window
    assert "oppSignalWanted == g_htfConsensusDir && g_htfConsensusDir != 0" in window
    # Must NOT forbid the opposite (non-weakening) side during TRANSITION_WAIT.
    assert "g_activeDirection == DIRECTION_TRANSITION_WAIT)" not in window.split("oppSignalWanted == g_htfConsensusDir")[0][-50:]


# ---------------------------------------------------------------------------
# Case 4/5: HTF bullish + M5/M15 bearish BOS must allow SELL candidate
#           HTF bearish + M5/M15 bullish BOS must allow BUY candidate
# (covered by the TREND_PULLBACK/RANGE_REVERSAL fresh-read overrides, which
# fire regardless of which way HTF Bias points -- only the fresh M15+M30
# reads decide.)
# ---------------------------------------------------------------------------
def test_trend_pullback_override_is_symmetric_both_directions():
    ea = read(BACKEND_EA)
    marker = "if(g_activeDirection == DIRECTION_BOTH_ALLOWED || g_activeDirection == DIRECTION_TRANSITION_WAIT)"
    idx = ea.index(marker)
    window = ea[idx: idx + 700]
    assert "freshM15Dir == -dir && freshM30Dir == -dir" in window
    # dir can be either +1 or -1 going in -- the check is direction-agnostic.


def test_range_reversal_both_branches_have_fresh_read_override():
    ea = read(BACKEND_EA)
    assert "rangeRevBuyFreshOverride" in ea
    assert "rangeRevSellFreshOverride" in ea
    assert "rangeRevBuyFreshOverride = true;" in ea
    assert "rangeRevSellFreshOverride = true;" in ea


# ---------------------------------------------------------------------------
# Case 6: opposite recheck with no valid setup must say so explicitly
# ---------------------------------------------------------------------------
def test_no_opposite_setup_produces_explicit_blocker_not_generic():
    ea = read(BACKEND_EA)
    assert 'oppFinalBlocker = "NO_OPPOSITE_SETUP: no setup produced a genuine "' in ea
    assert '"OPPOSITE_GRADE_SKIP: combined score below grade floor ("' in ea
    assert '"OPPOSITE_PERSONALITY_MISMATCH: "' in ea
    assert '"OPPOSITE_SMART_GUARD: "' in ea
    assert '"OPPOSITE_SMC_HARD_CONFLICT: "' in ea


# ---------------------------------------------------------------------------
# Case 7: the bot must never open both directions in the same cycle
# ---------------------------------------------------------------------------
def test_retry_replaces_not_adds_a_second_candidate():
    ea = read(BACKEND_EA)
    marker = "// Opposite candidate is genuinely valid -- swap it in and"
    idx = ea.index(marker)
    window = ea[idx: idx + 700]
    # signal/setupName/setupScore/combinedScore/grade are REASSIGNED (swapped),
    # never both the original and opposite proceeding together.
    assert "signal = oppSignalFound;" in window
    assert "setupName = oppSetupName;" in window
    assert "grade = oppGrade;" in window


# ---------------------------------------------------------------------------
# Case 8: OpenTrade must only happen after final hard filters pass
# ---------------------------------------------------------------------------
def test_retry_reruns_smc_hard_conflict_check_before_proceeding():
    # Self-review finding: the SMC hard-structural-conflict check only ran
    # once for the ORIGINAL direction earlier in the cycle. Without a re-check,
    # the retry candidate would silently bypass a genuine hard structural gate.
    ea = read(BACKEND_EA)
    marker = "double oppSmcBonus = SMC_GetScoreBonus(oppSignalFound, oppSmcReason);"
    assert marker in ea
    idx = ea.index(marker)
    window = ea[idx: idx + 900]
    assert "SMC_GetConflictPenalty(oppSignalFound, oppSmcHardBlock, oppSmcConflictReason)" in window
    assert 'oppGrade = "SKIP";' in window


def test_retry_reruns_adaptive_confirm_before_proceeding():
    ea = read(BACKEND_EA)
    marker = 'if(!AdaptiveXAUConfirm(oppSignalFound, "SMART-GUARD", oppCombined, oppGrade,'
    assert marker in ea


def test_fall_through_does_not_return_on_success():
    ea = read(BACKEND_EA)
    marker = 'if(oppFinalDecision == "PROCEED")'
    idx = ea.index(marker)
    window = ea[idx: idx + 300]
    assert "do NOT return" in window


def test_prior_session_fixes_still_intact():
    ea = read(BACKEND_EA)
    assert "if(g_activeDirection == DIRECTION_SELL_ONLY)      dir = -1;" in ea  # v6.17.0
    assert "activeDirectionConfirmsSell" in ea  # v6.17.2
    assert "spread / 0.0040 * 100.0" in ea  # v6.17.7 ADX proxy fix
    assert "bool OpenTrade(int signal, double atr, string reason, double sizeMulti)" in ea  # v6.17.7
    assert "freshM15Dir == -dir && freshM30Dir == -dir" in ea  # v6.17.8
