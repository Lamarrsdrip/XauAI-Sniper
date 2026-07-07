from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.16.1.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def body(src: str, name: str) -> str:
    start = src.index(name)
    brace = src.index("{", start)
    depth = 0
    for i in range(brace, len(src)):
        if src[i] == "{":
            depth += 1
        elif src[i] == "}":
            depth -= 1
            if depth == 0:
                return src[start : i + 1]
    raise AssertionError(f"Could not find body for {name}")


def test_current_release_source_is_synced_to_backend():
    assert read(EA) == read(BACKEND_EA)


# ---------------------------------------------------------------------------
# InpAIMode: default must be AI_FILTER_ONLY, not AI_DIRECTOR (scenario: the
# whole point of the reconstruction is that AI Director authority is opt-in).
# ---------------------------------------------------------------------------
def test_ai_mode_defaults_away_from_director():
    ea = read(BACKEND_EA)
    assert "enum ENUM_XAU_AI_MODE { AI_OFF=0, AI_ADVISOR_ONLY=1, AI_FILTER_ONLY=2, AI_DIRECTOR=3 }" in ea
    assert "input ENUM_XAU_AI_MODE InpAIMode = AI_FILTER_ONLY;" in ea
    assert "input bool   InpJune18RestoreMode = false;" in ea


def test_structural_bypass_closed_by_default_only_ai_director_preserves_it():
    # v6.16.1 refinement: the 11 grade-based soft-bypass sites split into
    # Category A (structural/market-fact -- SmartGuard, STI/TRI re-entry,
    # news-aftermath, SMC conflict, AI_LOW_CONF_SKIP) which must stay closed
    # by default, and Category B (AI's own opinion-escalation gates, plus the
    # unrelated Strong Momentum feature-gate) which keep the original
    # trade-mode-only logic since they're already inert under
    # ADVISOR_ONLY/RestoreMode anyway.
    ea = read(BACKEND_EA)
    structural_fn = body(ea, "bool XAU_StructuralBypassAllowed()")
    assert "InpJune18RestoreMode" in structural_fn
    assert "InpAIMode != AI_DIRECTOR" in structural_fn
    assert "return false;" in structural_fn

    opinion_fn = body(ea, "bool XAU_ModeAllowsSoftBlockWarning()")
    assert "InpAIMode" not in opinion_fn  # reverted to original trade-mode-only logic
    assert "InpTradeMode == BALANCED_MODE" in opinion_fn


def test_structural_gate_covers_all_six_named_sites():
    ea = read(BACKEND_EA)
    assert '!antiRepeatBlocks && XAU_StructuralBypassAllowed() && XAU_StrongContextForSoftBypass' in ea  # SMART_GUARD_FAST_CONFIRM
    assert '!antiRepeatBlocksSTI && XAU_StructuralBypassAllowed() && XAU_StrongContextForSoftBypass' in ea  # STI_REENTRY_WAIT
    assert '!antiRepeatBlocksAI && XAU_StructuralBypassAllowed() && XAU_StrongContextForSoftBypass' in ea  # AI_LOW_CONF_SKIP
    assert 'else if(XAU_StructuralBypassAllowed() &&\n              StringFind(spreadBlockReason' in ea  # NEWS_AFTERMATH
    assert 'if(XAU_StructuralBypassAllowed())\n      {\n         Print("SMC HARD CONFLICT' in ea  # SMC hard conflict
    assert 'if(XAU_StructuralBypassAllowed())\n         {\n            Print("TRI RE-ENTRY WATCH' in ea  # TRI re-entry watch


def test_ai_opinion_gate_still_covers_its_five_sites():
    ea = read(BACKEND_EA)
    marker = "bool XAU_StructuralBypassAllowed()"
    before_structural_def = ea[: ea.index(marker)]
    # HTF-override, weak-disagree, no-conf-skip, confident-B-skip, Strong
    # Momentum Precheck -- all five must still use the original function
    # (plus its own definition line = 6 occurrences before this point).
    assert before_structural_def.count("XAU_ModeAllowsSoftBlockWarning()") == 6


def test_no_limit_trading_mode_still_defaults_true_unless_restore_mode():
    # Do NOT flip InpNoLimitTradingMode/InpDisableAllDailyLocks/InpNoDailyLimitMode
    # defaults directly -- that would silently re-activate ~30 unrelated code
    # paths. Restore Mode is the only thing allowed to turn locks back on.
    ea = read(BACKEND_EA)
    assert "input bool   InpNoLimitTradingMode = true;" in ea
    assert "input bool   InpDisableAllDailyLocks = true;" in ea
    assert "input bool   InpNoDailyLimitMode = true;" in ea
    fn = body(ea, "bool XAU_NoLimitTradingModeActive()")
    assert "if(InpJune18RestoreMode) return false;" in fn


# ---------------------------------------------------------------------------
# Adaptive Direction Engine v2 — 3-tier, pullback vs breakdown, M15, CHoCH,
# failed-breakout, no fear-based session bans.
# ---------------------------------------------------------------------------
def test_direction_engine_has_five_states_and_three_tiers():
    ea = read(BACKEND_EA)
    assert "DIRECTION_NO_TRADE=0, DIRECTION_BUY_ONLY=1, DIRECTION_SELL_ONLY=2," in ea
    assert "DIRECTION_BOTH_ALLOWED=3, DIRECTION_TRANSITION_WAIT=4" in ea
    fn = body(ea, "ENUM_XAU_ACTIVE_DIRECTION XAU_ComputeActiveDirection(int htfBias, string &reason)")
    assert 'g_activeDirectionTier = "STRONG"' in fn
    assert 'g_activeDirectionTier = "MEDIUM"' in fn
    assert 'g_activeDirectionTier = "WEAK"' in fn
    assert "g_activeDirectionSizeMult = 0.60" in fn  # MEDIUM tier trades reduced risk, not full/blocked


def test_pullback_vs_breakdown_distinction_uses_swing_sequence():
    ea = read(BACKEND_EA)
    fn = body(ea, "ENUM_XAU_ACTIVE_DIRECTION XAU_ComputeActiveDirection(int htfBias, string &reason)")
    assert "sequenceStillAgrees" in fn
    assert "normal pullback" in fn
    assert "return DIRECTION_BOTH_ALLOWED;" in fn


def test_direction_engine_uses_m5_and_m15_and_choch_and_failed_breakout():
    ea = read(BACKEND_EA)
    fn = body(ea, "ENUM_XAU_ACTIVE_DIRECTION XAU_ComputeActiveDirection(int htfBias, string &reason)")
    assert "PERIOD_M15" in fn
    assert "m5m15AlignBear" in fn and "m5m15AlignBull" in fn
    assert "chochBear" in fn and "chochBull" in fn
    assert "XAU_AssessFailedBreakout(" in fn
    # CHoCH must be the real fractal swing-pivot level, not just a relabeled
    # rolling-window scan.
    assert "m5LastSwingLow" in fn and "m5LastSwingHigh" in fn


def test_swing_sequence_scan_is_closed_bar_and_reused_for_both_timeframes():
    ea = read(BACKEND_EA)
    fn = body(ea, "int XAU_SwingSequenceDir(ENUM_TIMEFRAMES tf, int lookbackBars, string &why,")
    assert "for(int i = 2; i <= lb - 2" in fn  # never touches shift 0/1 (forming/most-recent-incomplete bar)
    assert "iHigh(Symbol(), tf, i)" in fn  # parameterized timeframe, not hardcoded PERIOD_M5 twice


def test_anti_repeat_loss_is_graduated_not_a_session_ban():
    ea = read(BACKEND_EA)
    fn = body(ea, "bool XAU_AntiRepeatLossActive(int signal)")
    # Engages from the very first loss (graduated evidence), not just at the
    # configured streak threshold -- but always self-clears on price
    # evidence, never a fixed-time or session-length lockout.
    assert "if(g_sameDirLossStreak < 1) return false;" in fn
    assert "recoveryATR = (g_sameDirLossStreak >= InpAntiRepeatLossStreak) ? 0.5 : 0.25" in fn
    assert "TimeCurrent()" not in fn  # no time-based cooldown math anywhere in this function


def test_htf_trend_follow_requires_active_direction_agreement():
    ea = read(BACKEND_EA)
    assert "directionAllowsHtfTf" in ea
    assert 'HTF_TREND_FOLLOW: withheld — Active Direction=' in ea


def test_re_entry_and_rescue_family_gated_on_active_direction():
    ea = read(BACKEND_EA)
    assert "RE-ENTRY BLOCKED: Active Direction=" in ea
    assert "directionAllowsRescue" in ea


def test_central_direction_gate_covers_all_scoresetups_families_with_documented_exceptions():
    ea = read(BACKEND_EA)
    marker = "int signal = ScoreSetups(setupScore, setupName);"
    idx = ea.index(marker)
    window = ea[idx: idx + 3500]
    assert "ADAPTIVE-DIRECTION BLOCK" in window
    assert "Documented exceptions (NOT gated here, by design):" in window
    assert "PYR+TRN" in window and "RE_ENTRY" in window


def test_exit_arbiter_reuses_direction_engine_instead_of_a_sixth_system():
    ea = read(BACKEND_EA)
    fn = body(ea, "bool XAU_ReversalConfirmed(ulong ticket, bool isBuy, bool structureConfirmedBroken,")
    assert 'g_activeDirectionTier == "STRONG"' in fn


def test_thesis_hold_floor_rearms_at_breakeven_instead_of_zero_action():
    ea = read(BACKEND_EA)
    assert "THESIS_HOLD_BE_REARM" in ea


# ---------------------------------------------------------------------------
# Risk reconciliation: narrow backstop, not a general lot-shrink philosophy.
# ---------------------------------------------------------------------------
def test_risk_reconcile_exists_and_is_wired_into_entry_and_pyramid():
    ea = read(BACKEND_EA)
    fn = body(ea, "bool XAU_ReconcileFinalRisk(double &lots, double actualSLDistance, double lotStep,")
    assert "RISK-RECONCILE" in fn
    assert "REQUESTED_RISK_PCT" in fn and "APPROVED_MAX_RISK_PCT" in fn
    assert "ACTUAL_RISK_BEFORE" in fn  # explicit before/after, not just a final number
    assert "BLOCKED_MINLOT_EXCEEDS_CAP" in fn
    assert ea.count("XAU_ReconcileFinalRisk(lots" ) >= 1
    assert ea.count("XAU_ReconcileFinalRisk(addLot") >= 1


def test_risk_reconcile_uses_true_equity_cap_not_display_only_input():
    ea = read(BACKEND_EA)
    fn = body(ea, "bool XAU_ReconcileFinalRisk(double &lots, double actualSLDistance, double lotStep,")
    # The comparison must be against approvedCapPct (populated by callers from
    # EffectiveSingleRiskCapPct(), i.e. InpMaxRiskPctEquity) -- the function
    # itself never reads InpRiskPercent (the decorative, unused display input)
    # anywhere in its executable logic, only in an explanatory comment.
    assert "if(approvedCapPct > 0.0 && actualDollarRiskBefore > approvedDollarCap * 1.02)" in fn
    assert "GetAIAnalysis" not in fn and "InpRiskPercent ==" not in fn and "InpRiskPercent *" not in fn
    assert "EffectiveSingleRiskCapPct()" in ea
    assert "approvedCapPct" in fn


def test_risk_reconcile_only_reduces_never_boosts():
    ea = read(BACKEND_EA)
    fn = body(ea, "bool XAU_ReconcileFinalRisk(double &lots, double actualSLDistance, double lotStep,")
    assert "MathFloor(maxAllowedLots / lotStep)" in fn  # rounds DOWN, never up
    assert "lots = steppedLots;" in fn


def test_june_balance_mode_previously_bypassed_all_risk_caps():
    # Documents the confirmed root cause so a future refactor can't silently
    # reopen the gap: both bypass comments must still be present verbatim.
    ea = read(BACKEND_EA)
    assert "PYRAMID LOT_MODE=JUNE_16_19_BALANCE_MODE | risk caps bypassed" in ea
    assert ea.count("risk caps bypassed") >= 1


def test_performance_multiplier_is_bounded_not_the_old_nine_mechanism_stack():
    ea = read(BACKEND_EA)
    fn = body(ea, "double GetPerformanceMultiplier()")
    assert "if(!InpJune18RestoreMode) return 1.0;" in fn
    assert "g_sameDirLossStreak >= 4" in fn
    assert "g_tradeMemory" not in fn  # old dead 9-mechanism stack must not have crept back in
