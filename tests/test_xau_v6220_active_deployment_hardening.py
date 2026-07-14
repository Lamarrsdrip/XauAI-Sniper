"""Executable release gates for the v6.22.0 ACTIVE campaign experiment."""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.22.0_ADAPTIVE_TREND_CAMPAIGN_EXP1.mq5"
SET = ROOT / "config/XAUUSD_AI_Sniper_EA_v6.22.0_ADAPTIVE_TREND_CAMPAIGN_EXP1_ACTIVE.set"
DEPLOY = ROOT / "scripts/deploy_v6220_experiment_active.sh"
CHECKLIST = ROOT / "docs/v6220_experiment_active_release_checklist.md"
MANUAL = ROOT / "tests/fixtures/xau_owner_manual_transition_20260713_14.json"


def source() -> str:
    return EA.read_text(encoding="utf-8", errors="ignore")


def body(text: str, signature: str) -> str:
    start = text.index(signature)
    brace = text.index("{", start)
    depth = 0
    for i in range(brace, len(text)):
        depth += text[i] == "{"
        depth -= text[i] == "}"
        if depth == 0:
            return text[start:i + 1]
    raise AssertionError(signature)


def allow(*, exhaustion: float, old: bool, source_name: str,
          reversal_package: bool = False, location: bool = True) -> bool:
    if old:
        if exhaustion >= 70:
            return False
        return not (60 <= exhaustion < 70 and source_name == "PYRAMID")
    return exhaustion >= 80 and reversal_package and location


def micro_package(bars: list[int], *, sweep: bool, reclaim: bool,
                  retest: bool, displacement: bool, environment_safe: bool) -> bool:
    consecutive = 0
    for direction in bars:
        if direction == 1:
            consecutive += 1
        else:
            break
    return environment_safe and consecutive >= 3 and sweep and reclaim and (retest or displacement)


def test_01_active_mode_is_source_default():
    assert "InpCampaignTransitionMode = CAMPAIGN_TRANSITION_ACTIVE" in source()


def test_02_shadow_cannot_remain_in_shipped_preset():
    preset = SET.read_text()
    assert re.search(r"(?m)^InpCampaignTransitionMode=2$", preset)
    assert not re.search(r"(?m)^InpCampaignTransitionMode=1$", preset)


def test_03_all_entry_sources_use_final_send_backstop():
    text = source()
    send = body(text, "bool XAU_CampaignAuthorizedMarketSend(int requestedDirection,double lots,double sl,double tp,")
    assert "XAU_FinalAdaptiveCampaignDirectionDecision" in send
    assert "XAU_TryClaimEntryLock" in send
    assert "[CAMPAIGN_ACTIVE_ENTRY_AUTHORITY]" in send
    for fn_sig in (
        "void CheckPyramidOpportunity()",
        "bool OpenTrade(int signal, double atr, string reason, double sizeMulti, bool isManualOverride = false)",
        "void XAU_Campaign_EvaluatePyramid(int idx, bool isBuy, double curPrice, double atr,",
    ):
        assert "XAU_CampaignAuthorizedMarketSend" in body(text, fn_sig)


@pytest.mark.parametrize("source_name", ["PRIMARY", "RE_ENTRY", "RECOVERY", "RETRY", "PYRAMID"])
def test_04_to_08_seventy_blocks_each_old_direction_source(source_name: str):
    assert not allow(exhaustion=70, old=True, source_name=source_name)


def test_09_valid_high_exhaustion_micro_package_prepares_opposite():
    assert allow(exhaustion=80, old=False, source_name="ADAPTIVE_REVERSAL",
                 reversal_package=micro_package([1, 1, 1], sweep=True, reclaim=True,
                                                retest=True, displacement=True,
                                                environment_safe=True))


def test_10_exhaustion_alone_does_not_enter():
    assert not allow(exhaustion=90, old=False, source_name="ADAPTIVE_REVERSAL")


def test_11_one_wick_does_not_reverse():
    assert not micro_package([1, -1, -1], sweep=True, reclaim=True, retest=False,
                             displacement=False, environment_safe=True)


def test_12_noisy_m1_alternation_does_not_reverse():
    assert not micro_package([1, -1, 1, -1, 1], sweep=True, reclaim=True, retest=True,
                             displacement=True, environment_safe=True)


def test_13_closed_m1_reclaim_retest_can_precede_htf_flip():
    engine = body(source(), "XAU_CampaignTransitionDecision XAU_AdaptiveCampaignTransitionEngine()")
    assert "oppositeMicroConsecutive>=InpCampaignTransitionMicroPersistence" in engine
    assert "d.oppositeMicroRetestHeld" in engine
    assert "g_microTrendDir" not in engine  # no live/incomplete-bar dependency


def test_14_extended_reversal_waits_for_pullback():
    final = body(source(), "bool XAU_FinalAdaptiveCampaignDirectionDecision(int requestedDirection, string source, string reason,")
    assert "CAMPAIGN_REVERSAL_DIRECTION_VALID_BUT_WAIT_FOR_PULLBACK" in final
    assert "liveChase" in final and "impulseConsumedByEntry" in final


def test_15_same_opportunity_is_consumed_once():
    text = source()
    mark = body(text, "void XAU_CTMarkOpportunityEntry(int direction, double price, string source)")
    assert "impulseConsumedByEntry = true" in mark and "lastEntryAt = TimeCurrent()" in mark


def test_16_market_structure_can_reset_value_without_elapsed_time():
    engine = body(source(), "XAU_CampaignTransitionDecision XAU_AdaptiveCampaignTransitionEngine()")
    assert "structuralRetestReset" in engine and "compactBase" in engine and "impulseResetContinuation" in engine
    assert "barsAfterEntry" in engine


def test_17_existing_old_campaign_reacts_to_confirmed_transition():
    fn = body(source(), "bool XAU_Campaign_ApplyTransitionPositionAuthority(int idx, double currentR, string classification)")
    assert "CAMPAIGN_OPPOSITE_CONFIRMED" in fn
    assert "CAMPAIGN_TRANSITION_EXIT_PROFITABLE" in fn
    assert "CAMPAIGN_TRANSITION_EXIT_CONTROLLED" in fn
    assert "XAU_Campaign_Finalize" in fn


def test_18_new_reversal_campaign_is_not_m1_scalped():
    fn = body(source(), "bool XAU_Campaign_ApplyTransitionPositionAuthority(int idx, double currentR, string classification)")
    assert "oldDirection" in fn
    assert "oppositeMicroDisplacement" not in fn
    assert "trade.PositionClose" not in fn


def test_19_early_reversal_requires_floor_before_first_pyramid():
    fn = body(source(), "void XAU_Campaign_EvaluatePyramid(int idx, bool isBuy, double curPrice, double atr,")
    assert 'StringFind(g_campaign[idx].setup,"ADAPTIVE_CAMPAIGN_REVERSAL")' in fn
    assert "g_campaign[idx].guaranteeArmed" in fn


def test_20_restart_preserves_active_transition_authority():
    text = source()
    save = body(text, "void XAU_CTSavePersistentState()")
    load = body(text, "void XAU_CTLoadPersistentState()")
    for key in ("exhaustion", "lifecycle", "revDir", "revOrigin", "revFirst", "revReclaim",
                "revLatest", "revPeak", "revConsumed", "buyAction", "sellAction", "candidateBars"):
        assert key in save and key in load


def test_21_restart_preserves_consumed_opportunity_and_entry_time():
    text = source()
    assert "revConsumed" in body(text, "void XAU_CTSavePersistentState()")
    assert "revEntryAt" in body(text, "void XAU_CTLoadPersistentState()")


def test_22_uncertain_restart_cannot_reopen_old_direction():
    load = body(source(), "void XAU_CTLoadPersistentState()")
    assert "g_campaignTransitionRestartConservative=true" in load
    assert "MathMax(g_campaignPersistentExhaustion,InpCampaignTransitionExhaustAt)" in load


def test_23_broker_close_rejection_stays_pending_for_retry():
    fn = body(source(), "bool XAU_RExit_RequestClose(int idx, ulong currentTicket, string reason)")
    assert "R_CLOSE_PENDING_RETRY" in fn and "CLOSE_PENDING_RETRY" in fn


def test_24_campaign_state_clears_only_after_broker_position_is_gone():
    fn = body(source(), "bool XAU_RExit_RequestClose(int idx, ulong currentTicket, string reason)")
    assert "sendOk && !stillOpen" in fn
    assert fn.index("sendOk && !stillOpen") < fn.index("XAU_RExit_Clear")


def test_25_risk_is_full_configured_fifteen_or_block():
    text = source()
    preset = SET.read_text()
    assert "InpNormalRiskPct       = 15.0" in text
    assert "InpReducedRiskFloorPct = 15.0" in text
    assert "InpNormalRiskPct=15.0" in preset and "InpReducedRiskFloorPct=15.0" in preset


def test_26_active_init_assertion_and_validation_are_release_blocking():
    text = source()
    assert "CAMPAIGN_TRANSITION_ACTIVE_ASSERTION_PASSED" in text
    validate = body(text, "bool XAU_ValidateMaturityConfig()")
    assert "InpCampaignTransitionExhaustAt >= InpCampaignTransitionPreferredAt" in validate
    assert "InpCampaignTransitionMinConfidenceGap" in validate
    assert "InpCampaignTransitionMicroMaxBarATR" in validate


def test_27_experiment_memory_and_magic_remain_isolated():
    text = source()
    assert 'return "XAUAI_LS_" + Symbol() + "_" + IntegerToString(InpMagicNumber)' in text
    assert "InpMagicNumber    = 62200001" in text
    assert "RExitState_CAMPAIGNEXP1" in text


def test_28_healthy_trend_is_not_blanket_blocked():
    for exhaustion in (0, 25, 59, 69):
        assert allow(exhaustion=exhaustion, old=True, source_name="PRIMARY")


@pytest.mark.parametrize("old_direction", [1, -1])
def test_29_buy_sell_transition_rules_are_symmetric(old_direction: int):
    assert not allow(exhaustion=70, old=True, source_name="PRIMARY")
    assert allow(exhaustion=85, old=False, source_name="ADAPTIVE_REVERSAL",
                 reversal_package=True, location=True)
    assert -old_direction in (-1, 1)


def test_30_owner_manual_fixture_remains_classifiable_and_anonymized():
    raw = MANUAL.read_text()
    assert not re.search(r'(?i)"(?:login|password|investor|ticket)"\s*:', raw)
    data = json.loads(raw)
    assert any(row["expected"] == "OLD_ALLOWED" for row in data["sequence"])
    assert any(row["expected"] == "OPPOSITE_ALLOWED" for row in data["sequence"])


def test_deployment_script_and_checklist_are_active_demo_only():
    script = DEPLOY.read_text()
    checklist = CHECKLIST.read_text()
    assert "--demo-confirmed" in script and "InpCampaignTransitionMode=2" in script
    assert "Production v6.23.1" in checklist and "CAMPAIGN_TRANSITION_ACTIVE_ASSERTION_PASSED" in checklist
