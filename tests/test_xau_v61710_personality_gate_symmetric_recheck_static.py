from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.17.10.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def test_current_release_source_is_synced_to_backend():
    assert read(EA) == read(BACKEND_EA)


def test_version_bumped_to_v61710():
    ea = read(BACKEND_EA)
    assert '#define XAUAI_EA_VERSION "v6.17.10"' in ea


def test_header_banner_matches_property_version_for_website_display():
    import re
    ea = read(BACKEND_EA)
    m = re.search(r'v(\d+\.\d+\.\d+)\s*[—\-]+\s*(.+)', ea[:3000])
    assert m is not None
    assert f"v{m.group(1)}" == "v6.17.10"


# ---------------------------------------------------------------------------
# Root cause: xau_opposite_direction_counterfactual_audit_2026-07-06_to_2026-07-08.md
# reconstructed 107 blocked signals and tested what the OPPOSITE direction
# would have done from the same decision timestamp. "Personality mismatch"
# blocks were both the LARGEST sample (17 of 87 CLEAN_1R_LOSS signals) and
# the BEST-performing for a genuine opposite-direction win (47%, tradeable-
# only denominator) -- larger and better than SMART-GUARD (7 signals, 43%),
# which v6.17.9 already covered. This gate had zero symmetric recheck before
# this release. The audit also confirmed "A+ EVIDENCE DEMOTION" is the WORST
# performing category (1/5 wins) -- but that reason is generated in
# XAUEntryTimingGuard(), which runs strictly AFTER SmartGuard in the
# pipeline, so neither this fix nor v6.17.9's touches it at all -- verified,
# not assumed.
# ---------------------------------------------------------------------------
def test_personality_gate_hard_block_triggers_symmetric_recheck():
    ea = read(BACKEND_EA)
    marker = "// B-grade or lower in wrong personality: block"
    idx = ea.index(marker)
    window = ea[max(0, idx - 3200): idx]
    assert "int pgOppSignalWanted = -signal;" in window
    assert "int pgOppSignalFound = ScoreSetups(pgOppScore, pgOppSetupName, signal);" in window
    assert "StrategyFitsPersonality(pgOppSetupName, g_marketPersonality)" in window


def test_recheck_swaps_before_grade_computation_not_after():
    # Unlike the SmartGuard site (v6.17.9), this swap happens BEFORE "Combined
    # quality" grade computation runs -- so the opposite candidate naturally
    # flows through grade/SMC-conflict/SmartGuard via the EXISTING code that
    # follows. No duplicated grade/SMC logic should exist at this site.
    ea = read(BACKEND_EA)
    pg_marker = "int pgOppSignalWanted = -signal;"
    grade_marker = "// Combined quality"
    assert ea.index(pg_marker) < ea.index(grade_marker)
    # No SMC re-check duplicated here (that would only make sense post-swap
    # if this ran after SMC, which it doesn't need to).
    window = ea[ea.index(pg_marker): ea.index(grade_marker)]
    assert "SMC_GetConflictPenalty" not in window


def test_recheck_respects_active_direction_forbidding_opposite():
    ea = read(BACKEND_EA)
    marker = "bool pgOppDirForbidden ="
    idx = ea.index(marker)
    window = ea[idx: idx + 400]
    assert "g_activeDirection == DIRECTION_BUY_ONLY  && pgOppSignalWanted == -1" in window
    assert "g_activeDirection == DIRECTION_SELL_ONLY && pgOppSignalWanted ==  1" in window
    assert "g_activeDirection == DIRECTION_TRANSITION_WAIT &&" in window


def test_opposite_candidate_still_checked_against_personality_or_aplus():
    # No blind pass-through -- the swapped candidate must fit personality OR
    # qualify via the same A/A+ "penalty but proceed" threshold the original
    # candidate would have needed. Also gets the same -1.5 penalty for
    # consistency when it doesn't fit but qualifies via grade.
    ea = read(BACKEND_EA)
    marker = "if(pgOppFits || pgOppScore >= InpGradeAPlus || pgOppScore >= InpGradeA)"
    assert marker in ea
    idx = ea.index(marker)
    window = ea[idx: idx + 450]
    assert "pgOppScore = MathMax(0.0, pgOppScore - 1.5);" in window


def test_no_swap_still_falls_through_to_original_hard_block():
    ea = read(BACKEND_EA)
    marker = "if(!pgSwapped)"
    idx = ea.index(marker)
    window = ea[idx: idx + 900]
    assert 'Print("PERSONALITY GATE BLOCK: ", setupName, " grade not A/A+ in ",' in window
    assert "XAU_RememberBlockedSignal(signal, setupName, \"PERSONALITY\"" in window
    assert "return;" in window


def test_a_plus_evidence_demotion_gate_is_untouched_by_any_symmetric_recheck():
    # Audit evidence: A+ EVIDENCE DEMOTION is the WORST-performing category
    # for an opposite-direction win (1 of 5). Confirmed this gate lives in
    # XAUEntryTimingGuard(), called strictly after SmartGuard -- neither the
    # v6.17.9 SmartGuard recheck nor this Personality Gate recheck can reach
    # it, since a candidate must already have passed SmartGuard to get there.
    ea = read(BACKEND_EA)
    fn_call_idx = ea.index("if(!XAUEntryTimingGuard(signal, setupName, setupScore, combinedScore,")
    smartguard_idx = ea.index('string sgMsg = StringFormat("SMART-GUARD: %s blocked by adaptive fast confirmation for %s. %s",')
    assert smartguard_idx < fn_call_idx
    fn_def_idx = ea.index("bool XAUEntryTimingGuard(int signal, string setupName, double setupScore, double combinedScore,")
    fn_body_start = ea.index("{", fn_def_idx)
    fn_snippet = ea[fn_body_start: fn_body_start + 6000]
    assert "ScoreSetups(" not in fn_snippet
    assert "pgOppSignalWanted" not in fn_snippet


def test_prior_fixes_still_intact():
    ea = read(BACKEND_EA)
    assert "if(g_activeDirection == DIRECTION_SELL_ONLY)      dir = -1;" in ea  # v6.17.0
    assert "spread / 0.0040 * 100.0" in ea  # v6.17.7
    assert "freshM15Dir == -dir && freshM30Dir == -dir" in ea  # v6.17.8
    assert "int oppSignalFound = ScoreSetups(oppScore, oppSetupName, signal);" in ea  # v6.17.9 SmartGuard recheck
    assert "SMC_GetConflictPenalty(oppSignalFound, oppSmcHardBlock, oppSmcConflictReason)" in ea  # v6.17.9
