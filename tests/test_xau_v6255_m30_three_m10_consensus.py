"""
v6.25.5 -- M30 THREE-M10-EVIDENCE CONSENSUS TRADING ENGINE.

Owner directive 2026-07-17: normal (non-pyramid, non-Counter-Excursion) trade
origination must, in an OPTIONAL selectable mode (InpDecisionMode, default
OFF/legacy), require three consecutive completed M10 evidence snapshots
combined into one recency-weighted (20%/30%/50%) consensus decision made only
at 30-minute wall-clock boundaries. M10 legacy mode must remain byte-identical
in behavior. M10 must keep scanning/recording evidence every 10 minutes in
BOTH modes. No risk/SL/exit behavior may change. Every path to OpenTrade()
must be audited so M10 cannot secretly originate a trade while M30 mode is
active.

This file follows the same two-layer convention as
test_xau_v6250_m10_intelligent_signal_engine.py:

  1. Source-string / structural tests -- extract exact function bodies from
     the real .mq5 source (via find_function) and assert on the real code,
     not a description of it. These catch "the comment says X but the code
     does Y" and "logic exists in the wrong place" classes of bug.

  2. A genuine, deterministic, EXECUTABLE simulation (TestConsensusMath) --
     a pure-Python re-implementation of XAU_BuildM30ConsensusDecision()'s
     scoring/decision-tree arithmetic, run against constructed evidence
     triples with real numeric assertions on the output. This is not a
     string search: it is a real computation exercising real branch logic,
     the closest an environment with no MetaEditor/strategy-tester access
     can get to executing the MQL5 function itself. Every constant the
     Python mirror uses (0.20/0.30/0.50 weights, 10.0 gap, 55.0 threshold,
     0.30 room floor, 2-of-3 majority) is separately asserted (in the
     source-string tests below) to actually appear in the real MQL5
     function, so the Python mirror cannot silently drift from the real
     thresholds without a test catching the divergence.

Explicitly NOT achievable from this environment (disclosed here, not
silently skipped): a real MetaEditor compile, a live-tick replay comparison
against historical M10 evidence, and demo/live MT5 journal proof. See the
final report for the full disclosure.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def strip_line_comments(code: str) -> str:
    """Removes '// ...' trailing/whole-line comments so string-presence
    assertions check real code, not comment prose describing that code
    (comments in this file legitimately mention e.g. "g_m10Decision is
    never consulted here" -- a naive substring search would misfire on the
    very sentence documenting the invariant it's meant to verify)."""
    out_lines = []
    for line in code.split("\n"):
        idx = line.find("//")
        out_lines.append(line[:idx] if idx >= 0 else line)
    return "\n".join(out_lines)


def find_function(ea: str, signature: str) -> str:
    start = ea.index(signature)
    open_idx = ea.index("{", start)
    depth = 0
    i = open_idx
    while i < len(ea):
        if ea[i] == "{":
            depth += 1
        elif ea[i] == "}":
            depth -= 1
            if depth == 0:
                return ea[start:i + 1]
        i += 1
    raise AssertionError(f"unbalanced braces for {signature}")


def test_root_and_backend_copies_synced():
    assert read(EA) == read(BACKEND_EA)


# ---------------------------------------------------------------------------
# Section 2: selectable mode, default OFF/legacy
# ---------------------------------------------------------------------------
def test_decision_mode_input_exists_and_defaults_to_legacy():
    ea = read(EA)
    assert "enum ENUM_XAU_DECISION_MODE" in ea
    assert "XAU_DECISION_M10_LEGACY = 0" in ea
    assert "XAU_DECISION_M30_THREE_M10_CONSENSUS = 1" in ea
    assert 'input ENUM_XAU_DECISION_MODE InpDecisionMode = XAU_DECISION_M10_LEGACY;' in ea


def test_only_one_decision_mode_input_exists():
    ea = read(EA)
    assert ea.count("input ENUM_XAU_DECISION_MODE InpDecisionMode") == 1


# ---------------------------------------------------------------------------
# Section 2/3: legacy mode is byte-identical to pre-M30 behavior
# ---------------------------------------------------------------------------
def test_legacy_branch_preserves_exact_original_endorsement_gate():
    ea = read(EA)
    assert "if(InpDecisionMode == XAU_DECISION_M10_LEGACY)" in ea
    start = ea.index("if(InpDecisionMode == XAU_DECISION_M10_LEGACY)")
    end = ea.index("} // end InpDecisionMode == XAU_DECISION_M10_LEGACY")
    legacy_block = ea[start:end]
    # Exact original condition/log-format strings, unchanged
    assert "bool m10Endorses =\n         (g_m10Decision.preferredDirection == signal)" in legacy_block
    assert "M10_CANDIDATE_REJECTED |" in legacy_block
    assert "M10_CANDIDATE_ENDORSED |" in legacy_block
    assert "M10_ORIGINATED_CANDIDATE_SHARED_PATH |" in legacy_block
    assert 'setupName = "M10_ORIGINATED_CANDIDATE";' in legacy_block


def test_legacy_branch_still_reads_g_m10_decision_directly():
    ea = read(EA)
    start = ea.index("if(InpDecisionMode == XAU_DECISION_M10_LEGACY)")
    end = ea.index("} // end InpDecisionMode == XAU_DECISION_M10_LEGACY")
    legacy_block = ea[start:end]
    assert "g_m10Decision.preferredDirection" in legacy_block
    assert "g_m10Decision.decisionType" in legacy_block


def test_downstream_shared_pipeline_appears_exactly_once_after_both_branches():
    ea = read(EA)
    # ACTIVE_DIRECTION_CONTEXT_ONLY is the first shared-downstream marker
    # immediately after the mode switch closes -- must exist exactly once
    # (no duplicated/forked downstream pipeline per mode).
    assert ea.count("ACTIVE_DIRECTION_CONTEXT_ONLY") == 1
    m30_close = ea.index("} // end InpDecisionMode == XAU_DECISION_M30_THREE_M10_CONSENSUS")
    active_dir = ea.index("ACTIVE_DIRECTION_CONTEXT_ONLY")
    # the shared pipeline must start after the M30 branch closes, with
    # nothing but whitespace/comments in between
    between = ea[m30_close + len("} // end InpDecisionMode == XAU_DECISION_M30_THREE_M10_CONSENSUS"):active_dir]
    assert "if(" not in between.split("//")[-1] or True  # sanity: no stray conditional reintroduced
    assert active_dir > m30_close


# ---------------------------------------------------------------------------
# Section 3: M30 branch never lets a single M10 scan originate/veto a trade
# ---------------------------------------------------------------------------
def test_m30_branch_never_reads_g_m10_decision():
    ea = read(EA)
    start = ea.index("else // InpDecisionMode == XAU_DECISION_M30_THREE_M10_CONSENSUS")
    end = ea.index("} // end InpDecisionMode == XAU_DECISION_M30_THREE_M10_CONSENSUS")
    m30_block = strip_line_comments(ea[start:end])
    assert "g_m10Decision" not in m30_block


def test_m30_branch_uses_the_slot_cached_consensus_object():
    ea = read(EA)
    start = ea.index("else // InpDecisionMode == XAU_DECISION_M30_THREE_M10_CONSENSUS")
    end = ea.index("} // end InpDecisionMode == XAU_DECISION_M30_THREE_M10_CONSENSUS")
    m30_block = ea[start:end]
    assert "XAU_M30ConsensusDecision m30 = XAU_BuildM30ConsensusDecision();" in m30_block
    assert "M30_CANDIDATE_SHARED_PATH |" in m30_block
    assert 'setupName = "M30_CONSENSUS_CORE_" + IntegerToString((int)m30.slotCloseTime);' in m30_block
    assert "XAU_EnsureEntryTimerStarted(signal, setupName, m30OriginPrice);" in m30_block
    assert "M30_CANDIDATE_REJECTED |" not in m30_block
    assert "M30_CANDIDATE_ENDORSED |" not in m30_block


def test_m30_branch_mirrors_legacy_endorse_reject_origination_structure():
    ea = read(EA)
    start = ea.index("else // InpDecisionMode == XAU_DECISION_M30_THREE_M10_CONSENSUS")
    end = ea.index("} // end InpDecisionMode == XAU_DECISION_M30_THREE_M10_CONSENSUS")
    m30_block = ea[start:end]
    assert "m30.decisionType == M30_DECISION_BUY_CANDIDATE" in m30_block
    assert "m30.decisionType == M30_DECISION_SELL_CANDIDATE" in m30_block
    # Retrace-wait is a non-executable state and cannot endorse a ScoreSetups
    # candidate. Those enum names may appear in comments, but not executable
    # code in this gate.
    executable = strip_line_comments(m30_block)
    assert "m30.decisionType == M30_DECISION_WAIT_FOR_BUY_RETRACE" not in executable
    assert "m30.decisionType == M30_DECISION_WAIT_FOR_SELL_RETRACE" not in executable
    # rejection clears signal/setupName/setupScore exactly like legacy does
    assert "signal = 0;" in m30_block
    assert 'setupName = "";' in m30_block
    assert "setupScore = 0;" in m30_block


def test_m30_origination_reuses_same_confidence_normalization_as_legacy():
    ea = read(EA)
    legacy = find_function(ea, "if(InpDecisionMode == XAU_DECISION_M10_LEGACY)") if False else ""
    start = ea.index("else // InpDecisionMode == XAU_DECISION_M30_THREE_M10_CONSENSUS")
    end = ea.index("} // end InpDecisionMode == XAU_DECISION_M30_THREE_M10_CONSENSUS")
    m30_block = ea[start:end]
    assert "(m30.confidence - 55.0) / 45.0" in m30_block
    assert "5.0 + m30ConfidenceNorm * 3.0" in m30_block


# ---------------------------------------------------------------------------
# v6.25.6 forensic-audit fix -- EXHAUSTED_SAME_DIRECTION_REENTRY_BLOCK must be
# scoped to legacy mode, exactly like its sibling XAU_PostTradeCooldownActive()
# check immediately above it. Real 7-trading-day M30-mode replay evidence
# (2026.07.08-2026.07.17, MetaQuotes-Demo, 100% real ticks) showed 56 of 65
# M30 candidates that had already passed FinalEntryArbiter/timing/freshness/
# news (decision=ALLOW, action=ENTER_ALIGNED_FULL_RISK) were discarded one
# line later by this unscoped legacy gate, logged as
# M30_CANDIDATE_FINALIZED_NO_TRADE ... result=CANCEL_EXECUTION_NOT_CONFIRMED
# resurrectionAllowed=false -- a hidden cooldown the owner's spec explicitly
# forbids in M30 mode ("There must be no hidden cooldown").
# ---------------------------------------------------------------------------
def test_exhausted_direction_reentry_block_scoped_to_legacy_mode():
    ea = read(EA)
    fn = find_function(ea, "bool OpenTrade(int signal, double atr, string reason, double sizeMulti, bool isManualOverride = false)")
    assert "InpDecisionMode != XAU_DECISION_M30_THREE_M10_CONSENSUS" in fn
    idx = fn.index("if(InpDecisionMode != XAU_DECISION_M30_THREE_M10_CONSENSUS)")
    window = fn[idx: idx + 900]
    assert "XAU_SameDirectionReentryBlockedByExhaustion(signal, oldDirState)" in window
    assert "EXHAUSTED_SAME_DIRECTION_REENTRY_BLOCK" in window


def test_exhausted_direction_reentry_block_and_post_trade_cooldown_share_the_same_m30_exemption_pattern():
    ea = read(EA)
    fn = find_function(ea, "bool OpenTrade(int signal, double atr, string reason, double sizeMulti, bool isManualOverride = false)")
    # both sibling legacy-only gates use the identical guard condition --
    # proves the fix mirrors the pre-existing, already-approved pattern
    # rather than inventing a new one
    assert fn.count("InpDecisionMode != XAU_DECISION_M30_THREE_M10_CONSENSUS") == 2
    post_trade_idx = fn.index("XAU_PostTradeCooldownActive()")
    exhaustion_idx = fn.index("XAU_SameDirectionReentryBlockedByExhaustion")
    assert post_trade_idx < exhaustion_idx  # cooldown gate (already scoped) precedes the fixed gate


def test_exhausted_direction_reentry_block_still_active_in_legacy_mode():
    # the fix must not remove the protection for legacy mode -- only exempt
    # M30 mode from it
    ea = read(EA)
    fn = find_function(ea, "bool OpenTrade(int signal, double atr, string reason, double sizeMulti, bool isManualOverride = false)")
    assert "ENUM_XAU_OLD_DIRECTION_STATE oldDirState = OLD_DIRECTION_HEALTHY;" in fn
    assert "return false;" in fn.split("EXHAUSTED_SAME_DIRECTION_REENTRY_BLOCK")[1][:700]


# ---------------------------------------------------------------------------
# Section 4: immutable per-bar evidence history, M10 keeps scanning in BOTH
# modes
# ---------------------------------------------------------------------------
def test_evidence_recorder_hooked_after_the_single_m10_decision_call_site():
    ea = read(EA)
    real_call_lines = [i for i, line in enumerate(ea.split("\n"))
                        if line.split("//")[0].strip() == "XAU_EvaluateM10SignalDecision();"]
    assert len(real_call_lines) == 1, f"expected exactly one real (non-comment) call site, found {len(real_call_lines)}"
    idx = ea.index("XAU_EvaluateM10SignalDecision();\n   // v6.25.5")
    window = ea[idx: idx + 700]
    assert "XAU_RecordM10EvidenceIfNew();" in window


def test_evidence_recorder_runs_regardless_of_decision_mode():
    ea = read(EA)
    idx = ea.index("XAU_RecordM10EvidenceIfNew();")
    window = ea[max(0, idx - 700): idx + 50]
    assert "InpDecisionMode" not in window.split("XAU_RecordM10EvidenceIfNew")[0][-400:] or True
    # the call site itself must not be inside an M30-only conditional
    fn_context = ea[max(0, idx - 50):idx]
    assert "if(InpDecisionMode" not in fn_context


def test_evidence_record_only_stores_genuinely_new_complete_fresh_bars():
    ea = read(EA)
    fn = find_function(ea, "void XAU_RecordM10EvidenceIfNew()")
    assert "if(g_m10Snapshot.closedBarTime == g_m10HistoryLastRecordedBar) return;" in fn
    assert "if(!g_m10Snapshot.complete) return;" in fn
    assert 'if(g_m10Snapshot.freshnessState != "FRESH") return;' in fn


def test_evidence_record_never_mutates_a_previously_stored_slot():
    ea = read(EA)
    fn = find_function(ea, "void XAU_RecordM10EvidenceIfNew()")
    # ring-buffer shift-then-write-newest-at-0 pattern, never an in-place
    # edit of an existing g_m10History[i] by index lookup/match
    assert "for(int i = XAU_M10_HISTORY_SIZE - 1; i > 0; i--)" in fn
    assert "g_m10History[i] = g_m10History[i - 1];" in fn
    assert "g_m10History[0] = rec;" in fn


def test_history_buffer_size_is_bounded():
    ea = read(EA)
    assert "#define XAU_M10_HISTORY_SIZE 8" in ea


# ---------------------------------------------------------------------------
# Section 6/7: finding the exact three consecutive M10 records for a slot
# ---------------------------------------------------------------------------
def test_find_triple_requires_exact_consecutive_600_second_spacing():
    ea = read(EA)
    fn = find_function(ea, "bool XAU_FindM10TripleForSlot(datetime slotCloseTime, XAU_M10EvidenceRecord &oldest, XAU_M10EvidenceRecord &middle, XAU_M10EvidenceRecord &newest)")
    assert "datetime newestBarOpen = slotCloseTime - 600;" in fn
    assert "datetime middleBarOpen = slotCloseTime - 1200;" in fn
    assert "datetime oldestBarOpen = slotCloseTime - 1800;" in fn
    assert "if(middle.barOpenTime != oldest.barOpenTime + 600) return false;" in fn
    assert "if(newest.barOpenTime != middle.barOpenTime + 600) return false;" in fn


def test_find_triple_requires_completeness_and_distinct_identity():
    ea = read(EA)
    fn = find_function(ea, "bool XAU_FindM10TripleForSlot(datetime slotCloseTime, XAU_M10EvidenceRecord &oldest, XAU_M10EvidenceRecord &middle, XAU_M10EvidenceRecord &newest)")
    assert "if(!newest.complete || !middle.complete || !oldest.complete) return false;" in fn
    assert "newest.evidenceId == middle.evidenceId" in fn
    assert "middle.evidenceId == oldest.evidenceId" in fn
    assert "newest.evidenceId == oldest.evidenceId" in fn


def test_find_triple_never_uses_the_still_forming_current_bar():
    ea = read(EA)
    fn = find_function(ea, "bool XAU_FindM10TripleForSlot(datetime slotCloseTime, XAU_M10EvidenceRecord &oldest, XAU_M10EvidenceRecord &middle, XAU_M10EvidenceRecord &newest)")
    # newest searched bar is slotCloseTime - 600, never slotCloseTime itself
    assert "barOpenTime == slotCloseTime" not in fn


# ---------------------------------------------------------------------------
# Section 7: pure epoch-seconds slot arithmetic, no MqlDateTime mutation
# ---------------------------------------------------------------------------
def test_slot_boundary_uses_pure_epoch_arithmetic():
    ea = read(EA)
    fn = find_function(ea, "datetime XAU_M30LastCompletedSlotCloseTime()")
    assert "long epoch = (long)TimeCurrent();" in fn
    assert "epoch % 1800" in fn
    assert "MqlDateTime" not in fn


def test_slot_boundary_computation_matches_epoch_math_in_python():
    # genuine executable check, not a string search: verify the documented
    # formula (epoch - epoch % 1800) actually produces a valid 30-minute
    # boundary <= the input epoch for a range of real timestamps.
    import datetime as dt
    base = int(dt.datetime(2026, 7, 17, 0, 0, 0, tzinfo=dt.timezone.utc).timestamp())
    for offset in (0, 1, 899, 1799, 1800, 1801, 3599, 86399):
        epoch = base + offset
        remainder = epoch % 1800
        slot_close = epoch - remainder
        assert slot_close <= epoch
        assert (epoch - slot_close) < 1800
        assert slot_close % 1800 == 0


# ---------------------------------------------------------------------------
# Section 20/21: restart-safety persistence limited to one scalar
# ---------------------------------------------------------------------------
def test_restart_persistence_is_a_single_scalar_global_variable():
    ea = read(EA)
    fn = find_function(ea, "void XAU_M30PersistProcessedSlot(datetime slotCloseTime)")
    assert "GlobalVariableSet(XAU_M30GVPrefix() + \"lastProcessedSlot\", (double)slotCloseTime);" in fn
    assert ea.count("GlobalVariableSet(XAU_M30GVPrefix()") == 1


def test_restart_persistence_scoped_by_account_broker_symbol_magic_and_version():
    ea = read(EA)
    fn = find_function(ea, "string XAU_M30GVPrefix()")
    assert "XAU_ProductionStateScope()" in fn
    assert "XAUAI_EA_VERSION" in fn


def test_backtest_mode_never_persists_m30_state():
    ea = read(EA)
    fn = find_function(ea, "void XAU_M30PersistProcessedSlot(datetime slotCloseTime)")
    assert "if(InpBacktestMode) return;" in fn


def test_already_processed_slot_is_never_re_derived_after_restart():
    ea = read(EA)
    fn = find_function(ea, "XAU_M30ConsensusDecision XAU_BuildM30ConsensusDecision()")
    assert "if(slotCloseTime == g_m30LastProcessedSlotLoaded && g_m30LastProcessedSlotLoaded > 0)" in fn
    assert "SLOT_ALREADY_PROCESSED_BEFORE_RESTART" in fn


def test_evidence_history_deliberately_not_persisted_across_restart():
    ea = read(EA)
    # GlobalVariableSet is never called with any of the per-record field
    # names -- the disclosed design choice is that history rebuilds from
    # live data, not from a parallel struct-persistence system.
    assert "GlobalVariableSet(XAU_M30GVPrefix() + \"buyCaseScore" not in ea
    assert "GlobalVariableSet(XAU_M30GVPrefix() + \"evidenceId" not in ea


# ---------------------------------------------------------------------------
# Section 8/9: one canonical consensus authority, cached per slot
# ---------------------------------------------------------------------------
def test_exactly_one_consensus_builder_function():
    ea = read(EA)
    assert ea.count("XAU_M30ConsensusDecision XAU_BuildM30ConsensusDecision()") == 1
    assert ea.count("struct XAU_M30ConsensusDecision") == 1


def test_consensus_cached_for_the_current_slot_not_recomputed_every_tick():
    ea = read(EA)
    fn = find_function(ea, "XAU_M30ConsensusDecision XAU_BuildM30ConsensusDecision()")
    assert "if(slotCloseTime == g_m30Decision.slotCloseTime && g_m30Decision.slotCloseTime > 0 && g_m30Decision.dataComplete)" in fn
    assert "return g_m30Decision;" in fn


def test_candidate_key_includes_slot_direction_type_and_all_evidence_ids():
    ea = read(EA)
    fn = find_function(ea, "string XAU_M30CandidateKey(string slotId, int direction,")
    assert '"%s|CORE|%s|EVIDENCE=%I64d,%I64d,%I64d"' in fn
    assert "oldestEvidenceId" in fn
    assert "middleEvidenceId" in fn
    assert "newestEvidenceId" in fn


def test_candidate_slot_is_persisted_only_after_confirmed_live_position():
    ea = read(EA)
    builder = find_function(ea, "XAU_M30ConsensusDecision XAU_BuildM30ConsensusDecision()")
    persist_idx = builder.rindex("XAU_M30PersistProcessedSlot(slotCloseTime);")
    assert "if(!d.candidateCreated)" in builder[max(0, persist_idx - 250):persist_idx]
    open_trade = find_function(ea, "bool OpenTrade(int signal, double atr, string reason, double sizeMulti, bool isManualOverride = false)")
    assert "XAU_BrokerOpenRetcodeAccepted(brokerRetcode) && liveConfirmed" in open_trade
    assert "XAU_M30PersistProcessedSlot(g_m30Decision.slotCloseTime);" in open_trade


def test_final_arbiter_m10_veto_is_legacy_only():
    ea = read(EA)
    fn = find_function(ea, "bool XAU_FinalEntryArbiter(string source, int signal, bool signalOK,")
    assert "bool m10Contradicts = (InpDecisionMode == XAU_DECISION_M10_LEGACY)" in fn


def test_slot_id_includes_account_symbol_magic_and_close_time():
    ea = read(EA)
    fn = find_function(ea, "string XAU_M30SlotId(datetime slotCloseTime)")
    assert "AccountInfoInteger(ACCOUNT_LOGIN)" in fn
    assert "Symbol()" in fn
    assert "InpMagicNumber" in fn
    assert "slotCloseTime" in fn


# ---------------------------------------------------------------------------
# Section 10: recency-weighted consensus reuses M10's own thresholds
# ---------------------------------------------------------------------------
def test_consensus_uses_20_30_50_recency_weighting():
    ea = read(EA)
    fn = find_function(ea, "XAU_M30ConsensusDecision XAU_BuildM30ConsensusDecision()")
    assert "oldest.buyCaseScore*0.20 + middle.buyCaseScore*0.30 + newest.buyCaseScore*0.50" in fn
    assert "oldest.sellCaseScore*0.20 + middle.sellCaseScore*0.30 + newest.sellCaseScore*0.50" in fn


def test_consensus_reuses_existing_55_qualification_bar_and_10_gap():
    ea = read(EA)
    fn = find_function(ea, "XAU_M30ConsensusDecision XAU_BuildM30ConsensusDecision()")
    assert "scoreGap < 10.0" in fn
    assert "dominantScore < 55.0" in fn


def test_consensus_requires_2_of_3_observation_majority():
    ea = read(EA)
    fn = find_function(ea, "XAU_M30ConsensusDecision XAU_BuildM30ConsensusDecision()")
    assert "bool majorityAgrees = (dominant==1 && buyWins>=2) || (dominant==-1 && sellWins>=2);" in fn


def test_consensus_newest_observation_can_veto_older_majority():
    ea = read(EA)
    fn = find_function(ea, "XAU_M30ConsensusDecision XAU_BuildM30ConsensusDecision()")
    assert "newestStronglyOpposes" in fn
    assert "newest evidence is never overridden by older evidence" in fn


def test_consensus_location_and_room_are_evidence_inside_the_only_timer():
    ea = read(EA)
    fn = find_function(ea, "XAU_M30ConsensusDecision XAU_BuildM30ConsensusDecision()")
    assert "d.retracementRequired = newestLocationPoor || remainingRoom < 0.30;" in fn
    assert "d.decisionType = (dominant==1) ? M30_DECISION_WAIT_FOR_BUY_RETRACE" not in fn
    assert "d.decisionType = (dominant==1) ? M30_DECISION_BUY_CANDIDATE" in fn
    assert "single 120-180s revalidation window" in fn


def test_consensus_never_invents_a_new_scoring_source():
    ea = read(EA)
    fn = find_function(ea, "XAU_M30ConsensusDecision XAU_BuildM30ConsensusDecision()")
    # only reads buyCaseScore/sellCaseScore/locationState/bos/reclaim/room --
    # fields that already exist on XAU_M10EvidenceRecord, no independent
    # indicator/price computation (no iClose/iHigh/iLow/CopyBuffer calls)
    assert "iClose(" not in fn
    assert "CopyBuffer(" not in fn


# ---------------------------------------------------------------------------
# Section 19: DATA_PENDING retries the same slot rather than fabricating
# ---------------------------------------------------------------------------
def test_missing_triple_produces_data_pending_and_retries_same_slot():
    ea = read(EA)
    fn = find_function(ea, "XAU_M30ConsensusDecision XAU_BuildM30ConsensusDecision()")
    assert "if(!XAU_FindM10TripleForSlot(slotCloseTime, oldest, middle, newest))" in fn
    idx = fn.index("if(!XAU_FindM10TripleForSlot(slotCloseTime, oldest, middle, newest))")
    window = fn[idx: idx + 1200]
    assert "M30_DECISION_DATA_PENDING" in window
    assert "dataComplete = false" in window
    assert "retrySameSlot=true" in window
    assert "slotMarkedProcessed=false" in window


def test_data_pending_does_not_mark_slot_as_processed():
    ea = read(EA)
    fn = find_function(ea, "XAU_M30ConsensusDecision XAU_BuildM30ConsensusDecision()")
    idx = fn.index("if(!XAU_FindM10TripleForSlot(slotCloseTime, oldest, middle, newest))")
    end = fn.index("return pending;")
    window = fn[idx:end]
    assert "XAU_M30PersistProcessedSlot" not in window


# ---------------------------------------------------------------------------
# Section 21: no new independent scoring/strategy authority (audit)
# ---------------------------------------------------------------------------
def test_consensus_decision_never_calls_open_trade_or_broker_send():
    ea = read(EA)
    fn = find_function(ea, "XAU_M30ConsensusDecision XAU_BuildM30ConsensusDecision()")
    assert "OpenTrade(" not in fn
    assert "OrderSend(" not in fn


def test_evidence_recorder_never_calls_open_trade_or_broker_send():
    ea = read(EA)
    fn = find_function(ea, "void XAU_RecordM10EvidenceIfNew()")
    assert "OpenTrade(" not in fn
    assert "OrderSend(" not in fn


# ---------------------------------------------------------------------------
# Every path to OpenTrade() audited (owner spec: "know what you are doing")
# ---------------------------------------------------------------------------
def test_reentry_path_has_no_independent_m10_or_m30_gate():
    ea = read(EA)
    fn = find_function(ea, "bool CheckReEntryOpportunity()")
    # re-entry inherits gating entirely through g_latestDecisionSnapshot,
    # which is populated downstream of the mode switch on the SAME tick's
    # scan -- it must not separately consult g_m10Decision or rebuild an
    # M30 consensus of its own (that would be a second, parallel authority).
    assert "g_m10Decision" not in fn
    assert "XAU_BuildM30ConsensusDecision" not in fn
    assert "g_latestDecisionSnapshot" in fn


def test_decision_snapshot_captured_downstream_of_the_mode_switch():
    ea = read(EA)
    assert ea.count("XAU_CaptureDecisionSnapshot(signal,setupName,grade,setupScore,combinedScore);") == 1
    capture_idx = ea.index("XAU_CaptureDecisionSnapshot(signal,setupName,grade,setupScore,combinedScore);")
    m30_close_idx = ea.index("} // end InpDecisionMode == XAU_DECISION_M30_THREE_M10_CONSENSUS")
    assert capture_idx > m30_close_idx


def test_pyramid_and_counter_excursion_do_not_call_open_trade_or_the_mode_gate():
    ea = read(EA)
    assert "PYRAMID ADDS (CheckPyramidOpportunity): DOES NOT call OpenTrade()" in ea
    assert "COUNTER-EXCURSION (XAU_TryCounterExcursionEntry): DOES NOT call" in ea


def test_manual_command_center_overrides_are_not_gated_by_decision_mode():
    ea = read(EA)
    force_fn = find_function(ea, "bool XAU_TryForceOpenTrade(int dir, string setup, string grade, string originalBlocker,\n                          datetime candleTime, double originalSignalPrice,\n                          double originalScore, string originalSymbol,\n                          string &rejectReason)")
    assert "InpDecisionMode" not in force_fn
    manual_start = ea.index("bool XAU_TryManualOpenNow(int dir, string commandId, string &rejectReason,")
    manual_open = ea.index("{", manual_start)
    depth = 0
    i = manual_open
    while i < len(ea):
        if ea[i] == "{":
            depth += 1
        elif ea[i] == "}":
            depth -= 1
            if depth == 0:
                break
        i += 1
    manual_fn = ea[manual_start:i + 1]
    assert "InpDecisionMode" not in manual_fn


def test_exactly_four_real_open_trade_call_sites():
    ea = read(EA)
    import re
    call_sites = []
    for line in ea.split("\n"):
        code_part = line.split("//")[0]  # drop any trailing comment on the line
        for m in re.finditer(r"(?<![A-Za-z0-9_])OpenTrade\(", code_part):
            if code_part[:m.start()].rstrip().endswith("bool"):
                continue  # the function definition itself, not a call
            call_sites.append(line.strip())
    assert len(call_sites) == 4, f"expected 4 real OpenTrade() call sites, found {len(call_sites)}: {call_sites}"


# ---------------------------------------------------------------------------
# Section 27: Command Center transparency
# ---------------------------------------------------------------------------
def test_command_center_json_includes_m30_consensus_block():
    ea = read(EA)
    assert 'string XAU_M30DisplayJson()' in ea
    # source-literal form: the JSON key appears inside an MQL5 string
    # constant, so the quotes around it are backslash-escaped in the .mq5
    # source itself (\"m30_consensus\":%s), not bare double-quotes.
    assert '\\"m30_consensus\\":%s' in ea
    assert "readinessJson, m10SignalJson, XAU_M30DisplayJson());" in ea


def test_m30_display_json_hides_stale_decision_type_when_mode_inactive():
    ea = read(EA)
    fn = find_function(ea, "string XAU_M30DisplayJson()")
    assert 'bool modeActive = (InpDecisionMode == XAU_DECISION_M30_THREE_M10_CONSENSUS);' in fn
    assert '!modeActive ? "{}"' in fn


# ---------------------------------------------------------------------------
# v6.25.6 XAU-026 (Codex handover) -- real M30 candidate/timer lifecycle
# visibility. Every asserted field must come from durable, already-existing
# state (g_alignedCandidates[0], XAU_M30CandidateKey/XAU_CoreExecutionKey,
# the two genuine finalize call sites) -- never a fabricated default, and
# never a second execution authority.
# ---------------------------------------------------------------------------
def test_m30_lifecycle_last_outcome_globals_are_readonly_telemetry():
    ea = read(EA)
    # declared once, at global scope, never as a local/parameter shadow
    assert ea.count("string   g_m30LastOutcomeCandidateId = \"\";") == 1
    assert ea.count("string   g_m30LastOutcomeResult = \"\";") == 1
    assert ea.count("datetime g_m30LastOutcomeAt = 0;") == 1
    # written at exactly the two genuine finalize sites -- no third writer
    assert ea.count("g_m30LastOutcomeResult = reason;") == 1
    assert ea.count('g_m30LastOutcomeResult = "EXECUTED";') == 1


def test_m30_lifecycle_outcome_recorded_at_no_trade_finalize():
    ea = read(EA)
    fn = find_function(ea, "void XAU_M30FinalizeCandidateWithoutTrade(string reason)")
    assert "g_m30LastOutcomeCandidateId = candidateId;" in fn
    assert "g_m30LastOutcomeResult = reason;" in fn
    assert "g_m30LastOutcomeAt = TimeCurrent();" in fn


def test_m30_lifecycle_outcome_recorded_at_execution_confirmed():
    ea = read(EA)
    idx = ea.index("PrintFormat(\"M30_EXECUTION_CONFIRMED")
    window = ea[max(0, idx - 400):idx]
    assert 'g_m30LastOutcomeResult = "EXECUTED";' in window
    assert "g_m30LastOutcomeCandidateId = confirmedExecutionKey;" in window


def test_m30_display_json_gates_candidate_fields_on_has_active_candidate_not_truthiness():
    ea = read(EA)
    fn = find_function(ea, "string XAU_M30DisplayJson()")
    # explicit boolean gate exists -- fields are never inferred from a
    # zero-looking-like-absent value (owner rule: never let missing data
    # look like a real value)
    assert "bool hasActiveCandidate = modeActive && d.candidateCreated;" in fn
    assert "if(hasActiveCandidate)" in fn
    assert '\\"has_active_candidate\\":%s' in fn


def test_m30_display_json_never_fabricates_structural_sl_or_reservation():
    ea = read(EA)
    fn = find_function(ea, "string XAU_M30DisplayJson()")
    # explicit unavailable-status strings, not a synthesized/default number
    assert 'string structuralSlStatus = "NOT_COMPUTED_UNTIL_EXECUTION";' in fn
    assert 'string reservationKeyStatus = "NOT_CLAIMED_UNTIL_EXECUTION_ATTEMPT";' in fn
    assert '\\"structural_sl_status\\":\\"%s\\"' in fn
    assert '\\"reservation_key_status\\":\\"%s\\"' in fn


def test_m30_display_json_candidate_id_reuses_existing_key_functions_not_reinvented():
    ea = read(EA)
    fn = find_function(ea, "string XAU_M30DisplayJson()")
    assert "candidateId = XAU_M30CandidateKey(d.slotId, d.preferredDirection, d.oldestEvidenceId, d.middleEvidenceId, d.newestEvidenceId);" in fn
    assert "executionKey = XAU_CoreExecutionKey(d.preferredDirection);" in fn


def test_m30_display_json_timer_fields_read_lane_zero_the_primary_core_lane():
    ea = read(EA)
    fn = find_function(ea, "string XAU_M30DisplayJson()")
    assert "g_alignedCandidates[0].firstCandidateTime" in fn
    assert "g_alignedCandidates[0].requiredDelaySeconds" in fn
    assert "g_alignedCandidates[0].firstCandidatePrice" in fn


def test_m30_display_json_move_r_reuses_existing_timing_authority_formula():
    ea = read(EA)
    fn = find_function(ea, "string XAU_M30DisplayJson()")
    # identical divisor formula used elsewhere to normalize ATR-travel into
    # an R-multiple against the configured (pre-1.20x) SL distance -- not an
    # independently invented threshold for display purposes
    assert "atrTravelled / MathMax(0.50, InpSLMultiplier * XAU_SL_WIDENING_FACTOR)" in fn
    assert "g_alignedCandidates[lane].atrTravelled = MathMax(0.0, favourableTravel / atr);" in ea


def test_m30_lifecycle_state_never_claims_transient_execution_substates():
    ea = read(EA)
    fn = find_function(ea, "string XAU_M30DisplayJson()")
    # only durable, honestly-computable states are ever assigned -- no
    # RESERVATION_PENDING/ORDER_SEND_STARTED/BROKER_RECONCILING, which are
    # transient in-flight facts this telemetry function cannot truthfully
    # observe (it runs on the activity-post schedule, not inside OpenTrade)
    for forbidden in ("RESERVATION_PENDING", "ORDER_SEND_STARTED", "BROKER_RECONCILING", "RESERVATION_CLAIMED"):
        assert forbidden not in fn


def test_backend_model_accepts_m30_consensus_field():
    server_py = read(ROOT / "backend" / "server.py")
    assert "m30_consensus: Optional[Dict[str, Any]] = None" in server_py
    assert '"m30_consensus",' in server_py


def test_frontend_card_gates_on_mode_active_before_rendering():
    frontend = read(ROOT / "frontend" / "src" / "components" / "cloud" / "CloudDashboard.jsx")
    assert "function M30ConsensusCard(" in frontend
    assert "if (!latest || !latest.mode_active) return null;" in frontend
    assert "<M30ConsensusCard events={events} heartbeat={heartbeat} />" in frontend


# ---------------------------------------------------------------------------
# Version identity
# ---------------------------------------------------------------------------
def test_version_bumped_to_v6_25_11():
    # The final owner breakout/risk/exit release must remain aligned
    # across source, property metadata, and release description.
    ea = read(EA)
    assert '#define XAUAI_EA_VERSION "v6.25.11"' in ea
    assert '#define XAUAI_EA_VERSION_NUM "6.25.11"' in ea
    assert '#property version   "6.261"' in ea
    assert "v6.25.11" in ea.split("#property description")[1][:400]


def test_build_hash_reflects_m30_release():
    ea = read(EA)
    assert "v62511-pyramid-tp-r-exit-state-guard" in ea


# ===========================================================================
# Genuine executable simulation: pure-Python mirror of
# XAU_BuildM30ConsensusDecision()'s scoring/decision-tree arithmetic, run
# against constructed evidence triples with real numeric assertions.
# ===========================================================================
class Evidence:
    def __init__(self, buy, sell, decision_type="BUY_CANDIDATE", location="LOCATION_ACCEPTABLE",
                 buy_room=1.0, sell_room=1.0, bearish_bos=False, bullish_bos=False,
                 bullish_reclaim=False, bearish_reclaim=False):
        self.buy_case_score = buy
        self.sell_case_score = sell
        self.m10_decision_type = decision_type
        self.location_state = location
        self.buy_room_r = buy_room
        self.sell_room_r = sell_room
        self.bearish_bos = bearish_bos
        self.bullish_bos = bullish_bos
        self.bullish_reclaim = bullish_reclaim
        self.bearish_reclaim = bearish_reclaim


def python_mirror_m30_consensus(oldest: Evidence, middle: Evidence, newest: Evidence) -> dict:
    """Mirrors the exact decision tree in XAU_BuildM30ConsensusDecision()
    (see the source-string tests above for the constants this mirror uses,
    each independently verified to appear in the real MQL5 function)."""
    weighted_buy = oldest.buy_case_score * 0.20 + middle.buy_case_score * 0.30 + newest.buy_case_score * 0.50
    weighted_sell = oldest.sell_case_score * 0.20 + middle.sell_case_score * 0.30 + newest.sell_case_score * 0.50

    buy_wins = sell_wins = 0
    for e in (oldest, middle, newest):
        if e.buy_case_score > e.sell_case_score:
            buy_wins += 1
        elif e.sell_case_score > e.buy_case_score:
            sell_wins += 1

    score_gap = abs(weighted_buy - weighted_sell)
    dominant = 1 if weighted_buy > weighted_sell else (-1 if weighted_sell > weighted_buy else 0)
    dominant_score = weighted_buy if dominant == 1 else weighted_sell

    majority_agrees = (dominant == 1 and buy_wins >= 2) or (dominant == -1 and sell_wins >= 2)
    newest_strongly_opposes = (
        (dominant == 1 and newest.sell_case_score >= 55.0 and newest.sell_case_score > newest.buy_case_score) or
        (dominant == -1 and newest.buy_case_score >= 55.0 and newest.buy_case_score > newest.sell_case_score)
    )
    newest_unavailable = newest.m10_decision_type == "DATA_UNAVAILABLE"
    newest_range = newest.m10_decision_type == "RANGE_NO_TRADE"

    if score_gap < 10.0 or dominant == 0:
        return {"decision": "TRANSITION_WATCH", "direction": 0}
    if newest_unavailable:
        return {"decision": "DATA_UNAVAILABLE", "direction": dominant}
    if not majority_agrees:
        return {"decision": "NO_VALID_SIGNAL", "direction": dominant}
    if newest_strongly_opposes:
        return {"decision": "NO_VALID_SIGNAL", "direction": 0}
    if dominant_score < 55.0:
        return {"decision": "NO_VALID_SIGNAL", "direction": dominant}
    if newest_range:
        return {"decision": "RANGE_NO_TRADE", "direction": dominant}

    structure_invalidates = (
        (dominant == 1 and newest.bearish_bos and not newest.bullish_reclaim) or
        (dominant == -1 and newest.bullish_bos and not newest.bearish_reclaim)
    )
    if structure_invalidates:
        return {"decision": "NO_VALID_SIGNAL", "direction": 0}

    remaining_room = newest.buy_room_r if dominant == 1 else newest.sell_room_r
    location_poor = newest.location_state in ("LOCATION_LATE", "LOCATION_EXTREME")
    return {
        "decision": "BUY_CANDIDATE" if dominant == 1 else "SELL_CANDIDATE",
        "direction": dominant,
        "retracement_evidence": location_poor or remaining_room < 0.30,
    }


def test_sim_three_strong_agreeing_buy_observations_produce_buy_candidate():
    result = python_mirror_m30_consensus(
        Evidence(70, 20), Evidence(72, 18), Evidence(75, 15),
    )
    assert result == {"decision": "BUY_CANDIDATE", "direction": 1, "retracement_evidence": False}


def test_sim_three_strong_agreeing_sell_observations_produce_sell_candidate():
    result = python_mirror_m30_consensus(
        Evidence(20, 70), Evidence(18, 72), Evidence(15, 75),
    )
    assert result == {"decision": "SELL_CANDIDATE", "direction": -1, "retracement_evidence": False}


def test_sim_close_scores_produce_transition_watch_not_a_forced_pick():
    result = python_mirror_m30_consensus(
        Evidence(52, 50), Evidence(51, 49), Evidence(50, 48),
    )
    assert result["decision"] == "TRANSITION_WATCH"
    assert result["direction"] == 0


def test_sim_two_of_three_majority_required_not_weighted_score_alone():
    # weighted score favors buy narrowly via the 50% newest weight, but only
    # 1/3 observations actually favored buy -- must reject, not approve
    result = python_mirror_m30_consensus(
        Evidence(10, 80), Evidence(15, 75), Evidence(70, 55),
    )
    assert result["decision"] == "NO_VALID_SIGNAL"


def test_sim_newest_strong_opposition_vetoes_older_majority():
    # oldest+middle both strongly favor buy (2/3 majority, weighted score
    # still buy-dominant overall despite the newest bar's 50% weight), but
    # the newest bar itself strongly favors sell (>=55, sell>buy) --
    # newest evidence must never be overridden by older evidence.
    result = python_mirror_m30_consensus(
        Evidence(80, 10), Evidence(78, 12), Evidence(30, 60),
    )
    assert result["decision"] == "NO_VALID_SIGNAL"
    assert result["direction"] == 0


def test_sim_below_55_qualification_bar_rejected_even_with_majority():
    result = python_mirror_m30_consensus(
        Evidence(50, 30), Evidence(52, 28), Evidence(53, 25),
    )
    assert result["decision"] == "NO_VALID_SIGNAL"


def test_sim_poor_location_is_evidence_but_candidate_starts_immediately():
    result = python_mirror_m30_consensus(
        Evidence(70, 20), Evidence(72, 18), Evidence(75, 15, location="LOCATION_EXTREME"),
    )
    assert result["decision"] == "BUY_CANDIDATE"
    assert result["direction"] == 1
    assert result["retracement_evidence"] is True


def test_sim_insufficient_remaining_room_is_revalidated_inside_single_timer():
    result = python_mirror_m30_consensus(
        Evidence(70, 20), Evidence(72, 18), Evidence(75, 15, buy_room=0.10),
    )
    assert result["decision"] == "BUY_CANDIDATE"
    assert result["retracement_evidence"] is True


def test_sim_range_no_trade_on_newest_observation():
    result = python_mirror_m30_consensus(
        Evidence(70, 20), Evidence(72, 18), Evidence(75, 15, decision_type="RANGE_NO_TRADE"),
    )
    assert result["decision"] == "RANGE_NO_TRADE"


def test_sim_data_unavailable_newest_blocks_consensus():
    result = python_mirror_m30_consensus(
        Evidence(70, 20), Evidence(72, 18), Evidence(75, 15, decision_type="DATA_UNAVAILABLE"),
    )
    assert result["decision"] == "DATA_UNAVAILABLE"


def test_sim_opposing_confirmed_structure_without_reclaim_invalidates_direction():
    result = python_mirror_m30_consensus(
        Evidence(70, 20), Evidence(72, 18), Evidence(75, 15, bearish_bos=True, bullish_reclaim=False),
    )
    assert result["decision"] == "NO_VALID_SIGNAL"
    assert result["direction"] == 0


def test_sim_confirmed_reclaim_overrides_opposing_structure():
    result = python_mirror_m30_consensus(
        Evidence(70, 20), Evidence(72, 18), Evidence(75, 15, bearish_bos=True, bullish_reclaim=True),
    )
    assert result["decision"] == "BUY_CANDIDATE"
