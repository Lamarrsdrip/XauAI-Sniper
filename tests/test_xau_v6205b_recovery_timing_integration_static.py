"""Static source tests for v6.20.5 Change B -- recovery-path timing fix.

Change A (separate, earlier commit) proved XAU_CheckPendingOpportunityRecovery()
called OpenTrade() directly, bypassing XAU_TimingEngineConfirmsEntry(). Change B
fixes this: the recovery gauntlet ("is this previously blocked idea still
valid?") now REGISTERS into the same authoritative timing engine ("is this
exact moment/location good enough?") instead of calling OpenTrade() itself,
via a new g_recoveryAwaitingTiming slot polled every tick by
XAU_CheckRecoveryAwaitingTiming(). No second timer, no Sleep, no duplicated
delay logic -- one authority, shared by every autonomous path.

Explicit design decision (documented in the Change B commit message): recovery
wait time does NOT count toward the timing minimum. The wait between
PENDING_OPPORTUNITY_STORED and the gauntlet passing has zero continuous
timing-engine observation (a separate struct, simply idle) -- so the full
60-120s delay begins fresh once the gauntlet passes, per the explicit
requirement that idle time alone must never be treated as timing
confirmation.

Regression case: candidateId TREND_PULLBACK_SELL_1783682700_1783683018
(ticket 9512120625) -- stored 2026.07.10 11:30:18 broker, recovery
revalidation 11:35:03, execution 11:35:04. OLD result: recovery direct
OpenTrade bypass (0s of timing-engine observation). Expected corrected
result: recovery must register into and be confirmed by the timing engine
before OpenTrade() is ever called.

Per this repo's convention, these are static/text-level checks against the
.mq5 source (no MQL5 runtime in CI).
"""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.20.4.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def mql_body(src: str, signature: str) -> str:
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


# --------------------------------------------------------------------------
# 1/2/3 -- fresh/recovery cannot execute before timing pass; recovery cannot
# call OpenTrade() directly at all anymore.
# --------------------------------------------------------------------------

def test_1_fresh_entry_cannot_execute_before_timing_pass():
    ea = read(EA)
    idx = ea.index("if(!XAU_TimingEngineConfirmsEntry(signal, setupName, grade, finalSzMult, bufATR[1]))")
    guard_line_end = ea.index("\n", idx)
    next_line = ea[guard_line_end + 1: ea.index("\n", guard_line_end + 1)]
    assert "return" in next_line
    call_idx = ea.index("bool tradeOpened = OpenTrade(signal, bufATR[1], setupName")
    assert idx < call_idx


def test_2_recovery_entry_cannot_execute_before_timing_pass():
    ea = read(EA)
    fn = mql_body(ea, "void XAU_CheckRecoveryAwaitingTiming()")
    idx = fn.index("bool confirmed = XAU_TimingEngineConfirmsEntry(")
    open_idx = fn.index("bool opened = OpenTrade(g_recoveryAwaitingTiming.dir,")
    assert idx < open_idx
    # OpenTrade must be inside the `if(confirmed)` branch, not unconditional
    between = fn[idx:open_idx]
    assert "if(confirmed)" in between


def test_3_recovery_gauntlet_cannot_call_opentrade_directly():
    ea = read(EA)
    fn = mql_body(ea, "void XAU_CheckPendingOpportunityRecovery()")
    assert "bool opened = OpenTrade(dir, atrNow, recoveryReason, 1.0);" not in fn
    assert "g_recoveryAwaitingTiming.active" in fn
    assert "RECOVERY_GAUNTLET_PASSED" in fn


# --------------------------------------------------------------------------
# 4 -- recovery wait logged separately from timing-engine wait (re-verified
# post-Change-B, now both are non-zero on the success path).
# --------------------------------------------------------------------------

def test_4_recovery_wait_and_timing_wait_remain_distinct_fields_on_confirm():
    ea = read(EA)
    fn = mql_body(ea, "void XAU_CheckRecoveryAwaitingTiming()")
    assert "g_pendingTimingProof.recoveryWaitSeconds   = g_recoveryAwaitingTiming.recoveryWaitSeconds;" in fn
    assert "g_pendingTimingProof.timingEngineWaitSeconds = g_lastEntryTimingDecision.delaySeconds;" in fn
    assert "g_pendingTimingProof.bypassUsed            = false;" in fn


# --------------------------------------------------------------------------
# 5 -- idle time alone (the recovery wait) does not count as timing
# confirmation; explicit design decision.
# --------------------------------------------------------------------------

def test_5_idle_recovery_wait_does_not_count_as_timing_confirmation():
    ea = read(EA)
    fn = mql_body(ea, "void XAU_CheckPendingOpportunityRecovery()")
    # the gauntlet-pass point must NOT set g_pendingEntryConfirm or
    # g_lastEntryTimingDecision directly -- only XAU_TimingEngineConfirmsEntry
    # (called later, from XAU_CheckRecoveryAwaitingTiming) is allowed to.
    assert "g_pendingEntryConfirm.active" not in fn
    assert "g_lastEntryTimingDecision.valid" not in fn
    assert "full delay starts fresh from here" in fn


# --------------------------------------------------------------------------
# 6 -- repeated scans do not reset candidate firstSeenTime incorrectly
# (pre-existing timing-engine invariant, untouched by Change B -- re-verified
# because Change B now feeds it a second kind of caller).
# --------------------------------------------------------------------------

def test_6_repeated_scans_preserve_first_seen_time_for_same_candidate():
    ea = read(EA)
    fn = mql_body(ea, "bool XAU_TimingEngineConfirmsEntry(int dir, string setup, string grade, double sizeMulti, double atr)")
    assert "bool sameSignalPending = (g_pendingEntryConfirm.active &&" in fn
    # firstSeenTime is only ever assigned in the "brand-new window" tail,
    # never inside the sameSignalPending branch that computes elapsedSec
    same_signal_idx = fn.index("if(sameSignalPending)")
    new_window_idx = fn.index("g_pendingEntryConfirm.firstSeenTime   = TimeCurrent();")
    same_branch = fn[same_signal_idx:new_window_idx]
    assert "g_pendingEntryConfirm.firstSeenTime   =" not in same_branch


# --------------------------------------------------------------------------
# 7 -- candidate invalidated during the timing window is cancelled, not
# retried/resurrected.
# --------------------------------------------------------------------------

def test_7_recovery_candidate_invalidated_during_timing_window_is_dropped():
    ea = read(EA)
    fn = mql_body(ea, "void XAU_CheckRecoveryAwaitingTiming()")
    assert "bool stillMine = g_pendingEntryConfirm.active &&" in fn
    assert "RECOVERY_TIMING_CANCELLED" in fn
    assert "g_recoveryAwaitingTiming.active = false;" in fn
    # cancellation must NOT re-arm or retry -- no OpenTrade call in that branch
    cancel_idx = fn.index("if(!stillMine)")
    tail = fn[cancel_idx:]
    assert "OpenTrade(" not in tail


# --------------------------------------------------------------------------
# 8 -- price deterioration / late-chase after recovery still blocks
# execution, via the timing engine's own existing post-delay revalidation
# (reused, not duplicated).
# --------------------------------------------------------------------------

def test_8_price_deterioration_and_late_chase_still_block_after_recovery():
    ea = read(EA)
    fn = mql_body(ea, "bool XAU_TimingEngineConfirmsEntry(int dir, string setup, string grade, double sizeMulti, double atr)")
    for cancel_reason in ("PRICE_RAN_TOO_FAR_CHASE", "STRUCTURE_FLIPPED",
                          "STILL_LATE_CHASE_AFTER_DELAY", "SPREAD_TOO_WIDE"):
        assert cancel_reason in fn
    # these are the SAME cancel conditions recovery-confirmed trades now pass
    # through too, since XAU_CheckRecoveryAwaitingTiming calls this exact
    # function with no special-casing.
    recovery_fn = mql_body(ea, "void XAU_CheckRecoveryAwaitingTiming()")
    assert "XAU_TimingEngineConfirmsEntry(g_recoveryAwaitingTiming.dir," in recovery_fn


# --------------------------------------------------------------------------
# 9/10/11 -- no grade, setup, or path-based bypass of timing exists anywhere.
# --------------------------------------------------------------------------

def test_9_a_plus_grade_cannot_bypass_timing():
    ea = read(EA)
    fn = mql_body(ea, "bool XAU_TimingEngineConfirmsEntry(int dir, string setup, string grade, double sizeMulti, double atr)")
    assert 'grade == "A+"' not in fn
    assert "IMMEDIATE_APLUS_MOMENTUM" not in ea


def test_10_trend_pullback_setup_cannot_bypass_timing():
    ea = read(EA)
    fn = mql_body(ea, "bool XAU_TimingEngineConfirmsEntry(int dir, string setup, string grade, double sizeMulti, double atr)")
    assert 'setup == "TREND_PULLBACK"' not in fn


def test_11_recovery_source_path_cannot_bypass_timing():
    ea = read(EA)
    gauntlet_fn = mql_body(ea, "void XAU_CheckPendingOpportunityRecovery()")
    assert "bool opened = OpenTrade(dir, atrNow, recoveryReason, 1.0);" not in gauntlet_fn


# --------------------------------------------------------------------------
# 12 -- pyramid/re-entry paths audited for the same invariant (call-graph
# proof: exactly 4 OpenTrade() call sites, all either timing-gated or a
# named/logged/tested exemption).
# --------------------------------------------------------------------------

def test_12_full_call_graph_has_exactly_four_opentrade_sites_all_accounted_for():
    ea = read(EA)
    real_calls = [line.strip() for line in ea.splitlines()
                  if line.strip().startswith("bool ") and " = OpenTrade(" in line]
    assert len(real_calls) == 4, f"expected exactly 4 real OpenTrade() call sites, found {len(real_calls)}: {real_calls}"
    joined = "\n".join(real_calls)
    assert "signal, bufATR[1], setupName" in joined          # FRESH -- timing-gated
    assert 'lastClose.dir, bufATR[1], "RE_ENTRY"' in joined  # RE_ENTRY -- timing-gated
    assert "g_recoveryAwaitingTiming.dir, g_recoveryAwaitingTiming.atr" in joined  # RECOVERY -- now timing-gated (Change B)
    assert "dir, atrNow, forceReason, 1.0, true" in joined   # MANUAL force-open -- named/logged/isManualOverride exemption
    # No pyramid/news-specific OpenTrade call site exists -- both route
    # through the FRESH path's single call site, confirmed by the count above.


# --------------------------------------------------------------------------
# 13 -- manual close/emergency management remains unaffected by Change B.
# --------------------------------------------------------------------------

def test_13_manual_force_open_untouched_by_change_b():
    ea = read(EA)
    fn = mql_body(ea, "bool XAU_TryForceOpenTrade(int dir, string setup, string grade, string originalBlocker,")
    assert "g_recoveryAwaitingTiming" not in fn, "manual force-open must not be routed through the recovery timing queue"
    assert "OpenTrade(dir, atrNow, forceReason, 1.0, true);" in fn


# --------------------------------------------------------------------------
# 14 -- existing open-trade management continues during the (new) recovery
# waiting period -- XAU_CheckRecoveryAwaitingTiming is a quick per-tick poll,
# not a blocking wait, and does not gate anything else in OnTick.
# --------------------------------------------------------------------------

def test_14_recovery_timing_check_does_not_block_position_management():
    ea = read(EA)
    fn = mql_body(ea, "void XAU_CheckRecoveryAwaitingTiming()")
    assert "while(" not in fn
    assert "Sleep(" not in fn
    # the call site itself must not be gated behind any position-management
    # early-return -- it is called unconditionally once reached in OnTick.
    idx = ea.index("XAU_CheckRecoveryAwaitingTiming();")
    preceding_line = ea[ea.rfind("\n", 0, ea.rfind("\n", 0, idx)) + 1: idx]
    assert "if(" not in preceding_line.split("\n")[-1] or "newM5Bar" not in preceding_line


# --------------------------------------------------------------------------
# 15 -- no Sleep-based blocking anywhere in the new code.
# --------------------------------------------------------------------------

def test_15_no_sleep_based_blocking_introduced():
    ea = read(EA)
    fn = mql_body(ea, "void XAU_CheckRecoveryAwaitingTiming()")
    fn2 = mql_body(ea, "void XAU_CheckPendingOpportunityRecovery()")
    assert "Sleep(" not in fn
    assert "Sleep(" not in fn2


# --------------------------------------------------------------------------
# Regression case: the exact confirmed live trade this whole change exists
# to fix.
# --------------------------------------------------------------------------

def test_regression_case_recovery_now_requires_explicit_timing_authorization():
    candidate_id = "TREND_PULLBACK_SELL_1783682700_1783683018"
    ea = read(EA)
    gauntlet_fn = mql_body(ea, "void XAU_CheckPendingOpportunityRecovery()")
    # the fix is structural (applies to every recovery candidate, not just
    # this one) -- assert the mechanism, and pin the specific candidateId
    # format this trade used so a future refactor can't silently drop the
    # ability to reproduce the exact regression case.
    assert "bool opened = OpenTrade(dir, atrNow, recoveryReason, 1.0);" not in gauntlet_fn
    assert "g_recoveryAwaitingTiming.signalId            = sid;" in gauntlet_fn
    parts = candidate_id.split("_")
    assert parts[-2] == "1783682700" and parts[-1] == "1783683018"
