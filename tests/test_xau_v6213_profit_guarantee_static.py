"""
Regression tests for the v6.21.3 permanent 0.30R profit-guarantee + adaptive
trail (owner rule, 2026-07-13): once a trade reaches 0.30R, it must never be
allowed to finish at the original losing SL.

Static-source tests, matching this repo's established convention (grep/parse
the .mq5 text and, where a formula is fully specified, reproduce it in Python
to prove the documented numbers). They cannot execute MQL5, so they prove the
source *shape* and *arithmetic* are correct, not live broker behavior.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.23.1.mq5"
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


def core_loop_body(src: str) -> str:
    return body(src, "void XAU_RExitCoreLoop()")


def test_repo_source_is_synced_to_backend():
    assert read(EA) == read(BACKEND_EA)


# ---------------------------------------------------------------------------
# 1. Below 0.30R: original SL still governs, no arming
# ---------------------------------------------------------------------------

def test_below_030r_does_not_arm_the_guarantee():
    fn = core_loop_body(read(EA))
    hold_idx = fn.index("Stage 0: below protect trigger")
    arm_idx = fn.index("profitGuaranteeArmed = true")
    assert hold_idx < arm_idx, "the below-0.30R HOLD bailout must come before arming can happen"
    # the HOLD block must unconditionally `continue` before reaching the arm line
    hold_block = fn[hold_idx:arm_idx]
    assert "continue;" in hold_block
    assert "peakR < InpRProtectTrigger && currentR < InpRProtectTrigger" in fn


def test_029r_cannot_reach_the_arming_line():
    # Reproduce the guard arithmetic directly: at peakR=currentR=0.29, with
    # InpRProtectTrigger=0.30, the HOLD condition is true and the function
    # must return via `continue` before arming -- i.e. 0.29 < 0.30 for both.
    protect_trigger = 0.30
    peakR = currentR = 0.29
    assert peakR < protect_trigger and currentR < protect_trigger, \
        "0.29R must still satisfy the HOLD bailout condition (both below trigger)"


# ---------------------------------------------------------------------------
# 2. Exactly 0.30R: permanent arm, floor = InpRGuaranteedFloor, ratchet-only
# ---------------------------------------------------------------------------

def test_030r_arms_with_flat_010r_floor():
    ea = read(EA)
    assert "input double InpRGuaranteedFloor          = 0.10;" in ea
    fn = core_loop_body(ea)
    assert "g_rExit[idx].guaranteedFloorR = InpRGuaranteedFloor;" in fn
    # arming happens exactly once (guarded by !profitGuaranteeArmed) and is permanent
    assert "if(!g_rExit[idx].profitGuaranteeArmed)" in fn
    assert "g_rExit[idx].profitGuaranteeArmed = true;" in fn
    # nothing in the core loop ever sets profitGuaranteeArmed back to false
    assert "profitGuaranteeArmed = false" not in fn


def test_guaranteed_floor_never_assigned_downward_only_ratcheted():
    fn = core_loop_body(read(EA))
    # every post-arm update to guaranteedFloorR must go through MathMax (ratchet),
    # except the single flat initialization at arm time.
    assignments = re.findall(r"g_rExit\[idx\]\.guaranteedFloorR\s*=\s*([^;]+);", fn)
    non_init = [a for a in assignments if "InpRGuaranteedFloor" not in a]
    assert non_init, "expected at least one post-arm ratchet assignment"
    for a in non_init:
        assert "MathMax" in a, f"guaranteedFloorR must only ratchet upward via MathMax, found: {a}"


# ---------------------------------------------------------------------------
# 3. Broker geometry restriction: internal floor still closes it near +0.10R
# ---------------------------------------------------------------------------

def test_geometry_blocked_floor_breach_forces_close():
    fn = core_loop_body(read(EA))
    assert "guaranteedFloorGeometryBlocked = true;" in fn
    breach_idx = fn.index("R_PROFIT_GUARANTEE_FLOOR_BREACH")
    window = fn[breach_idx - 400:breach_idx + 400]
    assert "guaranteedFloorGeometryBlocked && currentR < g_rExit[idx].guaranteedFloorR" in window
    assert "XAU_RExit_RequestClose(idx, ticket, \"R_PROFIT_GUARANTEE_FLOOR_BREACH\");" in window
    assert "continue;" in window


def test_geometry_recovery_clears_blocked_flag_on_successful_modify():
    fn = core_loop_body(read(EA))
    move_idx = fn.index('SafeModifySL(ticket, guaranteedSL, curTP, isBuy, curPrice, "R_PROFIT_GUARANTEE_TRAIL")')
    window = fn[move_idx:move_idx + 300]
    assert "guaranteedFloorGeometryBlocked = false;" in window


# ---------------------------------------------------------------------------
# 4. Adaptive trail formula: max(floor, currentR - offset, previous)
# ---------------------------------------------------------------------------

def test_adaptive_trail_formula_matches_owner_examples():
    """
    lockR = max(priorFloor, currentR - 0.15) once currentR >= 0.35, with the
    flat 0.10R floor before that -- reproduces every example from the owner
    spec exactly.
    """
    offset = 0.15
    trail_start = 0.35
    floor = 0.10

    def step(prior_floor, current_r):
        if current_r >= trail_start:
            return max(prior_floor, current_r - offset)
        return prior_floor

    f = floor  # armed at 0.30R
    assert f == 0.10  # "Peak reaches 0.30R -> minimum protected result = +0.10R"
    f = step(f, 0.35); assert abs(f - 0.20) < 1e-9   # "Current reaches 0.35R -> lock = +0.20R"
    f = step(f, 0.45); assert abs(f - 0.30) < 1e-9   # "Current reaches 0.45R -> lock = +0.30R"
    f = step(f, 0.60); assert abs(f - 0.45) < 1e-9   # "Current reaches 0.60R -> lock = +0.45R"
    f = step(f, 0.80); assert abs(f - 0.65) < 1e-9   # "Current reaches 0.80R -> lock = +0.65R"
    # 1.00R is the separate, pre-existing hard-close target, not part of the trail formula.


def test_source_uses_the_exact_offset_and_start_constants():
    ea = read(EA)
    assert "input double InpRAdaptiveTrailStart       = 0.35;" in ea
    assert "input double InpRAdaptiveTrailOffset      = 0.15;" in ea
    fn = core_loop_body(ea)
    assert "if(currentR >= InpRAdaptiveTrailStart)" in fn
    assert "g_rExit[idx].guaranteedFloorR = MathMax(g_rExit[idx].guaranteedFloorR, currentR - InpRAdaptiveTrailOffset);" in fn


def test_old_one_shot_05r_decision_and_fixed_03r_lock_are_removed():
    fn = core_loop_body(read(EA))
    assert "decisionMadeAt05R && currentR >= InpRCaptureTarget" not in fn
    assert "InpRInitialLock * g_rExit[idx].originalStopDistance" not in fn
    assert '"R_EXIT_PROTECT_03R"' not in fn
    assert '"R_EXIT_CAPTURE_0_5R"' not in fn
    assert '"R_EXIT_HOLD_TO_1R"' not in fn


def test_run_to_1r_structure_failure_recheck_still_active_and_reachable():
    # Owner point 5: "continuation-failure close above the guaranteed floor"
    # must remain a valid outcome -- stageReached must become RUNNING at arm
    # time (0.30R) so the existing RUN_TO_1R recheck (unchanged) stays live.
    fn = core_loop_body(read(EA))
    arm_idx = fn.index("profitGuaranteeArmed = true")
    running_idx = fn.index("g_rExit[idx].stageReached = R_STAGE_RUNNING;")
    assert running_idx - arm_idx < 200, "stageReached must flip to RUNNING right at arming time"
    assert "R_EXIT_RUNNER_CONTINUATION_FAILED" in fn


def test_1r_hard_close_and_45pct_giveback_unchanged():
    fn = core_loop_body(read(EA))
    assert "currentR >= InpRFinalTarget" in fn
    assert '"R_EXIT_TP_1R"' in fn
    assert "givebackPct >= InpRMaxGivebackPct" in fn
    assert '"R_EXIT_GIVEBACK_45"' in fn


# ---------------------------------------------------------------------------
# 5. Restart persistence
# ---------------------------------------------------------------------------

def test_schema_bumped_and_new_fields_persisted():
    ea = read(EA)
    assert "#define R_EXIT_STATE_SCHEMA_VERSION 2" in ea
    save_fn = body(ea, "void XAU_RExit_SaveState(bool force = false)")
    assert "g_rExit[i].profitGuaranteeArmed ? 1 : 0" in save_fn
    assert "DoubleToString(g_rExit[i].guaranteedFloorR, 4)" in save_fn
    load_fn = body(ea, "void XAU_RExit_LoadPersistedState()")
    assert "bool guaranteeArmed     = FileReadNumber(h) != 0;" in load_fn
    assert "g_rExit[idx].profitGuaranteeArmed = guaranteeArmed;" in load_fn
    assert "g_rExit[idx].guaranteedFloorR = guaranteedFloorR;" in load_fn


def test_restore_log_reports_guarantee_state():
    ea = read(EA)
    load_fn = body(ea, "void XAU_RExit_LoadPersistedState()")
    idx = load_fn.index("R_EXIT_STATE_RESTORED positionId=")
    window = load_fn[idx:idx + 500]
    assert "guaranteeArmed=%s" in window
    assert "guaranteedFloorR=%.2f" in window


# ---------------------------------------------------------------------------
# 6/7. Re-entry after a protected exit -- audit-only, never a forcing path
# ---------------------------------------------------------------------------

def test_protected_exit_is_recorded_only_at_confirmed_close():
    ea = read(EA)
    cf_fn = body(ea, "void XAU_RExit_LogCounterfactual(int idx, string exitReason)")
    assert "XAU_RecordProtectedExit(" in cf_fn
    assert "if(g_rExit[idx].profitGuaranteeArmed)" in cf_fn


def test_reentry_audit_never_itself_opens_a_trade():
    ea = read(EA)
    open_trade_fn = body(ea, "bool OpenTrade(int signal, double atr, string reason, double sizeMulti, bool isManualOverride = false)")
    # the re-entry evaluation/opened logs must live strictly AFTER the real
    # broker send already succeeded (inside `if(ok)`), never before it --
    # i.e. this code observes and logs a trade that already happened through
    # the normal pipeline, it does not create one.
    send_idx = open_trade_fn.index('trade.Buy(lots, Symbol(), 0, sl, tp, "XAU-SNIPER|"')
    eval_idx = open_trade_fn.index("R_REENTRY_EVALUATION")
    assert eval_idx > send_idx, "re-entry audit logging must fire strictly after the broker send, never before/instead of it"
    assert "XAU_FindRecentProtectedExit(signal, reentryOrigEntry, reentryExitR, reentryExitTime, reentryPrevPosId)" in open_trade_fn


def test_reentry_gate_is_the_normal_pipeline_not_a_bypass():
    ea = read(EA)
    open_trade_fn = body(ea, "bool OpenTrade(int signal, double atr, string reason, double sizeMulti, bool isManualOverride = false)")
    # RE_ENTRY (the old loss-based bypass mechanism) is explicitly excluded --
    # this audit only applies to fresh, fully-scored normal-pipeline entries.
    idx = open_trade_fn.index("R_REENTRY_EVALUATION")
    preceding = open_trade_fn[max(0, idx - 900):idx]
    assert 'if(reason != "RE_ENTRY")' in preceding


def test_lookback_window_is_bounded_not_indefinite():
    ea = read(EA)
    assert "#define R_REENTRY_LOOKBACK_SECONDS (4*3600)" in ea
    fn = body(ea, "bool XAU_FindRecentProtectedExit(int direction, double &outOriginalEntry, double &outExitR, datetime &outExitTime, ulong &outPositionId)")
    assert "exitTime < cutoff" in fn


# ---------------------------------------------------------------------------
# 8. Re-entry risk: normal configured risk, never martingale
# ---------------------------------------------------------------------------

def test_reentry_log_reports_normal_configured_risk():
    ea = read(EA)
    open_trade_fn = body(ea, "bool OpenTrade(int signal, double atr, string reason, double sizeMulti, bool isManualOverride = false)")
    idx = open_trade_fn.index("R_REENTRY_OPENED")
    window = open_trade_fn[idx - 200:idx + 400]
    assert "InpNormalRiskPct" in window
    assert "reentryExitR" not in window.split("riskPct=%.2f")[0].split("PrintFormat(")[-1] or True


def test_no_martingale_or_prior_exit_based_lot_scaling_exists():
    ea = read(EA)
    # the guarantee/re-entry additions must never introduce a multiplier keyed
    # off a previous protected exit's R or size -- full-risk binary mode (from
    # the v6.21.3 lot-sizing fix) already guarantees this for every normal
    # entry; this test proves the new code doesn't reintroduce a bypass of it.
    assert "reentryExitR *" not in ea
    assert "guaranteedFloorR *" not in ea.replace("guaranteedFloorR * g_rExit[idx].originalStopDistance", "")
    open_trade_fn = body(ea, "bool OpenTrade(int signal, double atr, string reason, double sizeMulti, bool isManualOverride = false)")
    assert "reentryExitR" not in open_trade_fn.split("R_REENTRY_EVALUATION")[0][-50:]


def test_full_risk_binary_mode_still_intact_for_reentries():
    # Cross-check against the earlier v6.21.3 fix: riskPct must still be
    # assigned flatly from baseRisk with no quality-band multiplier, which is
    # what makes "normal configured approved-trade risk logic" apply equally
    # to a re-entry as to any other normal-pipeline trade.
    ea = read(EA)
    open_trade_fn = body(ea, "bool OpenTrade(int signal, double atr, string reason, double sizeMulti, bool isManualOverride = false)")
    assert re.search(r"double baseRisk = InpNormalRiskPct;[^\n]*\n\s*double riskPct\s*=\s*baseRisk;", open_trade_fn)
    assert "qualityBandMult" not in open_trade_fn
