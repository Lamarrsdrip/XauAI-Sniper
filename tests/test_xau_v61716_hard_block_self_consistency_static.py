from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.17.16.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def test_current_release_source_is_synced_to_backend():
    assert read(EA) == read(BACKEND_EA)


def test_version_bumped_to_v61716():
    ea = read(BACKEND_EA)
    assert '#define XAUAI_EA_VERSION "v6.17.16"' in ea


def test_header_banner_matches_property_version_for_website_display():
    import re
    ea = read(BACKEND_EA)
    m = re.search(r'v(\d+\.\d+\.\d+)\s*[—\-]+\s*(.+)', ea[:3000])
    assert m is not None
    assert f"v{m.group(1)}" == "v6.17.16"


# ---------------------------------------------------------------------------
# Root cause, proven by a real executed-vs-blocked expectancy audit
# (audits/xau_expectancy_inversion_audit_2026-07-06_to_2026-07-08.md):
# XAUEntryTimingGuard() computed blockClass="HARD_BLOCK" from
# lateChaseEntry||spikeCooldown||failedImpulseBlock||postSweepTrap||
# timingBadRRForReport, but only wired an actual `return false;` to the
# lateChaseEntry sub-case (via a separate, narrower check). The other four
# conditions got the diagnostic label in the entry's own log text and were
# then allowed through anyway. 100% of one audited window's trading losses
# traced to this exact self-contradiction (3 of 19 trades, 0 clean wins).
# ---------------------------------------------------------------------------
def test_hard_block_label_now_causes_an_actual_return_false():
    ea = read(BACKEND_EA)
    marker = 'if(blockClass == "HARD_BLOCK")'
    assert marker in ea
    idx = ea.index(marker)
    window = ea[idx: idx + 300]
    assert "return false;" in window
    assert "HARD_BLOCK_SELF_CONSISTENCY" in window


def test_hard_block_check_is_unconditional_no_override_bypass():
    # The audit's explicit finding: STRONG_MOMENTUM_OVERRIDE, TREND-
    # CONTINUATION MODE, and RECOVERY-of-missed-signal re-entries were the
    # three override paths that admitted HARD_BLOCK-labeled candidates.
    # The fix must be unconditional -- no InpXAU_StructuralBypassAllowed()
    # or trade-mode check gating it, matching "no override path should be
    # able to admit it."
    ea = read(BACKEND_EA)
    marker = 'if(blockClass == "HARD_BLOCK")'
    idx = ea.index(marker)
    # the very next non-comment line inside the block must be the Print+return,
    # not a nested condition that could skip it
    window = ea[idx: idx + 400]
    assert "XAU_StructuralBypassAllowed" not in window
    assert "XAU_ModeAllowsSoftBlockWarning" not in window


def test_hard_block_check_placed_before_the_narrower_pre_existing_check():
    # The new unified check must run BEFORE the old lateChaseEntry-only
    # check, so it can catch spikeCooldown/failedImpulseBlock/postSweepTrap/
    # timingBadRRForReport cases the narrower check never covered.
    ea = read(BACKEND_EA)
    new_check_idx = ea.index('if(blockClass == "HARD_BLOCK")')
    old_check_idx = ea.index("if(lateChaseEntry && InpXAU_BlockLateA && !trendContinuationQualified)")
    assert new_check_idx < old_check_idx


def test_blockclass_computation_unchanged():
    # This fix must not touch the classification logic itself, only add
    # enforcement -- the four conditions that produce the label are
    # untouched.
    ea = read(BACKEND_EA)
    assert 'blockClass = "HARD_BLOCK";' in ea
    marker = 'else if(lateChaseEntry || spikeCooldown || failedImpulseBlock || postSweepTrap || timingBadRRForReport)'
    assert marker in ea


# ---------------------------------------------------------------------------
# Companion fix: the v6.17.14 PendingOpportunity recovery classifier
# (XAU_BlockerIsHardReason) must also recognize this same internal label,
# so a HARD_BLOCK-flagged signal can never be re-admitted via the missed-
# signal recovery path either -- this was the exact mechanism behind one
# of the audit's losing trades (#19, a RECOVERY re-entry of a
# FAILED-IMPULSE BLOCKed, blockClass=HARD_BLOCK signal).
# ---------------------------------------------------------------------------
def test_pending_opportunity_classifier_recognizes_hard_block_label():
    ea = read(BACKEND_EA)
    marker = "string hardMarkers[] = {"
    idx = ea.index(marker)
    end = ea.index("};", idx)
    window = ea[idx:end]
    assert "BLOCKCLASS=HARD_BLOCK" in window
    assert "HARD_BLOCK_SELF_CONSISTENCY" in window


def test_prior_session_fixes_still_intact():
    ea = read(BACKEND_EA)
    assert "bool XAU_TryForceOpenTrade(int dir, string setup, string grade, string originalBlocker," in ea  # v6.17.15
    assert "void XAU_CheckPendingOpportunityRecovery()" in ea  # v6.17.14
    assert "bool XAU_AntiRepeatLossActive(int signal)" in ea
