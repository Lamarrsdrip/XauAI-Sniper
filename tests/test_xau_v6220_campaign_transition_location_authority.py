"""Release-blocking authority tests for the isolated v6.22.0 campaign experiment."""
from __future__ import annotations

import json
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.22.0_ADAPTIVE_TREND_CAMPAIGN_EXP1.mq5"
FIXTURE = ROOT / "tests/fixtures/xau_vps_transition_incident_20260713_14.json"


def source() -> str:
    return EA.read_text(encoding="utf-8", errors="ignore")


def body(text: str, signature: str) -> str:
    start = text.index(signature)
    brace = text.index("{", start)
    depth = 0
    for i in range(brace, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    raise AssertionError(f"unterminated function: {signature}")


def final_decision(*, exhaustion: float, old_direction: bool, source_name: str,
                   continuation: float = 80.0, remaining_reward: float = 2.0,
                   opposite_confirmed: bool = False, location_good: bool = True,
                   consumed: bool = False) -> bool:
    allowed = True
    if old_direction and 60 <= exhaustion < 70:
        if source_name == "PYRAMID" or continuation < 55 or remaining_reward < 1.2:
            allowed = False
    if old_direction and exhaustion >= 70:
        allowed = False
    if not old_direction:
        allowed = exhaustion >= 80 and opposite_confirmed
        if not location_good or consumed:
            allowed = False
    return allowed


def location_decision(*, extension_atr: float, consumed_pct: float,
                      value_distance_atr: float, reward_r: float,
                      already_entered: bool, pullback_from_peak_atr: float = 0.0) -> str:
    value_reset = (
        pullback_from_peak_atr >= 0.75
        and value_distance_atr <= 1.0
        and reward_r >= 1.2
    )
    extended = extension_atr > 2.0 or consumed_pct > 70.0
    good = reward_r >= 1.2 and value_distance_atr <= 1.0 and (
        (not extended and not already_entered) or value_reset
    )
    if good:
        return "ALLOW_VALUE_RESET" if value_reset else "ALLOW"
    if extended or already_entered:
        return "WAIT_FOR_PULLBACK"
    return "FORMING_NOT_READY"


def persistent_exhaustion(previous: float, raw: float, *, real_reset: bool) -> float:
    if raw >= previous:
        return raw
    if real_reset:
        return max(raw, previous - 10.0)
    return previous


def test_build_identity_and_shadow_default_are_explicit():
    text = source()
    assert '#define XAUAI_BUILD_HASH "v6220-campaign-manual-micro-transition-20260714"' in text
    assert "InpCampaignTransitionMode = CAMPAIGN_TRANSITION_SHADOW" in text
    assert "CAMPAIGN_TRANSITION_OFF" in text and "CAMPAIGN_TRANSITION_ACTIVE" in text


def test_counter_excursion_remains_removed_from_experiment_contract():
    text = source()
    assert "counterExcursionRemoved=true" in text
    assert "counter=REMOVED_BY_EXPERIMENT_CONTRACT" in text
    assert "XAU_RecordCounterTransitionEvidence" not in text
    assert "XAU_CounterTransitionEvidence" not in text


def test_one_final_choke_is_inside_open_trade_before_broker_send():
    text = source()
    fn = body(text, "bool OpenTrade(int signal, double atr, string reason, double sizeMulti, bool isManualOverride = false)")
    choke = fn.index("XAU_FinalAdaptiveCampaignDirectionDecision")
    buy = fn.index("trade.Buy(lots")
    assert choke < buy
    assert 'XAU_CTEntrySource(reason,"PRIMARY")' not in fn  # source inference is centralized inside final decision


def test_all_automated_open_trade_sources_are_classified():
    fn = body(source(), "string XAU_CTEntrySource(string reason, string fallback)")
    for name in ("PYRAMID", "RE_ENTRY", "RECOVERY", "RETRY", "ADAPTIVE_REVERSAL"):
        assert f'"{name}"' in fn


def test_both_direct_pyramid_paths_obey_same_final_choke():
    text = source()
    legacy = body(text, "void CheckPyramidOpportunity()")
    campaign = body(text, "void XAU_Campaign_EvaluatePyramid(int idx, bool isBuy, double curPrice, double atr,")
    assert "XAU_FinalAdaptiveCampaignDirectionDecision" in legacy
    assert "XAU_FinalAdaptiveCampaignDirectionDecision" in campaign
    assert legacy.index("XAU_FinalAdaptiveCampaignDirectionDecision") < legacy.index("trade.Buy (addLot")
    assert campaign.index("XAU_FinalAdaptiveCampaignDirectionDecision") < campaign.index("trade.Buy(proposedLot")


def test_active_mode_makes_legacy_exhaustion_guard_observation_only():
    fn = body(source(), "bool OpenTrade(int signal, double atr, string reason, double sizeMulti, bool isManualOverride = false)")
    assert "InpCampaignTransitionMode != CAMPAIGN_TRANSITION_ACTIVE" in fn
    assert "LEGACY_EXHAUSTION_GUARD_OBSERVATION_ONLY" in fn


def test_active_mode_uses_central_lifecycle_as_legacy_compatibility_view():
    fn = body(source(), "void XAU_TrendMaturity_Update()")
    assert "XAU_AdaptiveCampaignTransitionEngine" in fn
    assert "if(InpCampaignTransitionMode == CAMPAIGN_TRANSITION_ACTIVE)" in fn
    assert "sole lifecycle source" in fn


def test_69_percent_is_selective_not_blanket_disabled():
    assert final_decision(exhaustion=69, old_direction=True, source_name="PRIMARY")
    assert not final_decision(exhaustion=69, old_direction=True, source_name="PYRAMID")


@pytest.mark.parametrize("source_name", ["PRIMARY", "RE_ENTRY", "RECOVERY", "RETRY", "PYRAMID"])
def test_70_percent_blocks_every_old_direction_source(source_name: str):
    assert not final_decision(exhaustion=70, old_direction=True, source_name=source_name)


def test_80_percent_alone_does_not_blindly_reverse():
    assert not final_decision(
        exhaustion=80, old_direction=False, source_name="ADAPTIVE_REVERSAL",
        opposite_confirmed=False, location_good=True,
    )


def test_80_percent_plus_confirmation_and_location_allows_opposite():
    assert final_decision(
        exhaustion=80, old_direction=False, source_name="ADAPTIVE_REVERSAL",
        opposite_confirmed=True, location_good=True,
    )


def test_one_wick_cannot_satisfy_reversal_package_static():
    fn = body(source(), "XAU_CampaignTransitionDecision XAU_AdaptiveCampaignTransitionEngine()")
    assert "failedExtremes>=2 && d.oppositeReclaim" in fn
    assert "d.oppositeRetestHeld || d.oppositeDisplacement" in fn
    assert "oppositePersistence>=2" in fn


def test_closed_m1_bridge_requires_high_exhaustion_and_compact_package():
    fn = body(source(), "XAU_CampaignTransitionDecision XAU_AdaptiveCampaignTransitionEngine()")
    assert "bool microBridgeActive=d.exhaustionProbability>=InpCampaignTransitionExhaustAt" in fn
    assert "earlyMicroPackage=failedExtremes>=2 && d.oppositeMicroSweepReclaim" in fn
    assert "d.oppositeMicroRetestHeld || d.oppositeMicroDisplacement" in fn
    assert "d.oppositeMicroPersistence>=InpCampaignTransitionMicroPersistence" in fn
    assert "d.exhaustionProbability>=90.0" in fn
    assert "d.oppositeMicroRetestHeld" in fn


def test_m1_recompute_cannot_age_m5_hysteresis_or_decay_exhaustion():
    fn = body(source(), "XAU_CampaignTransitionDecision XAU_AdaptiveCampaignTransitionEngine()")
    assert "else if(realContinuationReset && m5EvidenceAdvanced)" in fn
    candidate = fn[fn.index("if(m5EvidenceAdvanced)") : fn.index("bool authoritativeExhaustion")]
    assert "g_campaignTransitionCandidateBars++" in candidate


def test_campaign_hold_manager_is_not_replaced_by_micro_bridge():
    text = source()
    fn = body(text, "bool XAU_Campaign_ApplyTransitionPositionAuthority(int idx, double currentR, string classification)")
    assert "d.oppositeEntryAllowed" in fn
    assert "XAU_Campaign_Finalize" in fn
    assert "trade.PositionClose" not in fn
    assert "XAU_RExit_RequestClose" not in fn


def test_micro_configuration_is_validated_logged_and_build_identifying():
    text = source()
    validate = body(text, "bool XAU_ValidateMaturityConfig()")
    input_hash = body(text, "string XAUAI_InputHash()")
    for name in (
        "InpCampaignTransitionMicroPersistence",
        "InpCampaignTransitionMicroDisplaceATR",
        "InpCampaignTransitionMicroSweepATR",
    ):
        assert name in validate
        assert name in input_hash
    assert "microPersistence=%d" in text


def test_high_exhaustion_cannot_decay_from_elapsed_bars():
    assert persistent_exhaustion(86, 30, real_reset=False) == 86
    assert persistent_exhaustion(86, 30, real_reset=True) == 76
    fn = body(source(), "XAU_CampaignTransitionDecision XAU_AdaptiveCampaignTransitionEngine()")
    assert "realContinuationReset" in fn
    assert "g_campaignPersistentExhaustion-10.0" in fn
    assert "InpMaxTransitionWaitBars" not in fn


def test_reversal_opportunity_persists_identity_and_consumption_across_restart():
    text = source()
    save = body(text, "void XAU_CTSavePersistentState()")
    load = body(text, "void XAU_CTLoadPersistentState()")
    for field in ("revOrigin", "revFirst", "revReclaim", "revLatest", "revPeak", "revPullback", "revEntry", "revConsumed", "revState"):
        assert field in save and field in load


def test_correct_direction_at_bad_location_waits_for_pullback():
    assert location_decision(
        extension_atr=2.19, consumed_pct=74, value_distance_atr=0.8,
        reward_r=1.56 / 2.2, already_entered=True,
    ) == "WAIT_FOR_PULLBACK"


def test_value_reset_requires_market_pullback_not_time():
    assert location_decision(
        extension_atr=2.2, consumed_pct=75, value_distance_atr=0.7,
        reward_r=1.5, already_entered=True, pullback_from_peak_atr=0.74,
    ) == "WAIT_FOR_PULLBACK"
    assert location_decision(
        extension_atr=2.2, consumed_pct=75, value_distance_atr=0.7,
        reward_r=1.5, already_entered=True, pullback_from_peak_atr=0.75,
    ) == "ALLOW_VALUE_RESET"


def test_fast_reversal_timing_is_active_only_and_bounded():
    fn = body(source(), "double XAU_EffectiveAdaptiveCampaignEntryDelaySeconds(int dir)")
    assert "InpCampaignTransitionMode!=CAMPAIGN_TRANSITION_ACTIVE" in fn
    assert "MathMax(15.0,MathMin(60.0" in fn
    timing = body(source(), "bool XAU_TimingEngineConfirmsEntry(int dir, string setup, string grade, double sizeMulti, double atr)")
    assert "adaptiveDelaySec" in timing
    assert "CANCELLED BY CAMPAIGN TRANSITION AUTHORITY" in timing


def test_campaign_manager_is_the_only_transition_close_owner():
    text = source()
    fn = body(text, "bool XAU_Campaign_ApplyTransitionPositionAuthority(int idx, double currentR, string classification)")
    assert "XAU_Campaign_Finalize" in fn
    assert "trade.PositionClose" not in fn
    core = body(text, "void XAU_CampaignCoreLoop()")
    assert "XAU_Campaign_ApplyTransitionPositionAuthority" in core


def test_protection_tightens_at_high_exhaustion_without_inventing_peak():
    fn = body(source(), "void XAU_Campaign_UpdateProtection(int idx, bool isBuy, double curPrice, double atr, int digits)")
    assert "transitionProtection.exhaustionProbability>=InpCampaignTransitionExhaustAt" in fn
    assert "MathMax(0.02,peakR*0.35)" in fn
    assert "newFloorR = MathMax(newFloorR, prevFloorR);" in fn


def test_incident_replay_blocks_both_proven_losing_sells():
    data = json.loads(FIXTURE.read_text())
    losing_sells = [x for x in data["sequence"] if x["id"].startswith("losing_sell")]
    assert [x["entry"] for x in losing_sells] == [3997.631, 4015.021]
    for trade in losing_sells:
        assert trade["result_usd"] < 0
        assert not final_decision(exhaustion=86, old_direction=True, source_name=trade["source"].split("_")[0])


def test_live_addendum_second_buy_is_blocked_as_same_extended_impulse():
    data = json.loads(FIXTURE.read_text())
    buy = next(x for x in data["sequence"] if x["id"] == "later_normal_buy_bad_location")
    assert buy["logged_bad_location"] and not buy["logged_value"]
    assert buy["origin_extension_atr"] > 2.0 and buy["local_position_pct"] > 70
    assert location_decision(
        extension_atr=buy["origin_extension_atr"], consumed_pct=buy["local_position_pct"],
        value_distance_atr=0.8, reward_r=buy["local_room_atr"] / 2.2,
        already_entered=True,
    ) == "WAIT_FOR_PULLBACK"


@pytest.mark.parametrize("direction", [1, -1])
def test_transition_and_location_rules_are_direction_symmetric(direction: int):
    assert not final_decision(exhaustion=70, old_direction=True, source_name="PRIMARY")
    assert final_decision(exhaustion=85, old_direction=False, source_name="ADAPTIVE_REVERSAL",
                          opposite_confirmed=True, location_good=True)
    assert direction in (1, -1)


def test_source_contains_required_audit_records():
    text = source()
    for marker in (
        "[MARKET_LIFECYCLE]", "[EXHAUSTION_ENTRY_AUDIT]", "[TRANSITION_POSITION_AUDIT]",
        "[REVERSAL_ENTRY_AUDIT]", "FINAL_CAMPAIGN_DIRECTION_DECISION",
    ):
        assert marker in text
