"""Deterministic transition-lifecycle scenarios for production v6.23.1.

This model intentionally separates continuation permission from reversal
permission.  It is a test oracle for the MQL5 implementation, not a broker or
indicator backtest.
"""

from dataclasses import dataclass
import json
from pathlib import Path
import re
from typing import Optional


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.23.1.mq5"


@dataclass(frozen=True)
class Evidence:
    direction: int = -1
    travel_atr: float = 1.0
    range_consumed: float = 0.35
    continuation: float = 75.0
    absorption: float = 10.0
    structure_opposite: float = 5.0
    momentum_opposite: float = 10.0
    remaining_reward_r: float = 2.5
    counter_opposite: float = 0.0
    failed_extremes: int = 0
    reclaim: bool = False
    retest_held: bool = False
    displacement: bool = False
    persistence: int = 0
    htf_direction: int = -1
    exhaustion_override: Optional[float] = None


@dataclass(frozen=True)
class Decision:
    lifecycle: str
    continuation_allowed: bool
    opposite_preparing: bool
    opposite_allowed: bool
    action: str
    exhaustion: float
    transition: float
    old_direction_confidence: float


def decide(e: Evidence) -> Decision:
    maturity = min(100.0, e.travel_atr * 16.0 + e.range_consumed * 38.0)
    exhaustion = min(
        100.0,
        maturity * 0.34
        + (100.0 - e.continuation) * 0.28
        + e.absorption * 0.18
        + e.momentum_opposite * 0.10
        + (25.0 if e.remaining_reward_r < 1.0 else 0.0)
        + e.counter_opposite * 0.10,
    )
    if e.exhaustion_override is not None:
        exhaustion = e.exhaustion_override
    transition = min(
        100.0,
        exhaustion * 0.38
        + e.structure_opposite * 0.30
        + e.momentum_opposite * 0.12
        + e.counter_opposite * 0.12
        + min(18.0, e.failed_extremes * 6.0),
    )
    mature = maturity >= 58.0 or exhaustion >= 60.0
    old_confidence = min(e.continuation, 45.0) if exhaustion >= 70.0 else e.continuation
    if exhaustion >= 70.0 and e.counter_opposite > 0:
        old_confidence = min(old_confidence, 35.0)
    exhausted = exhaustion >= 70.0
    transitioning = transition >= 55.0 and e.persistence >= 2
    preparing = exhausted and (e.reclaim or e.failed_extremes >= 2)
    opposite_allowed = (
        exhaustion >= 80.0
        and transitioning
        and e.reclaim
        and e.retest_held
        and e.displacement
        and e.persistence >= 3
        and e.remaining_reward_r >= 1.2
    )
    continuation_allowed = not exhausted and not transitioning
    if opposite_allowed:
        lifecycle, action = "OPPOSITE_DIRECTION_CONFIRMED", "WAIT_FOR_OPPOSITE_SETUP"
    elif transitioning:
        lifecycle, action = "TRANSITION_NEUTRAL", "TIGHTEN_PROTECTION"
    elif exhausted:
        lifecycle, action = "TREND_EXHAUSTING", "TIGHTEN_PROTECTION"
    elif mature:
        lifecycle, action = "TREND_MATURE", "STOP_ADDS"
    else:
        lifecycle, action = "TREND_HEALTHY", "HOLD"
    return Decision(lifecycle, continuation_allowed, preparing, opposite_allowed, action, exhaustion, transition, old_confidence)


def healthy_sell() -> Evidence:
    return Evidence()


def exhausted_sell(**updates) -> Evidence:
    values = dict(
        direction=-1,
        travel_atr=5.8,
        range_consumed=0.93,
        continuation=22,
        absorption=75,
        structure_opposite=48,
        momentum_opposite=63,
        remaining_reward_r=0.55,
        counter_opposite=42,
        failed_extremes=3,
        reclaim=True,
        persistence=3,
        htf_direction=-1,
        exhaustion_override=86.0,
    )
    values.update(updates)
    return Evidence(**values)


def mirror(e: Evidence) -> Evidence:
    return Evidence(**{**e.__dict__, "direction": -e.direction, "htf_direction": -e.htf_direction})


def test_healthy_sell_still_trades():
    d = decide(healthy_sell())
    assert d.continuation_allowed and not d.opposite_allowed


def test_mature_sell_does_not_automatically_reverse():
    d = decide(Evidence(travel_atr=3.4, range_consumed=0.75, continuation=55))
    assert d.lifecycle == "TREND_MATURE"
    assert not d.opposite_allowed


def test_exhausted_sell_blocks_fresh_sell_reentry_and_pyramid():
    d = decide(exhausted_sell())
    for source in ("PRIMARY", "RE_ENTRY", "RECOVERY", "RETRY", "PYRAMID"):
        assert not d.continuation_allowed, source


def test_69_percent_exhaustion_does_not_disable_all_continuation():
    d = decide(Evidence(exhaustion_override=69.0, continuation=72, remaining_reward_r=1.8))
    assert d.continuation_allowed


def test_active_does_not_collapse_frequency_across_healthy_trend_matrix():
    scenarios = [
        Evidence(
            direction=direction,
            htf_direction=direction,
            travel_atr=travel,
            range_consumed=0.25 + 0.08 * index,
            continuation=88.0 - 3.0 * index,
            absorption=8.0 + 2.0 * index,
            momentum_opposite=8.0 + index,
            remaining_reward_r=2.8 - 0.15 * index,
        )
        for direction in (-1, 1)
        for index, travel in enumerate((0.7, 1.1, 1.5, 1.9, 2.3))
    ]
    decisions = [decide(s).continuation_allowed for s in scenarios]
    assert sum(decisions) / len(decisions) >= 0.80


def test_70_percent_exhaustion_blocks_every_old_direction_source():
    d = decide(Evidence(exhaustion_override=70.0, failed_extremes=2))
    assert not d.continuation_allowed
    for source in ("PRIMARY", "RE_ENTRY", "RECOVERY", "RETRY", "PYRAMID"):
        assert not d.continuation_allowed, source


def test_80_percent_exhaustion_alone_does_not_blindly_reverse():
    d = decide(Evidence(exhaustion_override=80.0, reclaim=False, retest_held=False, displacement=False, persistence=3))
    assert not d.opposite_allowed


def test_80_percent_plus_compact_reversal_package_allows_early_buy():
    d = decide(
        Evidence(
            exhaustion_override=82.0,
            failed_extremes=3,
            reclaim=True,
            retest_held=True,
            displacement=True,
            persistence=3,
            structure_opposite=80,
            momentum_opposite=75,
            remaining_reward_r=2.0,
        )
    )
    assert d.opposite_allowed


def test_one_bullish_wick_does_not_create_buy():
    d = decide(Evidence(absorption=65, persistence=1, reclaim=False))
    assert not d.opposite_allowed


def test_failed_lows_and_reclaim_raise_transition():
    weak = decide(exhausted_sell(failed_extremes=0, reclaim=False, structure_opposite=15))
    strong = decide(exhausted_sell())
    assert strong.transition > weak.transition


def test_counter_buy_success_reduces_sell_continuation_confidence():
    without = decide(exhausted_sell(counter_opposite=0, absorption=50))
    with_counter = decide(exhausted_sell(counter_opposite=80, absorption=50))
    assert with_counter.transition > without.transition
    assert with_counter.old_direction_confidence <= 35.0


def test_counter_buy_failure_cannot_force_buy():
    d = decide(Evidence(counter_opposite=0, reclaim=False, retest_held=False, persistence=1))
    assert not d.opposite_allowed


def test_sell_confidence_cannot_remain_100_during_high_exhaustion():
    d = decide(Evidence(exhaustion_override=86.0, continuation=100.0, counter_opposite=70.0))
    assert d.old_direction_confidence <= 35.0


def test_neutral_transition_allows_neither_direction():
    d = decide(exhausted_sell(retest_held=False, displacement=False))
    assert not d.continuation_allowed and not d.opposite_allowed


def test_fresh_buy_can_be_approved_before_h1_flips():
    d = decide(exhausted_sell(retest_held=True, displacement=True, remaining_reward_r=2.2, htf_direction=-1))
    assert d.opposite_allowed


def test_old_sell_state_cannot_reopen_after_buy_formation():
    d = decide(exhausted_sell(retest_held=True, displacement=True, remaining_reward_r=2.2))
    assert d.opposite_allowed and not d.continuation_allowed


def test_normal_pullback_does_not_flip_direction():
    d = decide(Evidence(absorption=30, structure_opposite=25, momentum_opposite=30, persistence=2))
    assert d.continuation_allowed and not d.opposite_allowed


def test_buy_exhaustion_is_symmetric():
    sell = decide(exhausted_sell())
    buy = decide(mirror(exhausted_sell()))
    assert (sell.lifecycle, sell.continuation_allowed, sell.opposite_preparing) == (
        buy.lifecycle,
        buy.continuation_allowed,
        buy.opposite_preparing,
    )


def test_transition_evidence_decay_restores_old_trend():
    old = decide(exhausted_sell())
    resumed = decide(Evidence(travel_atr=2.0, range_consumed=0.45, continuation=90, persistence=0))
    assert not old.continuation_allowed and resumed.continuation_allowed


def test_restart_rebuild_inputs_are_sufficient_and_do_not_lock_forever():
    reconstructed = decide(Evidence(travel_atr=4.5, range_consumed=0.85, continuation=40, failed_extremes=2, persistence=2))
    decayed = decide(Evidence(travel_atr=1.5, range_consumed=0.30, continuation=85))
    assert reconstructed.lifecycle in {"TREND_MATURE", "TREND_EXHAUSTING", "TRANSITION_NEUTRAL"}
    assert decayed.continuation_allowed


def test_actual_incident_replay_changes_only_late_decisions():
    replay = [
        ("major_fall", Evidence(travel_atr=1.8, range_consumed=0.45, continuation=88), "SELL"),
        ("mid_trend", Evidence(travel_atr=2.8, range_consumed=0.62, continuation=78), "SELL"),
        ("near_4000_exhaustion", exhausted_sell(counter_opposite=0, reclaim=False), "BLOCK_SELL"),
        ("counter_buy_wins", exhausted_sell(counter_opposite=75, retest_held=False), "WAIT"),
        ("first_bad_sell_0113", exhausted_sell(counter_opposite=62, retest_held=False), "BLOCK_SELL"),
        ("reclaim_retest", exhausted_sell(counter_opposite=55, retest_held=True, displacement=True, remaining_reward_r=2.0), "BUY"),
        ("second_bad_sell_0423", exhausted_sell(counter_opposite=45, retest_held=True, displacement=True, remaining_reward_r=1.8), "BUY"),
    ]
    results = []
    for name, evidence, _expected in replay:
        d = decide(evidence)
        new = "BUY" if d.opposite_allowed else "SELL" if d.continuation_allowed else "BLOCK_SELL" if not d.opposite_preparing else "WAIT"
        results.append((name, new))
    assert results == [
        ("major_fall", "SELL"),
        ("mid_trend", "SELL"),
        ("near_4000_exhaustion", "WAIT"),
        ("counter_buy_wins", "WAIT"),
        ("first_bad_sell_0113", "WAIT"),
        ("reclaim_retest", "BUY"),
        ("second_bad_sell_0423", "BUY"),
    ]


def test_actual_vps_fixture_blocks_both_proven_losing_sells():
    fixture = json.loads((ROOT / "tests/fixtures/xau_vps_transition_incident_20260713_14.json").read_text())
    decisions = {}
    for row in fixture:
        if "failed_extremes" not in row:
            continue
        d = decide(
            Evidence(
                exhaustion_override=row["exhaustion"],
                counter_opposite=row["counter_buy_score"],
                failed_extremes=row["failed_extremes"],
                reclaim=row["reclaim"],
                retest_held=row["retest_held"],
                displacement=row["displacement"],
                persistence=row["persistence"],
                remaining_reward_r=row["remaining_reward_r"],
                structure_opposite=65 if row["reclaim"] else 30,
                momentum_opposite=70 if row["displacement"] else 40,
            )
        )
        decisions[row["stage"]] = d
    assert decisions["healthy_sell_campaign"].continuation_allowed
    assert not decisions["proven_losing_sell_3997"].continuation_allowed
    assert not decisions["proven_losing_sell_4015"].continuation_allowed
    assert decisions["counter_buy_tp"].old_direction_confidence <= 35.0


def test_source_declares_real_mode_and_final_authority():
    source = EA.read_text()
    assert "enum ENUM_ADAPTIVE_TRANSITION_MODE" in source
    assert "InpAdaptiveTransitionMode = ADAPTIVE_TRANSITION_ACTIVE" in source
    assert "ADAPTIVE_TRANSITION_ACTIVE_ASSERTION_PASSED" in source
    assert 'InpAdaptiveTransitionPresetId       = "XAUUSD_AI_Sniper_EA_v6.23.1_ACTIVE.set"' in source
    assert "XAU_FinalAdaptiveDirectionDecision" in source
    assert "FINAL_DIRECTION_DECISION" in source


def test_all_autonomous_entry_sources_obey_one_choke_point():
    source = EA.read_text()
    open_start = source.index("bool OpenTrade(")
    open_trade = source[open_start : source.index("void LogExit", open_start)]
    pyramid = source[source.index("void CheckPyramidOpportunity()") : source.index("bool EPF_IsEliteGrade")]
    assert "XAU_FinalAdaptiveDirectionDecision(signal, \"OPEN_TRADE\"" in open_trade
    assert "XAU_FinalAdaptiveDirectionDecision(dir, \"PYRAMID\"" in pyramid
    assert 'XAU_FinalAdaptiveDirectionDecision(signal,"FINAL_PRE_SEND"' in open_trade
    assert 'XAU_FinalAdaptiveDirectionDecision(dir,"PYRAMID_FINAL_PRE_SEND"' in pyramid
    assert "[ACTIVE_FINAL_ENTRY_ASSERTION]" in source
    for source_name in ("PRIMARY", "RE_ENTRY", "RECOVERY", "RETRY", "PYRAMID"):
        assert source_name in source


def test_risk_and_timing_contracts_are_unchanged():
    source = EA.read_text()
    assert "InpNormalRiskPct       = 15.0" in source
    assert "XAU_ENTRY_DELAY_ABSOLUTE_FLOOR_SEC   120.0" in source
    assert "XAU_ENTRY_DELAY_ABSOLUTE_CEILING_SEC 180.0" in source
    assert "FULL_RISK_BINARY" in source
    assert "No silent 0.01 fallback" in source


def test_active_configuration_fails_closed_without_becoming_blanket_strict():
    source = EA.read_text()
    validator = source[source.index("bool XAU_ValidateAdaptiveTransitionConfig") : source.index("string XAU_ATLifecycleName")]
    assert "return INIT_PARAMETERS_INCORRECT" in source
    assert "InpTransitionExhaustThreshold-70.0" in validator
    assert "ACTIVE requires transition position authority" in validator
    assert "ACTIVE preset identity does not match" in validator
    final = source[source.index("bool XAU_FinalAdaptiveDirectionDecision") : source.index("//+------------------------------------------------------------------+", source.index("bool XAU_FinalAdaptiveDirectionDecision"))]
    assert "exhaustionProbability>=60.0 && d.exhaustionProbability<70.0" in final
    assert 'if(source=="PYRAMID") allowed=false' in final
    assert "continuationConfidence<55.0 || d.remainingRewardR<InpTransitionMinRewardR" in final
    assert "if(oldDirection && d.exhaustionProbability>=70.0) allowed=false" in final


def test_production_active_preset_cannot_silently_select_shadow():
    preset = (ROOT / "config/XAUUSD_AI_Sniper_EA_v6.23.1_ACTIVE.set").read_text()
    assert "InpAdaptiveTransitionMode=2" in preset
    assert "InpAdaptiveTransitionMode=1" not in preset
    assert "InpTransitionExhaustThreshold=70.0" in preset
    assert "InpTransitionMatureThreshold=60.0" in preset


def test_counter_outcome_invalidates_same_bar_lifecycle_cache():
    source = EA.read_text()
    record = source[source.index("void XAU_RecordCounterTransitionEvidence") : source.index("int XAU_ATDominantDirection")]
    assert "g_transitionLastComputedBar = 0" in record
    assert record.index("g_transitionLastComputedBar = 0") < record.index("XAU_ATSavePersistentState()")


def test_pending_recheck_cadence_uses_adaptive_reversal_delay():
    source = EA.read_text()
    cadence = source[source.index("double pendingRequiredDelay") : source.index("// v6.17.13 FIX", source.index("double pendingRequiredDelay"))]
    assert "XAU_EffectiveAdaptiveEntryDelaySeconds(g_pendingEntryConfirm.dir)" in cadence
    assert ">= pendingRequiredDelay" in cadence
    assert "PENDING_CONFIRM_DUE_MIDBAR" in cadence


def test_confirmed_reversal_has_dedicated_authoritative_execution_lane():
    source = EA.read_text()
    start = source.index("// v6.23.1 centralized ACTIVE reversal lane")
    end = source.index("// June 17-18 reconstruction", start)
    lane = source[start:end]
    assert "entryExecutionBlocked" in lane
    assert "spreadBlocksEntry" in lane
    assert "IsNewsSafe()" in lane
    assert "XAUEntryTimingGuard" in lane
    assert "XAU_TimingEngineConfirmsEntry" in lane
    assert "OpenTrade(signal,bufATR[1],setupName+\" [A+]\",1.0)" in lane
    assert "return; // never fall back into the legacy trend-following gauntlet" in lane
    assert source.index("OpenTrade(signal,bufATR[1],setupName+\" [A+]\",1.0)", start) < end


def test_active_central_authority_cannot_be_overruled_by_legacy_direction_guard():
    source = EA.read_text()
    open_trade = source[source.index("bool OpenTrade(") : source.index("// v5.8.6 — Execution-layer hedge backstop")]
    assert "adaptiveCentralAuthority=(InpAdaptiveTransitionMode==ADAPTIVE_TRANSITION_ACTIVE" in open_trade
    assert "DIRECTION_QUALITY OBSERVATION_ONLY" in open_trade
    assert "!isManualOverride && !adaptiveCentralAuthority" in open_trade


def test_backend_distribution_mirror_is_exact():
    backend = ROOT / "backend/ea_code/XAUUSD_AI_Sniper_EA.mq5"
    assert backend.read_bytes() == EA.read_bytes()


def test_only_three_order_open_owners_exist_and_are_scoped():
    source = EA.read_text()
    # Normal/re-entry/recovery converge on OpenTrade; pyramids have the same
    # final authority; Counter remains isolated by design under its own magic.
    assert len(re.findall(r"\btrade\.Buy\s*\(", source)) == 3
    assert len(re.findall(r"\btrade\.Sell\s*\(", source)) == 3
    pyramid = source[source.index("void CheckPyramidOpportunity()") : source.index("bool EPF_IsEliteGrade")]
    assert "XAU_FinalAdaptiveDirectionDecision(dir, \"PYRAMID\"" in pyramid
    assert "trade.Buy (addLot" in pyramid and "trade.Sell(addLot" in pyramid
    open_start = source.index("bool OpenTrade(int signal")
    open_trade = source[open_start : source.index("void LogExit", open_start)]
    assert "XAU_FinalAdaptiveDirectionDecision(signal, \"OPEN_TRADE\"" in open_trade
    counter_start = source.index("void XAU_TryCounterExcursionEntry")
    counter = source[counter_start : source.index("bool XAU_ManageCounterExcursionPosition", counter_start)]
    assert "trade.SetExpertMagicNumber(InpCounterExcursionMagicNumber)" in counter
    assert "trade.SetExpertMagicNumber(InpMagicNumber)" in counter
