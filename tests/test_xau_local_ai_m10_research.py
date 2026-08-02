from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = (ROOT / "XAUUSD_AI_Sniper_EA.mq5").read_text(encoding="utf-8")
WITH_OWNER = (ROOT / "research/local_ai_m10/XauCloud_M10_LOCAL_AI_WITH_OWNER_BLOCKERS.mq5").read_text(encoding="utf-8")
NO_OWNER = (ROOT / "research/local_ai_m10/XauCloud_M10_LOCAL_AI_NO_OWNER_BLOCKERS.mq5").read_text(encoding="utf-8")


def function(text: str, signature: str, next_signature: str) -> str:
    start = text.index(signature)
    return text[start:text.index(next_signature, start)]


def test_local_ai_is_pure_m10_and_submits_asynchronously():
    ohlc = function(EA, "string XAU_LocalAIRecentM10OHLC(", "string XAU_LocalAISnapshotJson(")
    snapshot = function(EA, "string XAU_LocalAISnapshotJson(", "bool XAU_LocalAISubmitM10(")
    submit = function(EA, "bool XAU_LocalAISubmitM10(", "bool XAU_LocalAIPollM10(")
    assert "recent_m10_ohlc" in snapshot
    assert "closed_m10_timestamp" in snapshot
    assert "PERIOD_M10" in ohlc
    assert "M5" not in ohlc + snapshot
    assert '"/api/local-ai/submit"' in submit
    assert '"/api/local-ai/decision"' not in submit


def test_strategy_tester_uses_exact_offline_cache_and_never_webrequest():
    replay = function(EA, "bool XAU_LocalAIReplayLoadCache(", "bool XAU_LocalAISubmitM10(")
    submit = function(EA, "bool XAU_LocalAISubmitM10(", "bool XAU_LocalAIPollM10(")
    poll = function(EA, "bool XAU_LocalAIPollM10(", "void XAU_AICostResetIfNewDay(")
    assert "g_localAIReplaySnapshots[i]==snapshot" in replay
    assert "FILE_COMMON" in replay
    assert "XAU_LocalAIReplayCollectSnapshot(snapshot)" in replay
    assert "MQLInfoInteger(MQL_TESTER)" in submit
    tester_branch = submit[submit.index("MQLInfoInteger(MQL_TESTER)"):submit.index("NON_LOOPBACK_LOCAL_AI_URL_REJECTED")]
    assert "XAU_LocalAIReplayDecision(body,decision)" in tester_branch
    assert "WebRequest" not in tester_branch
    assert "decision=g_localAIDecision" in poll


def test_local_first_filter_only_calls_for_existing_or_high_value_uncertain_m10_evidence():
    eligible = function(EA, "bool XAU_LocalAIEligibleM10(", "bool XAU_LocalAIReplayLoadCache(")
    assert 'g_m10Snapshot.dataState!="COMPLETE"' in eligible
    assert 'g_m10Snapshot.freshnessState!="FRESH"' in eligible
    assert "g_m10Decision.preferredDirection==0" in eligible
    assert "existingCandidate" in eligible
    assert "signal==0 && leader>=70.0 && separation>=8.0" in eligible
    assert "LOCAL_AI_SKIPPED" in EA


def test_zero_credit_and_confidence_fallback_are_defaults():
    assert "input bool   InpUseAI          = false;" in EA
    assert "input bool   InpAIExitOverride   = false;" in EA
    assert "InpEmergentDifficultFallbackEnabled = false" in EA
    assert "InpLocalAIConfidenceThreshold = 70" in EA
    parser = function(EA, "bool XAU_ParseLocalAIDecision(", "string XAU_LocalAIRecentM10OHLC(")
    assert "d.confidence>=InpLocalAIConfidenceThreshold" in parser
    assert 'd.status=="LOCAL_AI_FALLBACK"' in parser
    assert 'd.status=="LOCAL_AI_LOW_CONFIDENCE"' in parser


def test_strict_local_result_cannot_bypass_owner_or_normal_pipeline():
    local_call = EA.index("XAU_LocalAISubmitM10(signal,setupName,provisionalGrade,localNow)")
    owner_candidate = EA.index('XAU_OwnerEntryPermission("CANDIDATE_ACCEPTANCE"', local_call)
    final_arbiter = EA.index('XAU_FinalEntryArbiter("PRIMARY"', owner_candidate)
    local_final = EA.index("XAU_LocalAIPollM10(localFinal)", final_arbiter)
    order = EA.index("bool tradeOpened = OpenTrade", local_final)
    assert local_call < owner_candidate < final_arbiter < local_final < order
    assert "XAU_OwnerEntryPermission(\"FINAL_EXECUTION\"" in EA[EA.index("bool OpenTrade("):]


def test_with_owner_variant_is_exact_canonical_source():
    assert WITH_OWNER == EA
    assert "InpResearchOwnerBlockersEnabled = true;" in WITH_OWNER


def test_no_owner_variant_changes_only_controlled_owner_blocker_chokes():
    assert "InpResearchOwnerBlockersEnabled = false;" in NO_OWNER
    assert "disabledScope=PERMANENT_ENUMERATED_LIST" in NO_OWNER
    assert "InpResearchOwnerBlockersEnabled && (ownerLocationIsExcellent || ownerLocationIsLate)" in NO_OWNER
    assert "if(!InpResearchOwnerBlockersEnabled) return;" in NO_OWNER
    # Normal/broker/risk gates remain in the controlled variant.
    for required in (
        "XAU_GlobalNoBreakoutAuthority", "XAU_FinalEntryArbiter", "CANCEL_SPREAD_INVALID",
        "XAU_NewsAuthorityAllows", "XAU_StructureAuthorityAllows", "XAU_FreshnessExtensionAuthority",
        "OrderCalcMargin", "trade.Buy", "trade.Sell", "XAU_FixedGoldMoveSLPrice",
    ):
        assert required in NO_OWNER
