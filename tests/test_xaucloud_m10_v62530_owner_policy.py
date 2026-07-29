from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


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


def blocked(grade: str, session: str, location: str, reversal: bool = False):
    grade = grade.strip().upper()
    session = session.strip().upper()
    if session == "ASIA" and grade != "A+":
        return "PERM_BLOCK_ASIA_NON_A_PLUS"
    if grade == "A+" and location == "LOCATION_RESET_PENDING":
        return "PERM_BLOCK_A_PLUS_RESET_PENDING"
    if grade != "B":
        return None
    if reversal:
        return "PERM_BLOCK_GRADE_B_REVERSAL"
    if location == "LOCATION_RESET_PENDING":
        return "PERM_BLOCK_RESET_PENDING_GRADE_B"
    return None


def test_owner_required_allow_block_matrix():
    assert blocked("A", "ASIA", "LOCATION_GOOD") == "PERM_BLOCK_ASIA_NON_A_PLUS"
    assert blocked("B", "ASIA", "LOCATION_GOOD") == "PERM_BLOCK_ASIA_NON_A_PLUS"
    assert blocked("A+", "ASIA", "LOCATION_GOOD") is None
    assert (
        blocked("A+", "ASIA", "LOCATION_RESET_PENDING")
        == "PERM_BLOCK_A_PLUS_RESET_PENDING"
    )
    assert (
        blocked("A+", "LONDON", "LOCATION_RESET_PENDING")
        == "PERM_BLOCK_A_PLUS_RESET_PENDING"
    )
    assert (
        blocked("A+", "NEW_YORK", "LOCATION_RESET_PENDING")
        == "PERM_BLOCK_A_PLUS_RESET_PENDING"
    )
    assert (
        blocked("B", "LONDON", "LOCATION_GOOD", reversal=True)
        == "PERM_BLOCK_GRADE_B_REVERSAL"
    )
    assert (
        blocked("B", "LONDON", "LOCATION_RESET_PENDING")
        == "PERM_BLOCK_RESET_PENDING_GRADE_B"
    )
    assert blocked("A", "LONDON", "LOCATION_GOOD") is None
    assert blocked("A+", "NEW_YORK", "LOCATION_GOOD") is None


def test_production_identity_and_source_mirror():
    text = source()
    assert '#define XAUAI_EA_VERSION "XauCloud-m10_v6.25.31"' in text
    assert '#define XAUAI_EA_VERSION_NUM "6.25.31"' in text
    assert "ASIA_A_PLUS_ONLY_NO_A_PLUS_RESET_PENDING" not in text
    assert EA.read_bytes() == BACKEND_EA.read_bytes()


def test_exact_reason_order_and_no_runtime_override():
    text = source()
    body = function_body(text, "bool XAU_IsPermanentM10CategoryBlocked(")
    asia = body.index('canonicalSession=="ASIA" && canonicalGrade!="A+"')
    aplus_reset = body.index(
        'canonicalGrade=="A+" && location==LOCATION_RESET_PENDING'
    )
    grade_b = body.index('if(canonicalGrade!="B")')
    assert asia < aplus_reset < grade_b
    for reason in (
        "PERM_BLOCK_ASIA_NON_A_PLUS",
        "PERM_BLOCK_A_PLUS_RESET_PENDING",
        "PERM_BLOCK_GRADE_B_REVERSAL",
        "PERM_BLOCK_RESET_PENDING_GRADE_B",
    ):
        assert reason in body
    for forbidden in (
        "InpBlockAsia",
        "InpBlockAPlus",
        "AIOverride",
        "manualOverride",
        "confidence >",
    ):
        assert forbidden not in body


def test_delayed_candidate_uses_frozen_and_live_session_and_location():
    text = source()
    resolver = function_body(text, "void XAU_ResolvePermanentM10PolicyFacts(")
    assert 'facts.liveSession=="ASIA" || facts.frozenSession=="ASIA"' in resolver
    assert "facts.liveLocation==LOCATION_RESET_PENDING" in resolver
    assert "facts.frozenLocation==LOCATION_RESET_PENDING" in resolver
    assert "g_alignedCandidates[lane].ownerSessionAtCreation" in resolver
    assert "g_alignedCandidates[lane].ownerLocationAtCreation" in resolver


def test_shared_gateway_precedes_legacy_and_ai_authority():
    text = source()
    gate = function_body(
        text, "bool XAU_OwnerEntryPermission(string phase, string source, string grade,"
    )
    policy_index = gate.index("XAU_EnforcePermanentM10CategoryPolicy(")
    legacy_location_index = gate.index("bool ownerLocationIsExcellent")
    breakout_index = gate.index("XAU_GlobalNoBreakoutAuthority(")
    assert policy_index < legacy_location_index < breakout_index
    assert "return false;" in gate[policy_index : policy_index + 500]


def test_final_assertion_guards_every_broker_send_route():
    text = source()
    checks_and_sends = [
        (
            'XAU_PermanentM10CategoryFinalAssertion("PYRAMID"',
            'trade.Buy(addLot,Symbol(),0,pyramidSL,pyramidTP',
        ),
        (
            "XAU_PermanentM10CategoryFinalAssertion(isManualOverride",
            'trade.Buy(lots, Symbol(), 0, sl, 0.0, ownerDirectionComment)',
        ),
        (
            'XAU_PermanentM10CategoryFinalAssertion("COUNTER_EXCURSION"',
            'trade.Buy(lots, Symbol(), 0, slPrice, tpPrice, comment)',
        ),
    ]
    assert text.count("XAU_PermanentM10CategoryFinalAssertion(") == 4
    for check, send in checks_and_sends:
        assert text.index(check) < text.index(send)


def test_candidate_acceptance_and_final_execution_share_gateway():
    text = source()
    assert text.count('XAU_OwnerEntryPermission("CANDIDATE_ACCEPTANCE"') >= 2
    assert text.count('XAU_OwnerEntryPermission("FINAL_EXECUTION"') >= 3


def test_counters_are_unique_and_reason_specific():
    text = source()
    record = function_body(text, "void XAU_RecordPermanentM10CategoryBlock(")
    assert "XAU_PermanentM10BlockAlreadyRecorded(candidateId)" in record
    assert "g_permM10UniqueBlocked++" in record
    assert 'StringFind(allReasons,"PERM_BLOCK_ASIA_NON_A_PLUS")>=0' in record
    assert 'StringFind(allReasons,"PERM_BLOCK_A_PLUS_RESET_PENDING")>=0' in record
    assert 'StringFind(allReasons,"PERM_BLOCK_GRADE_B_REVERSAL")>=0' in record
    assert 'StringFind(allReasons,"PERM_BLOCK_RESET_PENDING_GRADE_B")>=0' in record
    deinit = function_body(text, "void OnDeinit(const int reason)")
    assert "PERMANENT_M10_CATEGORY_BLOCK_SUMMARY" in deinit
    assert "g_permM10FinalAssertionFailures" in deinit


def test_embedded_self_test_covers_all_required_cases_without_duplicate_indices():
    text = source()
    runtime = function_body(
        text, "bool XAU_RunPermanentM10CategoryPolicySelfTests()\n{"
    )
    assert "bool checks[14];" in runtime
    for index in range(14):
        assert runtime.count(f"checks[{index}]=") == 1
    assert "for(int i=0;i<14;i++)" in runtime
    init = function_body(text, "int OnInit()")
    assert "XAU_RunPermanentM10CategoryPolicySelfTests()" in init
    assert "return INIT_FAILED;" in init


def test_unrelated_production_controls_and_offline_lease_are_preserved():
    text = source()
    assert "input double InpStopLossGoldMove = 10.0;" in text
    assert "g_rExit[idx].extensionDeadline = triggerTime + 600;" in text
    assert '#include "lease/XauCloudLeaseClient.mqh"' not in text
    assert 'blockReasonOut="OFFLINE_LEASE_NOT_INCLUDED";' in text
    assert "input bool   InpOfflineLeaseEnabled = false;" in text
    assert "XAU_LeaseTryAuthorizeOffline(" in text
    assert "InpExtensionFloor015REnabled" in text
    assert "InpExtension70PctRatchetEnabled" in text
