from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.13.0.mq5"
EA_BACKEND = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def section(ea: str, start: str, end: str) -> str:
    return ea[ea.index(start):ea.index(end, ea.index(start))]


def test_v6413_identity_and_heartbeat_reporting_exist():
    ea = read(EA)

    assert '#property version   "6.130"' in ea
    assert '#define XAUAI_EA_VERSION "v6.13.0"' in ea
    assert "InpLocalReportHeartbeatSec" in ea
    assert "XAUAI_LiveHeartbeat_" in ea
    assert "XAU_WriteLocalReportHeartbeat(false)" in ea
    assert "Status: " in ea
    assert "Reason: " in ea
    assert "Last scan: " in ea


def test_probability_ev_inputs_and_state_are_declared():
    ea = read(EA)

    for token in (
        "InpEVExitEngineEnable",
        "InpEVMinHoldEdgeUSD",
        "InpEVExitEdgeUSD",
        "InpEVContinuationHigh",
        "InpEVExhaustionHigh",
        "InpEVReviewMinMoveATR",
        "g_evExitLearningBias",
        "g_evExitReviewCount",
        "XAU_EV_DECISION",
        "XAU_EV_HOLD",
        "XAU_EV_PROTECT",
        "XAU_EV_PARTIAL",
        "XAU_EV_EXIT",
    ):
        assert token in ea


def test_ev_model_scores_continuation_exhaustion_reversal_and_expected_value():
    ea = read(EA)
    ev_model = section(ea, "XAU_EV_DECISION XAU_EvaluateExitEV", "bool XAU_ContextShouldTakePartial")

    for token in (
        "continuationProb",
        "exhaustionProb",
        "reversalProb",
        "remainingPotentialUSD",
        "profitAtRiskUSD",
        "holdEV",
        "exitEV",
        "liquidityRoomATR",
        "momentumScore",
        "runnerClean",
        "g_htfConsensusDir",
        "g_marketPersonality",
        "currentTradeConfidence",
        "InpEVMinHoldEdgeUSD",
        "InpEVExitEdgeUSD",
    ):
        assert token in ev_model


def test_smart_exit_uses_ev_decision_before_partial_or_thesis_hold():
    ea = read(EA)
    smart_exit = section(ea, "bool XAU_SmartExit3Layer", "bool XAU_ProtectPeakProfitFloor")

    assert "XAU_EvaluateExitEV" in smart_exit
    assert "ev.decision == XAU_EV_EXIT" in smart_exit
    assert "ev.decision == XAU_EV_PROTECT" in smart_exit
    assert "ev.decision == XAU_EV_PARTIAL" in smart_exit
    assert "ev.decision == XAU_EV_HOLD" in smart_exit
    assert smart_exit.index("XAU_EvaluateExitEV") < smart_exit.index("XAU_ContextShouldTakePartial")
    assert "EV_EXIT" in smart_exit
    assert "EV_PROTECT" in smart_exit
    assert "EV_PARTIAL" in smart_exit
    assert "EV_HOLD" in smart_exit


def test_post_close_review_feeds_exit_learning_bias():
    ea = read(EA)

    assert "XAU_EVPostCloseReview" in ea
    assert "EXIT_EARLY_LEFT_PROFIT" in ea
    assert "EXIT_GOOD_AVOIDED_REVERSAL" in ea
    assert "g_evExitLearningBias" in section(ea, "void XAU_EVPostCloseReview", "void XAU_UpdateClosedTradeReviews")
    assert "XAU_EVPostCloseReview(r, verdict" in ea


def test_backend_source_is_synced_to_v6414():
    assert read(EA) == read(EA_BACKEND)
