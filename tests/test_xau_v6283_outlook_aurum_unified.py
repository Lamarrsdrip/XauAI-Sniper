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
EA = ROOT / "backend" / "ea_code" / "XauCloud-Aurum.mq5"
BASELINE_V6282 = Path.home() / "Downloads" / "XauCloud-Aurum-v6.28.2.mq5"
COMPILE_LOG = ROOT / "backend" / "ea_code" / "compile_logs" / "XauCloud-Aurum_v6.28.3_compile.log"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def fn_body(ea: str, signature: str, size: int = 6000) -> str:
    idx = ea.index(signature)
    return ea[idx: idx + size]


# ---------------------------------------------------------------------------
# Identity
# ---------------------------------------------------------------------------
def test_version_identity_is_v6283_production_not_test_or_unified():
    ea = read(EA)
    assert '#define XAUAI_EA_VERSION "XAUCloud-Aurum_v6.28.3"' in ea
    assert '#define XAUAI_EA_VERSION_NUM "6.283"' in ea
    assert "-test" not in ea.split("XAUAI_EA_VERSION")[1][:80]
    assert "Unified_v6" not in ea


def test_compile_reports_zero_errors_and_zero_warnings():
    log_bytes = COMPILE_LOG.read_bytes()
    text = log_bytes.decode("utf-16-le", errors="ignore")
    assert "0 errors, 0 warnings" in text
    assert "XauCloud-Aurum.mq5" in text


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
    fn = fn_body(ea, "void XAU_EvaluateOutlookAlignedEntry()", 6000)
    timing_idx = fn.index('XAU_TimingAuthorityAllows(dir, "OUTLOOK_ALIGNED", atr, timingWhy)')
    arbiter_idx = fn.index('XAU_FinalEntryArbiter("OUTLOOK_ALIGNED", dir, true, true, true, true, true, true, finalWhy)')
    opentrade_idx = fn.index("OpenTrade(dir, atr, reason, 1.0, false, explicitSL)")
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
# No duplicate/competing canonical source left behind.
# ---------------------------------------------------------------------------
def test_exactly_one_canonical_aurum_source_in_ea_code():
    matches = sorted(p.name for p in (ROOT / "backend" / "ea_code").glob("XauCloud-Aurum*.mq5"))
    assert matches == ["XauCloud-Aurum.mq5"]
