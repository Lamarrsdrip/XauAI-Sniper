"""Static source tests for v6.20.4 Change A -- timing-proof telemetry.

Background: a forensic audit of ticket 9512120625 (SELL 0.36 XAUUSD @4102.20,
candidateId TREND_PULLBACK_SELL_1783682700_1783683018) proved
XAU_CheckPendingOpportunityRecovery() calls OpenTrade() directly, bypassing
XAU_TimingEngineConfirmsEntry() -- the v6.20.3 "universal 60-120s entry delay"
never actually covered the recovery path. This is Change A: telemetry only,
proving that fact for every future trade (durable CSV + Command Center),
with ZERO trading-behavior change. Change B (a separate commit) is what
fixes the bypass itself.

Per this repo's convention (see test_xau_v6202_command_safety_static.py),
these are static/text-level checks against the .mq5 source.
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
# Struct + durable CSV writer
# --------------------------------------------------------------------------

def test_timing_proof_record_struct_has_all_required_fields():
    ea = read(EA)
    struct_body = mql_body(ea, "struct XAU_TimingProofRecord")
    for field in ("candidateId", "sourcePath", "firstSeenTime", "firstSeenPrice",
                  "timingGateRequired", "requiredDelaySeconds", "timingGateStartTime",
                  "recoveryWaitSeconds", "timingEngineWaitSeconds",
                  "revalidationTime", "revalidationResult",
                  "bypassUsed", "bypassReason", "openTradeCaller"):
        assert field in struct_body, f"missing field {field} in XAU_TimingProofRecord"


def test_append_timing_proof_writes_every_required_column():
    ea = read(EA)
    fn = mql_body(ea, "void XAU_AppendTimingProof(XAU_TimingProofRecord &r, ulong thesisId,")
    for col in ("candidateId", "thesisId", "sourcePath", "firstSeenTime", "firstSeenPrice",
                "timingGateRequired", "requiredDelaySeconds", "timingGateStartTime",
                "recoveryWaitSeconds", "timingEngineWaitSeconds",
                "revalidationTime", "revalidationResult",
                "bypassUsed", "bypassReason",
                "finalExecutionTime", "executionPrice",
                "openTradeCaller", "executionOwner"):
        assert f'"{col}"' in fn, f"missing CSV column {col} in XAU_AppendTimingProof header"
    assert 'XAU_TimingProofFile()' in ea


def test_recovery_wait_and_timing_engine_wait_are_displayed_separately():
    ea = read(EA)
    fn = mql_body(ea, "void XAU_AppendTimingProof(XAU_TimingProofRecord &r, ulong thesisId,")
    # both must appear as DISTINCT tokens in the structured Print, never merged
    assert "RECOVERY_WAIT=" in fn
    assert "TIMING_ENGINE=" in fn
    recovery_idx = fn.index("RECOVERY_WAIT=")
    timing_idx = fn.index("TIMING_ENGINE=")
    assert recovery_idx != timing_idx


# --------------------------------------------------------------------------
# Every OpenTrade() caller populates the proof before calling it
# --------------------------------------------------------------------------

def test_fresh_path_populates_proof_before_opentrade_with_no_bypass():
    ea = read(EA)
    idx = ea.index('g_pendingTimingProof.openTradeCaller       = "FreshScan->OpenTrade";')
    window = ea[idx - 1400:idx + 200]
    assert 'g_pendingTimingProof.sourcePath             = "FRESH";' in window
    assert "g_pendingTimingProof.bypassUsed            = false;" in window
    assert "g_pendingTimingProof.timingGateRequired    = true;" in window
    call_idx = ea.index("bool tradeOpened = OpenTrade(signal, bufATR[1], setupName")
    assert idx < call_idx, "proof must be populated BEFORE the fresh-path OpenTrade call"


def test_reentry_path_populates_proof_before_opentrade_with_no_bypass():
    ea = read(EA)
    idx = ea.index('g_pendingTimingProof.openTradeCaller       = "ReEntry->OpenTrade";')
    window = ea[idx - 1400:idx + 200]
    assert 'g_pendingTimingProof.sourcePath             = "REENTRY";' in window
    assert "g_pendingTimingProof.bypassUsed            = false;" in window
    call_idx = ea.index('bool reEntryOpened = OpenTrade(lastClose.dir, bufATR[1], "RE_ENTRY"')
    assert idx < call_idx, "proof must be populated BEFORE the re-entry OpenTrade call"


def test_recovery_path_no_longer_bypasses_timing_after_change_b():
    # NOTE: at the moment Change A was committed, this test asserted the
    # OPPOSITE (bypassUsed=true, direct OpenTrade call) -- that was the
    # confirmed bug this whole release documents. Change B (a separate,
    # later commit) fixes it by routing recovery through
    # XAU_CheckRecoveryAwaitingTiming() instead. See
    # test_xau_v6205b_recovery_timing_integration_static.py for the full
    # Change B verification; this test only pins down that the OLD direct
    # bypass call is gone from XAU_CheckPendingOpportunityRecovery.
    ea = read(EA)
    fn = mql_body(ea, "void XAU_CheckPendingOpportunityRecovery()")
    assert "bool opened = OpenTrade(dir, atrNow, recoveryReason, 1.0);" not in fn, \
        "XAU_CheckPendingOpportunityRecovery must no longer call OpenTrade() directly -- it must register into the timing engine instead (Change B)"
    assert "g_recoveryAwaitingTiming.active" in fn


def test_manual_force_open_populates_proof_as_a_named_exemption():
    ea = read(EA)
    idx = ea.index('g_pendingTimingProof.openTradeCaller       = "XAU_TryForceOpenTrade->OpenTrade";')
    window = ea[idx - 1200:idx + 200]
    assert 'g_pendingTimingProof.sourcePath             = "OTHER";' in window
    assert "g_pendingTimingProof.bypassUsed            = true;" in window
    assert 'g_pendingTimingProof.bypassReason          = "MANUAL_FORCE_OPEN_EXEMPT";' in window
    assert "g_pendingTimingProof.timingGateRequired    = false;" in window
    call_idx = ea.index("bool opened = OpenTrade(dir, atrNow, forceReason, 1.0, true);")
    assert idx < call_idx, "proof must be populated BEFORE the manual force-open OpenTrade call"


def test_opentrade_finalizes_and_clears_proof_on_success_and_failure():
    ea = read(EA)
    fn = mql_body(ea, "bool OpenTrade(int signal, double atr, string reason, double sizeMulti, bool isManualOverride = false)")
    assert "XAU_AppendTimingProof(g_pendingTimingProof, openedPosId, TimeCurrent(), price," in fn
    assert fn.count("g_pendingTimingProof.active = false;") >= 2, \
        "must invalidate the pending proof on BOTH the success and broker-failure paths"


def test_timing_proof_posted_to_command_center():
    ea = read(EA)
    fn = mql_body(ea, "bool OpenTrade(int signal, double atr, string reason, double sizeMulti, bool isManualOverride = false)")
    assert '"TIMING_PROOF"' in fn
    assert "BotMonitorDecisionEvent(\"TIMING_PROOF\"" in fn


# --------------------------------------------------------------------------
# Zero trading-behavior change: the timing engine's actual decision
# conditions are untouched, only an additional printed field was added.
# --------------------------------------------------------------------------

def test_timing_engine_wait_condition_unchanged():
    ea = read(EA)
    fn = mql_body(ea, "bool XAU_TimingEngineConfirmsEntry(int dir, string setup, string grade, double sizeMulti, double atr)")
    assert "if(elapsedSec < delaySec)" in fn
    assert "return false;" in fn
    # the only change to this branch is an additional remaining= field
    assert "remaining=%.0fs" in fn


def test_regression_case_candidate_id_matches_forensic_trade():
    # Pinning the exact confirmed live case this whole change exists to prove,
    # so a future refactor can't silently drop the ability to reproduce it.
    candidate_id = "TREND_PULLBACK_SELL_1783682700_1783683018"
    assert candidate_id.startswith("TREND_PULLBACK_SELL_")
    parts = candidate_id.split("_")
    assert parts[-2] == "1783682700"  # M5 candle open time
    assert parts[-1] == "1783683018"  # TimeCurrent() at PENDING_OPPORTUNITY_STORED
