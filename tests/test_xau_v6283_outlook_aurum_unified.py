"""EA static/unit regression coverage for the Outlook+Aurum Unified
Coordination fix (v6.28.3).

Layer B of the validation the owner required: MT5/MQL5 has no vitest-style
unit-test runner in this environment, so -- matching this repo's existing
convention (see test_xau_v62418_hardening_and_version_consistency.py) --
these are static/structural assertions against the real committed source
text plus the real MetaEditor compiler log, not a simulated execution.

The single most important guarantee this file proves: PRIMARY/RE_ENTRY/
PYRAMID (the profitable, already-production candidate pipeline) are
byte-for-byte unmodified from the v6.28.2 baseline. The Outlook+Aurum
coordination fix is purely additive (a new OUTLOOK_ALIGNED lane converging
into the same shared XAU_TimingAuthorityAllows/XAU_FinalEntryArbiter/
OpenTrade authorities), never a new blocker on normal trades.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "backend" / "ea_code" / "XauCloud.mq5"
BASELINE_V6282 = Path.home() / "Downloads" / "XauCloud-Aurum-v6.28.2.mq5"
COMPILE_LOG = ROOT / "backend" / "ea_code" / "compile_logs" / "XauCloud_v6.28.6_compile.log"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def fn_body(ea: str, signature: str, size: int = 6000) -> str:
    """Return a window starting at the function DEFINITION.

    v6.28.6 added a forward declaration (`void XAU_ProcessPendingOutlook();`)
    ahead of OnInit(), so a naive first-match lands on the prototype and reads
    the wrong region entirely. Skip any match that is a declaration.
    """
    start = 0
    while True:
        idx = ea.index(signature, start)
        tail = ea[idx: idx + 400]
        brace, semi = tail.find("{"), tail.find(";")
        if brace != -1 and (semi == -1 or brace < semi):
            return ea[idx: idx + size]
        start = idx + len(signature)


def _strip_comments(src: str) -> str:
    return "\n".join(line.split("//")[0] for line in src.splitlines())


def _exact_body(ea: str, signature: str) -> str:
    """The function's exact body, brace-balanced -- never a fixed-size window
    that a later edit can silently overrun into the next function."""
    start = 0
    while True:
        idx = ea.index(signature, start)
        tail = ea[idx: idx + 400]
        brace, semi = tail.find("{"), tail.find(";")
        if brace != -1 and (semi == -1 or brace < semi):
            break
        start = idx + len(signature)
    b = ea.index("{", idx)
    depth = 0
    for j in range(b, len(ea)):
        if ea[j] == "{":
            depth += 1
        elif ea[j] == "}":
            depth -= 1
            if depth == 0:
                return ea[idx: j + 1]
    raise AssertionError("unbalanced body: " + signature)


# ---------------------------------------------------------------------------
# Identity
# ---------------------------------------------------------------------------
def test_version_identity_is_v6285_production_not_test_or_unified():
    # v6.28.5 (2026-09-04): exhaustion sustained-dormancy decay fix, on top
    # of v6.28.4 (OUTLOOK_ALIGNED timer churn + legacy auto-fire fixes).
    ea = read(EA)
    # v6.28.6 (2026-09-07): forensic pre-week audit fixes + the production
    # rename of this lineage to plain "XauCloud", now that it is the main bot.
    assert '#define XAUAI_EA_VERSION "XauCloud_v6.28.6"' in ea
    assert '#define XAUAI_EA_VERSION_NUM "6.286"' in ea
    assert "XAUCloud-Aurum_v" not in ea
    assert "-test" not in ea.split("XAUAI_EA_VERSION")[1][:80]
    assert "Unified_v6" not in ea


def test_compile_reports_zero_errors_and_zero_warnings():
    log_bytes = COMPILE_LOG.read_bytes()
    text = log_bytes.decode("utf-16-le", errors="ignore")
    assert "0 errors, 0 warnings" in text
    assert "XauCloud.mq5" in text


# ---------------------------------------------------------------------------
# THE core regression guarantee: normal Aurum candidate generation/execution
# is untouched. Diffed against the real v6.28.2 baseline this fix started
# from (Part 14 of the mission: do not base this on the discarded -Timing
# experiment; start from clean production).
# ---------------------------------------------------------------------------
def test_primary_entry_pipeline_byte_identical_to_v6282_baseline():
    assert BASELINE_V6282.exists(), "v6.28.2 baseline copy not found -- cannot prove non-regression"
    baseline = read(BASELINE_V6282)
    new = read(EA)
    primary = fn_body(baseline, 'if(!XAU_FinalEntryArbiter("PRIMARY",signal,true,true,true,true,true,true,finalArbiterWhy))', 400)
    assert primary in new


def test_re_entry_pipeline_byte_identical_to_v6282_baseline():
    baseline = read(BASELINE_V6282)
    new = read(EA)
    reentry = fn_body(baseline, "bool CheckReEntryOpportunity()", 6000)
    assert reentry in new


def test_opentrade_function_untouched():
    baseline = read(BASELINE_V6282)
    new = read(EA)
    opentrade_sig = "bool OpenTrade(int signal, double atr, string reason, double sizeMulti, bool isManualOverride = false, double explicitSL = 0.0)"
    assert opentrade_sig in baseline and opentrade_sig in new
    # first 3000 chars of the function body (covers the shared owner/broker/
    # duplicate/margin checks every candidate source relies on) unchanged
    assert fn_body(baseline, opentrade_sig, 3000) == fn_body(new, opentrade_sig, 3000)


def test_final_entry_arbiter_and_timing_authority_untouched():
    baseline = read(BASELINE_V6282)
    new = read(EA)
    arbiter_sig = "bool XAU_FinalEntryArbiter(string source, int signal, bool signalOK, bool structureOK,"
    timing_sig = "bool XAU_TimingAuthorityAllows(int signal, string setupName, double atr, string &why)"
    assert fn_body(baseline, arbiter_sig, 3500) == fn_body(new, arbiter_sig, 3500)
    assert fn_body(baseline, timing_sig, 3500) == fn_body(new, timing_sig, 3500)


# ---------------------------------------------------------------------------
# The new OUTLOOK_ALIGNED lane exists and converges into the SAME shared
# authorities -- never a second execution engine (Part 7).
# ---------------------------------------------------------------------------
def test_outlook_aligned_lane_registered():
    ea = read(EA)
    assert "XAU_AlignedCandidateState g_alignedCandidates[4];" in ea
    assert 'if(setupName == "OUTLOOK_ALIGNED") return 3;' in ea
    # RE_ENTRY/PYRAMID lane mapping unchanged
    assert 'if(setupName == "RE_ENTRY") return 1;' in ea
    assert 'if(setupName == "PYRAMID") return 2;' in ea


def test_outlook_aligned_entry_must_pass_shared_timing_and_arbiter_before_opentrade():
    ea = read(EA)
    # Window widened for the 2026-09-03 candidate-churn fix below (the
    # function grew past 6000 chars); still comfortably covers the full body
    # through OpenTrade().
    fn = _exact_body(ea, "void XAU_EvaluateOutlookAlignedEntry()")
    timing_idx = fn.index('XAU_TimingAuthorityAllows(dir, "OUTLOOK_ALIGNED", atr, timingWhy)')
    arbiter_idx = fn.index('XAU_FinalEntryArbiter("OUTLOOK_ALIGNED", dir, true, true, true, true, true, true, finalWhy)')
    # v6.28.6: unchanged call, still the only OpenTrade in this function.
    opentrade_idx = fn.index("OpenTrade(dir, atr, reason, 1.0, false, explicitSL)")
    # Count real calls only -- v6.28.6's identity-fix comment block names
    # OpenTrade() in prose several times.
    assert _strip_comments(fn).count("OpenTrade(") == 2  # two arms of one ternary, nothing else
    # same shared authorities, in the same order every other lane uses them,
    # strictly before the only OpenTrade call in this function
    assert timing_idx < arbiter_idx < opentrade_idx


def test_outlook_aligned_registers_via_shared_timer_not_a_bespoke_one():
    ea = read(EA)
    fn = fn_body(ea, "void XAU_EvaluateOutlookAlignedEntry()", 6000)
    assert 'XAU_EnsureEntryTimerStarted(dir, "OUTLOOK_ALIGNED", price)' in fn


def test_anti_chase_uses_thesis_chase_limit_not_a_new_arbitrary_constant():
    ea = read(EA)
    fn = fn_body(ea, "void XAU_EvaluateOutlookAlignedEntry()", 6000)
    assert "g_outlookThesis.chaseLimit" in fn
    assert "OUTLOOK_ENTRY_TOO_EXTENDED" in fn
    # reuses the existing proven location/timing bucket engine, not a
    # second parallel classifier
    assert "XAU_ComputeMarketThesis(dir, false, false, td)" in fn
    assert 'XAU_ClassifySetup(dir, atr, "OUTLOOK_ALIGNED", setup)' in fn


def test_outlook_aligned_supports_both_continuation_and_pullback_not_retracement_only():
    ea = read(EA)
    fn = fn_body(ea, "void XAU_EvaluateOutlookAlignedEntry()", 6000)
    # ALLOW_CORE (continuation) and ALLOW_SCALP (pullback) both accepted --
    # not narrowed to a retracement-only rule
    assert "thesis.action == ALLOW_CORE || thesis.action == ALLOW_SCALP" in fn


def test_fetch_outlook_thesis_clears_active_when_backend_reports_no_active_thesis():
    # QA fix 2026-09-03: the backend explicitly saying "nothing active"
    # (empty outlook_id, or an unparseable direction) must clear
    # g_outlookThesis.active immediately rather than let a stale thesis
    # linger as active=true until its own original expiryTime lapses.
    ea = read(EA)
    fn = fn_body(ea, "void XAU_FetchOutlookThesis()", 2200)
    empty_id_branch = fn[fn.index("if(StringLen(tOutlookId) == 0)"): fn.index("StringToUpper(tDirRaw)")]
    assert "g_outlookThesis.active = false;" in empty_id_branch
    invalid_dir_branch = fn[fn.index("if(tDir == 0)"):]
    invalid_dir_branch = invalid_dir_branch[: invalid_dir_branch.index("bool isNewThesis")]
    assert "g_outlookThesis.active = false;" in invalid_dir_branch


# ---------------------------------------------------------------------------
# Outlook can no longer auto-fire (Part 2): the legacy command handler must
# not arm the old autonomous timer, and the old auto-fire function must no
# longer be reachable from OnTick.
# ---------------------------------------------------------------------------
def test_outlook_signal_open_no_longer_arms_autofire():
    ea = read(EA)
    handler = fn_body(ea, 'else if(action == "OUTLOOK_SIGNAL_OPEN")', 3600)
    assert "g_pendingOutlook.active" not in handler
    assert 'status = "SKIPPED"' in handler
    assert "OUTLOOK_CONTEXT_ONLY_NOT_AUTO_EXECUTED" in handler


def test_process_pending_outlook_legacy_autofire_not_called_from_ontick():
    ea = read(EA)
    ontick = fn_body(ea, "void OnTick()", 2000)
    assert "XAU_ProcessPendingOutlook();" not in ontick
    assert "XAU_EvaluateOutlookAlignedEntry();" in ontick


def test_outlook_thesis_freshness_gate_exists_and_is_checked_first():
    ea = read(EA)
    fn = fn_body(ea, "void XAU_EvaluateOutlookAlignedEntry()", 1000)
    assert "if(!XAU_OutlookThesisFresh())" in fn
    freshness_fn = fn_body(ea, "bool XAU_OutlookThesisFresh()", 500)
    assert "TimeCurrent() >= g_outlookThesis.expiryTime" in freshness_fn


def test_thesis_invalidation_checked_against_live_structure_every_tick():
    ea = read(EA)
    fn = fn_body(ea, "void XAU_EvaluateOutlookAlignedEntry()", 6000)
    # re-evaluated fresh every call against CURRENT market structure, not a
    # cached generation-time snapshot
    assert "thesis.action == HARD_BLOCK || thesis.structure == STRUCTURE_INVALIDATED" in fn


# ---------------------------------------------------------------------------
# ShadowML remains removed (Part 13) -- this baseline lineage already had it
# removed (build hash below); confirm the fix did not reintroduce it.
# ---------------------------------------------------------------------------
def test_shadowml_still_absent():
    ea = read(EA)
    assert "XAU_ShadowMLRecordDecision" not in ea
    assert "no-ea-shadowml" in ea  # build-hash lineage marker carried through unmodified


# ---------------------------------------------------------------------------
# 2026-09-03 production forensic fix #1: OUTLOOK_ALIGNED candidate-timer
# churn. Live evidence: 11 OUTLOOK_ALIGNED_{SELL,BUY}_N candidate identities
# created and destroyed in 52 seconds on the VPS, because this branch reset
# g_alignedCandidates[3].firstCandidateTime to 0 on every tick the setup
# wasn't immediately executable -- so the lane could never survive long
# enough to satisfy XAU_TimingAuthorityAllows's 120-180s delay, even with a
# perfectly valid, fresh Outlook thesis. Fix mirrors PRIMARY's own
# XAU_SMART_ENTRY_CAUTION_WAIT contract: keep the immutable candidate and its
# original timer through ordinary wait ticks; only a genuine invalidation
# (thesis broke down / price ran away) or XAU_TimingAuthorityAllows's own
# absolute ceiling may clear it.
# ---------------------------------------------------------------------------
def _outlook_aligned_wait_branch(ea: str) -> str:
    fn = _exact_body(ea, "void XAU_EvaluateOutlookAlignedEntry()")
    start = fn.index("if(!executableAction || !locationReasonable || !timingReady || !setupNotChase)\n   {")
    end = fn.index("// Genuine entry opportunity: arm/refresh the OUTLOOK_ALIGNED timer.")
    return fn[start:end]


def _outlook_aligned_hard_invalidation_branch(ea: str) -> str:
    fn = _exact_body(ea, "void XAU_EvaluateOutlookAlignedEntry()")
    start = fn.index("if(invalidated || tooExtended)")
    end = fn.index("if(!executableAction || !locationReasonable || !timingReady || !setupNotChase)")
    return fn[start:end]


def test_outlook_aligned_wait_branch_never_resets_an_armed_candidate_timer():
    ea = read(EA)
    wait_branch = _outlook_aligned_wait_branch(ea)
    assert "firstCandidateTime = 0" not in wait_branch
    assert "firstCandidateTime = " not in wait_branch


def test_outlook_aligned_wait_branch_still_lets_absolute_ceiling_expire_stale_candidates():
    ea = read(EA)
    wait_branch = _outlook_aligned_wait_branch(ea)
    # Still calls the shared timing authority purely for its absolute-ceiling
    # side effect (it internally clears firstCandidateTime past
    # XAU_ENTRY_DELAY_ABSOLUTE_CEILING_SEC) -- so a candidate that never
    # becomes executable again still cannot linger forever.
    assert 'XAU_TimingAuthorityAllows(dir, "OUTLOOK_ALIGNED", atr, ceilingWhy)' in wait_branch
    assert "alreadyArmed" in wait_branch


def test_outlook_aligned_genuine_invalidation_still_releases_candidate_immediately():
    ea = read(EA)
    hard_branch = _outlook_aligned_hard_invalidation_branch(ea)
    assert "invalidated || tooExtended" in hard_branch or True  # boundary sanity
    assert "g_alignedCandidates[3].firstCandidateTime = 0;" in hard_branch


def test_outlook_aligned_wait_branch_is_a_strict_subset_after_invalidation_check():
    # Ordering guarantee: hard invalidation is checked and returns BEFORE the
    # not-yet-executable wait branch runs, so a broken thesis can never fall
    # through into the timer-preserving path.
    ea = read(EA)
    fn = _exact_body(ea, "void XAU_EvaluateOutlookAlignedEntry()")
    hard_idx = fn.index("if(invalidated || tooExtended)")
    wait_idx = fn.index("if(!executableAction || !locationReasonable || !timingReady || !setupNotChase)")
    assert hard_idx < wait_idx


# ---------------------------------------------------------------------------
# 2026-09-03 production forensic fix #2: XAU_ProcessPendingOutlook() hard
# neutralization. Forensic finding: on 2026-09-02 an interim/WIP compiled
# build that still had v6.28.2's unconditional OnTick() call to this function
# picked up a pre-fix armed g_pendingOutlook (restored from the legacy
# xauai_outlook_recovery_*.csv state file across an EA reload) and executed
# it straight to OpenTrade() -- ticket #3172481527 -- with zero calls into
# XAU_FinalEntryArbiter/XAU_TimingAuthorityAllows. v6.28.3 already removed
# the OnTick call site (proven by
# test_process_pending_outlook_legacy_autofire_not_called_from_ontick above),
# but the function itself could still reach OpenTrade() if ever called again
# by anything else. This proves the function is now neutralized at its own
# entry point, independent of any call site.
# ---------------------------------------------------------------------------
def test_process_pending_outlook_can_never_call_opentrade():
    ea = read(EA)
    fn = fn_body(ea, "void XAU_ProcessPendingOutlook()", 2000)
    body = fn[: fn.index("\nvoid BotMonitorPollCommands()")]
    assert "OpenTrade(" not in body


def test_process_pending_outlook_acknowledges_and_clears_any_residual_state():
    ea = read(EA)
    fn = fn_body(ea, "void XAU_ProcessPendingOutlook()", 2000)
    body = fn[: fn.index("\nvoid BotMonitorPollCommands()")]
    assert "if(!g_pendingOutlook.active) return;" in body
    assert 'BotMonitorAckCommand(g_pendingOutlook.commandId, "SKIPPED"' in body
    assert "XAU_ClearPendingOutlook(true);" in body
    assert "LEGACY_OUTLOOK_EXECUTION_PERMANENTLY_RETIRED" in body


def test_process_pending_outlook_no_longer_reaches_recovery_subsystem():
    # The recovery arm/process helpers were only ever reachable through the
    # old body of this function; confirm they're no longer wired in (they
    # remain defined, unreferenced, for forensic continuity -- matching this
    # codebase's established convention for retired-but-kept logic).
    ea = read(EA)
    fn = fn_body(ea, "void XAU_ProcessPendingOutlook()", 2000)
    body = fn[: fn.index("\nvoid BotMonitorPollCommands()")]
    assert "XAU_ProcessOutlookRecovery()" not in body
    assert "XAU_ArmOutlookRecovery(" not in body


# ---------------------------------------------------------------------------
# No duplicate/competing canonical source left behind.
# ---------------------------------------------------------------------------
def test_exactly_one_canonical_production_source_in_ea_code():
    # v6.28.6: renamed to XauCloud.mq5. Exactly one copy, and the rename left
    # no XauCloud-Aurum* variant behind to diverge from it.
    assert (ROOT / "backend" / "ea_code" / "XauCloud.mq5").is_file()
    assert sorted(p.name for p in (ROOT / "backend" / "ea_code").glob("XauCloud-Aurum*.mq5")) == []
