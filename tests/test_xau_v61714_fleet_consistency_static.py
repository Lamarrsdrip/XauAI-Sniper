from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.17.14.mq5"
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


def test_version_bumped_to_v61714():
    ea = read(BACKEND_EA)
    assert '#define XAUAI_EA_VERSION "v6.17.14"' in ea


def test_header_banner_matches_property_version_for_website_display():
    import re
    ea = read(BACKEND_EA)
    m = re.search(r'v(\d+\.\d+\.\d+)\s*[—\-]+\s*(.+)', ea[:3000])
    assert m is not None
    assert f"v{m.group(1)}" == "v6.17.14"


# ---------------------------------------------------------------------------
# User-directed threshold changes (explicit choices, confirmed via
# AskUserQuestion, not silent loosening): risk cap raised 3.0->5.0%,
# spread gate loosened 150->400pts, post-news spread-return-ratio loosened
# 1.5x->2.5x.
# ---------------------------------------------------------------------------
def test_risk_cap_raised_per_user_choice():
    ea = read(BACKEND_EA)
    assert "input double InpMaxRiskPctEquity = 5.0;" in ea


def test_spread_gate_loosened_not_removed():
    ea = read(BACKEND_EA)
    assert "input double InpMaxSpread      = 400.0;" in ea
    # Must still be a real, finite cap -- user chose "loosen," not "remove."
    assert "InpMaxSpread      = 0;" not in ea
    assert "input double InpPostNewsSpreadReturnX = 2.5;" in ea


# ---------------------------------------------------------------------------
# Divergence source #6/#7 (cooldown/re-entry counters, per the fleet-
# consistency requirement list): XAU_AntiRepeatLossActive was keyed entirely
# off THIS account's own loss history, proven root cause of 3 identical
# accounts diverging on the same valid signal. Exempted when Active
# Direction independently reaches STRONG tier in the same direction.
# ---------------------------------------------------------------------------
def test_anti_repeat_loss_exempted_on_independent_strong_confirmation():
    ea = read(BACKEND_EA)
    fn = body(ea, "bool XAU_AntiRepeatLossActive(int signal)")
    assert 'g_activeDirectionTier == "STRONG"' in fn
    assert "DIRECTION_BUY_ONLY" in fn and "DIRECTION_SELL_ONLY" in fn
    assert "return false;" in fn  # the exemption itself must not block


def test_anti_repeat_loss_guard_still_active_for_weak_confirmation():
    # Must not have been gutted entirely -- only the STRONG-tier-confirmed
    # case is exempted; the original recovery-distance logic must remain
    # for everything else.
    ea = read(BACKEND_EA)
    fn = body(ea, "bool XAU_AntiRepeatLossActive(int signal)")
    assert "recoveryATR" in fn
    assert "g_lastLossClosePx" in fn


# ---------------------------------------------------------------------------
# No account-balance/equity leak into signal generation (divergence source
# #10) -- confirmed by direct source inspection, not assumed.
# ---------------------------------------------------------------------------
def test_score_setups_has_no_account_state_dependency():
    ea = read(BACKEND_EA)
    fn = body(ea, "int ScoreSetups(double &score, string &setupName, int excludeDir = 0)")
    assert "AccountInfo" not in fn
    assert "accInfo." not in fn


def test_no_randomness_in_signal_path():
    ea = read(BACKEND_EA)
    assert "MathRand(" not in ea
    assert "GetTickCount(" not in ea


# ---------------------------------------------------------------------------
# PendingOpportunity fleet-consistency recovery: the core requirement --
# an A/A+ candidate blocked by a SOFT (non-account-specific-hard) reason is
# preserved and re-checked exactly once on the next closed M5 bar.
# ---------------------------------------------------------------------------
def test_pending_opportunity_struct_has_required_fields():
    ea = read(BACKEND_EA)
    struct_body = body(ea, "struct PendingOpportunity")
    for field in ["signalId", "candleTime", "dir", "setup", "grade", "score",
                  "combinedScore", "signalPrice", "atr", "originalBlocker", "expiry"]:
        assert field in struct_body, f"missing field {field}"


def test_hard_reason_classifier_covers_real_hard_blockers():
    ea = read(BACKEND_EA)
    fn = body(ea, "bool XAU_BlockerIsHardReason(string reason)")
    for hard in ["SPREAD_TOO_WIDE", "NEWS_AFTERMATH", "SMC_HARD_CONFLICT",
                 "MIXED_EXPOSURE", "MARGIN", "HEDGE", "STRUCTURAL"]:
        assert hard in fn, f"missing hard marker {hard}"


def test_only_a_or_aplus_soft_blocked_candidates_become_pending():
    ea = read(BACKEND_EA)
    marker = "void XAU_RememberBlockedSignal(int signal, string setupName, string grade,"
    idx = ea.index(marker)
    window = ea[idx: idx + 1600]
    assert '(grade == "A+" || grade == "A") && !XAU_BlockerIsHardReason(reason)' in window
    assert "g_pendingOpportunity.active        = true;" in window


def test_recovery_checked_exactly_once_per_new_bar_only():
    ea = read(BACKEND_EA)
    marker = "if(newM5Bar) XAU_CheckPendingOpportunityRecovery();"
    assert marker in ea


def test_recovery_clears_pending_flag_before_any_validity_check():
    # Single-attempt semantics: the flag must be cleared BEFORE any of the
    # reject/accept branches run, so a crash or early return can never leave
    # it stuck active for a second attempt.
    ea = read(BACKEND_EA)
    fn = body(ea, "void XAU_CheckPendingOpportunityRecovery()")
    clear_idx = fn.index("g_pendingOpportunity.active = false;")
    first_reject_idx = fn.index('Print("RECOVERY_REJECTED:')
    assert clear_idx < first_reject_idx


def test_recovery_rejects_expired_opportunity():
    ea = read(BACKEND_EA)
    fn = body(ea, "void XAU_CheckPendingOpportunityRecovery()")
    assert "if(TimeCurrent() > expiry)" in fn
    assert "reason=EXPIRED" in fn


def test_recovery_has_anti_chase_overextension_check():
    ea = read(BACKEND_EA)
    fn = body(ea, "void XAU_CheckPendingOpportunityRecovery()")
    assert "movedInFavor > atrOrig * 1.0" in fn
    assert "reason=OVEREXTENDED" in fn


def test_recovery_rechecks_thesis_with_fresh_m15_m30():
    ea = read(BACKEND_EA)
    fn = body(ea, "void XAU_CheckPendingOpportunityRecovery()")
    assert "TFDirectionByEMA(dir, PERIOD_M15, 0.05, freshWhyM15)" in fn
    assert "TFDirectionByEMA(dir, InpContextTF, 0.05, freshWhyM30)" in fn
    assert "reason=THESIS_INVALIDATED" in fn


def test_recovery_regrades_with_current_conditions_not_stale_original():
    ea = read(BACKEND_EA)
    fn = body(ea, "void XAU_CheckPendingOpportunityRecovery()")
    assert "double regimeQualityNow  = DetectRegime();" in fn
    assert "double sessionQualityNow = GetSessionQuality();" in fn
    assert "XAU_ComputeCombinedGradeForCandidate(dir, setup, score, regimeQualityNow, sessionQualityNow, oppGrade)" in fn


def test_recovery_still_runs_smart_guard_before_executing():
    ea = read(BACKEND_EA)
    fn = body(ea, "void XAU_CheckPendingOpportunityRecovery()")
    assert 'AdaptiveXAUConfirm(dir, "RECOVERY", oppCombined, oppGrade, oppLot, oppWhy, true)' in fn
    assert "reason=SMART_GUARD" in fn


def test_recovery_checks_hard_account_state_before_executing():
    ea = read(BACKEND_EA)
    fn = body(ea, "void XAU_CheckPendingOpportunityRecovery()")
    assert "CountMyPositions() >= InpMaxOpenTrades" in fn
    assert "spread > InpMaxSpread" in fn


def test_recovery_executes_via_opentrade_only_after_all_checks_pass():
    ea = read(BACKEND_EA)
    fn = body(ea, "void XAU_CheckPendingOpportunityRecovery()")
    open_idx = fn.index("bool opened = OpenTrade(dir, atrNow, recoveryReason, 1.0);")
    # every reject branch must appear before the OpenTrade call
    for marker in ["reason=EXPIRED", "reason=MAX_OPEN_TRADES", "reason=SPREAD_TOO_WIDE",
                   "reason=OVEREXTENDED", "reason=THESIS_INVALIDATED",
                   "reason=GRADE_NO_LONGER_QUALIFIES", "reason=SMART_GUARD"]:
        assert fn.index(marker) < open_idx


# ---------------------------------------------------------------------------
# DecisionFingerprint telemetry, keyed to the closed bar.
# ---------------------------------------------------------------------------
def test_decision_fingerprint_logged_per_completed_scan():
    ea = read(BACKEND_EA)
    assert "DECISION_FINGERPRINT |" in ea
    marker = "PrintFormat(\"DECISION_FINGERPRINT"
    idx = ea.index(marker)
    window = ea[idx: idx + 900]
    for field in ["XAUAI_BUILD_HASH", "Symbol()", "curBar", "setupName", "RegimeName()",
                  "g_htfConsensusDir", "g_activeDirection", "spread"]:
        assert field in window


def test_prior_session_fixes_still_intact():
    ea = read(BACKEND_EA)
    assert "bool XAU_AIIsAdvisoryOnly()" in ea
    assert "bool transientRetryOnly = (!staleHandle && err == 4807" in ea  # v6.17.13
    assert "int pgOppSignalFound = ScoreSetups(pgOppScore, pgOppSetupName, signal);" in ea  # v6.17.10
