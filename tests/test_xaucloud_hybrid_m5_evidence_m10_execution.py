from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA.mq5"


def source() -> str:
    return EA.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


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


def test_hybrid_identity_and_required_audit_events():
    text = source()
    assert (
        '#define XAUAI_EA_VERSION '
        '"XauCloud-m10_v6.25.31"' in text
    )
    for event in (
        "HYBRID_M5_SCAN_1",
        "HYBRID_M5_SCAN_2_M10_DECISION",
        "HYBRID_EVIDENCE_COMPARE",
        "HYBRID_CANDIDATE_CREATED",
        "HYBRID_CANDIDATE_REJECTED",
        "HYBRID_PERMANENT_BLOCK",
        "HYBRID_NO_VALID_CANDIDATE",
        "HYBRID_SCAN_1_MISSED_FALLBACK",
        "HYBRID_M5_FUNNEL_SUMMARY",
    ):
        assert event in text


def test_scan_one_is_observation_only():
    text = source()
    body = function_body(text, "void XAU_HybridM5ObservePhaseOne(")
    assert "orderAuthority=false" in body
    for forbidden in ("OpenTrade(", "trade.Buy(", "trade.Sell(", "OrderSend("):
        assert forbidden not in body


def test_second_scan_requires_exact_fresh_sequential_pair_and_consumes_it():
    text = source()
    compare = function_body(text, "bool XAU_HybridM5Classify(")
    finalize = function_body(text, "void XAU_HybridM5FinalizeAtM10Boundary(")
    assert "scan2.barTime-scan1.barTime!=300" in compare
    assert "closedM5==closedM10Bar+300" in finalize
    assert "g_hybridM5Cycle.scan1.barTime==closedM10Bar" in finalize
    assert "g_hybridM5Cycle.consumed=true;" in finalize
    assert "HYBRID_SCAN_1_MISSED_FALLBACK" in finalize


def test_r2_close_call_is_narrow_and_still_m10_anchored():
    text = source()
    body = function_body(text, "void XAU_HybridM5FinalizeAtM10Boundary(")
    for required in (
        "g_m10Decision.decisionType==M10_DECISION_TRANSITION_WATCH",
        "g_m10Decision.preferredDirection==0",
        "MathAbs(g_m10Decision.buyCaseScore-g_m10Decision.sellCaseScore)<10.0",
        "proposedM10SideScore>=50.0",
        "proposedConfidence>=62.0",
        'g_hybridM5Cycle.scan2.locationState=="GOOD"',
        'g_hybridM5Cycle.scan2.locationState=="ACCEPTABLE"',
    ):
        assert required in body


def test_hybrid_injects_one_candidate_into_shared_production_pipeline():
    text = source()
    finalize = function_body(text, "void XAU_HybridM5FinalizeAtM10Boundary(")
    entry = function_body(text, "void OnTick()")
    assert "OpenTrade(" not in finalize
    assert "OrderSend(" not in finalize
    assert "XAU_HybridM5FinalizeAtM10Boundary(" in entry
    assert "signal==0" in entry
    assert "g_hybridM5Cycle.finalCandidateCreated" in entry
    assert "HYBRID_M5_" in entry


def test_owner_permanent_blocks_and_final_assertion_remain_present():
    text = source()
    for reason in (
        "PERM_BLOCK_ASIA_NON_A_PLUS",
        "PERM_BLOCK_A_PLUS_RESET_PENDING",
        "PERM_BLOCK_GRADE_B_REVERSAL",
        "PERM_BLOCK_RESET_PENDING_GRADE_B",
    ):
        assert reason in text
    assert text.count("XAU_PermanentM10CategoryFinalAssertion(") == 4
    assert 'XAU_OwnerEntryPermission("CANDIDATE_ACCEPTANCE"' in text
    assert 'XAU_OwnerEntryPermission("FINAL_EXECUTION"' in text


def test_existing_timing_risk_and_exit_controls_are_unchanged():
    text = source()
    assert "input double InpStopLossGoldMove = 10.0;" in text
    assert "g_rExit[idx].extensionDeadline = triggerTime + 600;" in text
    assert "InpExtensionFloor015REnabled" in text
    assert "InpExtension70PctRatchetEnabled" in text
    assert "InpM5EntryDelayMinSeconds      = 120;" in text
    assert "InpM5EntryDelayMaxSeconds      = 180;" in text
    assert "XAU_EffectiveEntryDelaySeconds()" in text


def test_command_center_reports_both_hybrid_timeframes():
    text = source()
    server = (ROOT / "backend" / "server.py").read_text(
        encoding="utf-8", errors="ignore"
    )
    dashboard = (
        ROOT / "frontend" / "src" / "components" / "cloud" / "CloudDashboard.jsx"
    ).read_text(encoding="utf-8", errors="ignore")
    assert '\\"timeframe\\":\\"M10\\"' in text
    assert '\\"decision_timeframe\\":\\"M10\\"' in text
    assert '\\"evidence_timeframe\\":\\"M5\\"' in text
    assert '\\"hybrid_mode\\":true' in text
    assert "BotMonitorJsonSafe(XAUAI_EA_VERSION, 64)" in text
    assert "decision_timeframe: Optional[str]" in server
    assert "evidence_timeframe: Optional[str]" in server
    assert 'marker = raw.lower().rfind("_v")' in server
    assert "M5 evidence →" in dashboard
