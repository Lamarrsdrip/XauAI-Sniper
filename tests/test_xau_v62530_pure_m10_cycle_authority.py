from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA_PATH = ROOT / "XAUUSD_AI_Sniper_EA.mq5"
BACKEND_PATH = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def source() -> str:
    return EA_PATH.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def function_body(text: str, signature: str) -> str:
    start = text.index(signature)
    brace = text.index("{", start)
    depth = 0
    for index in range(brace, len(text)):
        if text[index] == "{":
            depth += 1
        elif text[index] == "}":
            depth -= 1
            if depth == 0:
                return text[start : index + 1]
    raise AssertionError(f"unbalanced function: {signature}")


def test_authoritative_sources_are_identical_and_primary_tf_is_m10():
    text = source()
    assert EA_PATH.read_bytes() == BACKEND_PATH.read_bytes()
    assert "#define XAU_PRIMARY_DECISION_TF PERIOD_M10" in text
    assert "#define XAU_PRIMARY_DECISION_TF_SECONDS 600" in text
    assert 'signalTF=M10' in text


def test_matching_transition_watch_preserves_existing_setup_as_candidate():
    text = source()
    on_tick = function_body(text, "void OnTick()")
    predicate = on_tick[on_tick.index("bool directionAlignedTransitionContext=") :]
    predicate = predicate[: predicate.index("if(!resumeFrozenPrimaryCandidate && signal != 0)")]
    assert "g_m10Decision.decisionType==M10_DECISION_TRANSITION_WATCH" in predicate
    assert "g_m10Decision.preferredDirection==signal" in predicate
    assert "g_m10Decision.confidence>=55.0" in predicate
    assert "g_m10Snapshot.complete" in predicate
    assert 'g_m10Snapshot.freshnessState=="FRESH"' in predicate
    endorsement_start = on_tick.index("bool m10Endorses =")
    endorsement_end = on_tick.index("// v6.25.2 owner directive", endorsement_start)
    endorsement = on_tick[endorsement_start:endorsement_end]
    assert "directionAlignedTransitionContext" in endorsement
    assert "M10_CANDIDATE_ENDORSED" in endorsement


def test_transition_protection_is_downstream_normal_gate_not_creation_veto():
    text = source()
    on_tick = function_body(text, "void OnTick()")
    endorsed = on_tick.index("M10_CANDIDATE_ENDORSED")
    classified = on_tick.index("XAU_CaptureDecisionSnapshot", endorsed)
    permanent_owner_gate = on_tick.index('XAU_OwnerEntryPermission("CANDIDATE_ACCEPTANCE"')
    transition_gate = on_tick.index("M10_TRANSITION_NORMAL_GATE")
    assert endorsed < classified < permanent_owner_gate < transition_gate
    gate = on_tick[transition_gate - 900 : transition_gate + 1800]
    assert "candidateCreated=true" in gate
    assert "NORMAL_GATE_TRANSITION_CONFIRMATION_PENDING" in gate
    assert "timerStarted=false" in gate
    assert "orderSendReached=false" in gate
    assert "XAU_RecordExactPrimaryOutcome" in gate


def test_restart_ledger_persists_only_terminal_closed_m10_cycles():
    text = source()
    persist = function_body(text, "void XAU_PersistCompletedM10Cycle(")
    mark = function_body(text, "void XAU_MarkM10TerminalDecision(")
    reconcile = function_body(text, "void XAU_ReconcilePureM10CycleStateOnInit()")
    assert "MQL_TESTER" in persist
    assert 'GlobalVariableSet(p+"lastClosedBar"' in persist
    assert 'GlobalVariableSet(p+"terminalState"' in persist
    assert "XAU_PersistCompletedM10Cycle(closedBar,state);" in mark
    assert "persisted==latestClosed" in reconcile
    assert "duplicateSuppressed=true" in reconcile
    assert "latestBarWillRun=true" in reconcile
    assert "retroactiveOrderSend=false" in reconcile
    assert "SESSION_BOUNDARY_GAP_NOT_ENUMERATED" in reconcile


def test_runtime_gap_ledger_enumerates_only_real_broker_m10_bars():
    text = source()
    gap = function_body(text, "void XAU_LogRuntimePureM10Gap(")
    assert "CopyRates(Symbol(),XAU_PRIMARY_DECISION_TF" in gap
    assert "MqlRates brokerBars[];" in gap
    assert "if(brokerBars[i].tick_volume<=0) continue;" in gap
    assert "datetime closeTime=brokerBars[i].time;" in gap
    assert "SymbolInfoSessionTrade(Symbol()," in gap
    assert "if(!insideBrokerSession) continue;" in gap
    assert "PURE_M10_SESSION_REOPEN" in gap
    assert "perBarGapEnumeration=UNSAFE_ACROSS_SESSION_BOUNDARY" in gap
    assert "reason=WEEKEND_REOPEN" in gap
    assert "for(datetime closeTime=" not in gap
    assert "missedBrokerM10Closes" in gap
    assert "if(missed>0)" in gap


def test_copybuffer_and_cycle_telemetry_identify_closed_shift_one():
    text = source()
    assert "M10_SNAPSHOT_READY" in text
    assert "allRequiredIndicators=COMPLETE | closedShift=%d | immutable=true" in text
    assert "PURE_M10_STARTUP_HEALTH" in text
    assert "PRIMARY_ORDER_SEND_RESULT" in text
    assert "brokerRetcode=%u" in text


def test_transition_persistence_is_stale_safe_and_tester_isolated():
    text = source()
    load = function_body(text, "void XAU_ATLoadPersistentState()")
    save = function_body(text, "void XAU_ATSavePersistentState()")
    assert "MQL_TESTER" in load
    assert "MQL_TESTER" in save
    assert "stateAt" in load
    assert "STALE_STATE_CLEARED" in load
    assert "weekendReopenSafe=true" in load
