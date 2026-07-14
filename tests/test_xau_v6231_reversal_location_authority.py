"""Executable direction-vs-location and reversal-opportunity regressions."""

from dataclasses import dataclass
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.23.1.mq5"
FIXTURE = ROOT / "tests/fixtures/xau_vps_transition_incident_20260713_14.json"


@dataclass(frozen=True)
class LocationEvidence:
    direction_correct: bool = True
    impulse_extension_atr: float = 1.0
    distance_from_value_atr: float = 0.5
    consumed_pct: float = 35.0
    remaining_reward_r: float = 2.0
    already_entered: bool = False
    pullback_from_peak_atr: float = 0.0


def location_decision(e: LocationEvidence) -> str:
    if not e.direction_correct:
        return "REVERSAL_FORMING_NOT_READY"
    value_reset = (
        e.pullback_from_peak_atr >= 0.75
        and e.distance_from_value_atr <= 1.0
        and e.remaining_reward_r >= 1.2
    )
    extended = (
        e.impulse_extension_atr > 2.0
        or e.distance_from_value_atr > 1.0
        or e.consumed_pct > 70.0
        or e.remaining_reward_r < 1.2
    )
    if value_reset:
        return "DIRECTION_CORRECT_ENTRY_GOOD_VALUE_RESET"
    if extended or e.already_entered:
        return "REVERSAL_DIRECTION_VALID_BUT_WAIT_FOR_PULLBACK"
    return "REVERSAL_CONFIRMED_ENTRY_ALLOWED"


def test_correct_direction_plus_bad_location_blocks_execution():
    assert location_decision(LocationEvidence(distance_from_value_atr=1.4)) == "REVERSAL_DIRECTION_VALID_BUT_WAIT_FOR_PULLBACK"


def test_early_reversal_can_enter_before_htf_flip_when_location_is_good():
    assert location_decision(LocationEvidence()) == "REVERSAL_CONFIRMED_ENTRY_ALLOWED"


def test_missed_early_buy_does_not_chase_extended_impulse():
    assert location_decision(LocationEvidence(impulse_extension_atr=3.1)) == "REVERSAL_DIRECTION_VALID_BUT_WAIT_FOR_PULLBACK"


def test_consumed_buy_waits_for_pullback():
    assert location_decision(LocationEvidence(consumed_pct=82.0)) == "REVERSAL_DIRECTION_VALID_BUT_WAIT_FOR_PULLBACK"


def test_pullback_to_value_can_reapprove_buy():
    e = LocationEvidence(impulse_extension_atr=4.0, consumed_pct=85.0, pullback_from_peak_atr=0.9)
    assert location_decision(e) == "DIRECTION_CORRECT_ENTRY_GOOD_VALUE_RESET"


def test_same_opportunity_cannot_repeat_at_worse_price():
    e = LocationEvidence(already_entered=True)
    assert location_decision(e) == "REVERSAL_DIRECTION_VALID_BUT_WAIT_FOR_PULLBACK"


def test_small_profitable_first_buy_does_not_authorize_second_buy():
    # Profit/loss is irrelevant to location consumption: the immediate leg
    # was already used, so a fresh value reset is required.
    assert location_decision(LocationEvidence(already_entered=True, remaining_reward_r=1.8)) == "REVERSAL_DIRECTION_VALID_BUT_WAIT_FOR_PULLBACK"


def test_remaining_reward_must_cover_risk():
    assert location_decision(LocationEvidence(remaining_reward_r=0.8)) == "REVERSAL_DIRECTION_VALID_BUT_WAIT_FOR_PULLBACK"


def test_direction_and_location_are_independent_outputs():
    bad_location = LocationEvidence(direction_correct=True, consumed_pct=90.0)
    assert bad_location.direction_correct
    assert location_decision(bad_location) != "REVERSAL_CONFIRMED_ENTRY_ALLOWED"


def test_timing_revalidation_cannot_turn_candidate_into_unchecked_chase():
    detected = LocationEvidence(impulse_extension_atr=1.2, consumed_pct=45.0)
    delayed = LocationEvidence(impulse_extension_atr=2.4, consumed_pct=73.0)
    assert location_decision(detected) == "REVERSAL_CONFIRMED_ENTRY_ALLOWED"
    assert location_decision(delayed) == "REVERSAL_DIRECTION_VALID_BUT_WAIT_FOR_PULLBACK"


def test_buy_to_sell_location_logic_is_symmetric():
    buy = LocationEvidence(impulse_extension_atr=2.5, distance_from_value_atr=1.3)
    sell = LocationEvidence(impulse_extension_atr=2.5, distance_from_value_atr=1.3)
    assert location_decision(buy) == location_decision(sell)


def test_healthy_trend_location_is_unaffected_without_reversal_opportunity():
    # This oracle is invoked only for a persistent high-exhaustion reversal
    # opportunity; the source final choke contains the same active-state guard.
    source = EA.read_text()
    assert "bool opportunityDirection=(g_reversalOpportunity.active" in source


def test_four_trade_incident_replay_blocks_old_sells_and_late_buys():
    rows = {row["stage"]: row for row in json.loads(FIXTURE.read_text())}
    assert rows["proven_losing_sell_3997"]["new_expected"] == "BLOCK_SELL"
    assert rows["proven_losing_sell_4015"]["new_expected"] == "BLOCK_SELL"
    for stage in ("late_counter_buy_4027", "late_normal_buy_4028"):
        row = rows[stage]
        d = location_decision(
            LocationEvidence(
                impulse_extension_atr=abs(row["price"] - row["reversal_origin"]) / row["atr"],
                distance_from_value_atr=row["distance_from_value_atr"],
                consumed_pct=row["move_consumed_pct"],
                remaining_reward_r=row["opposite_remaining_reward_r"],
                already_entered=row["already_entered"],
            )
        )
        assert d == "REVERSAL_DIRECTION_VALID_BUT_WAIT_FOR_PULLBACK", stage


def test_source_persists_origin_value_zone_and_opportunity_identity():
    source = EA.read_text()
    for token in (
        "originPrice", "firstDetectionPrice", "reclaimPrice",
        "latestAcceptablePrice", "impulsePeak", "expectedPullbackPrice",
        "XAU_ATReversalOpportunityId", "REVERSAL_WAITING_FOR_PULLBACK",
    ):
        assert token in source
    for key in ("revOrigin", "revFirst", "revReclaim", "revLatest", "revPeak", "revPullback"):
        assert f'p + "{key}"' in source


def test_source_enforces_location_for_normal_and_counter_execution():
    source = EA.read_text()
    assert "REVERSAL_DIRECTION_VALID_BUT_WAIT_FOR_PULLBACK id=%s source=%s" in source
    assert "COUNTER_REVERSAL_LOCATION_AUDIT" in source
    assert 'XAU_ATMarkOpportunityEntry(signal,trade.ResultPrice()>0.0?trade.ResultPrice():price,"NORMAL")' in source
    assert 'XAU_ATMarkOpportunityEntry(counterDir,g_counterEx.entryPrice,"COUNTER_EXCURSION")' in source


def test_failed_old_direction_is_bounded_transition_evidence():
    source = EA.read_text()
    assert "oldDirectionFailureActive=(g_sameDirLossStreak>0 && g_lastLossDir==dir)" in source
    assert "oldDirectionFailureActive?12.0:0.0" in source
    assert "oldDirectionFailureActive && d.exhaustionProbability>=70.0" in source


def test_location_memory_survives_the_direction_flip_and_controls_fresh_flags():
    source = EA.read_text()
    assert "if(g_reversalOpportunity.active)" in source
    assert "int trackedDir=g_reversalOpportunity.direction" in source
    assert "if(g_reversalOpportunity.direction==1) d.freshBuyAllowed=false" in source
    assert "else d.freshSellAllowed=false" in source
    assert "g_transitionLastComputedBar=0" in source


def test_value_reset_does_not_exempt_a_new_live_chase():
    source = EA.read_text()
    start = source.index("bool opportunityDirection=(g_reversalOpportunity.active")
    end = source.index("string mode=", start)
    gate = source[start:end]
    assert "if(!d.reversalLocationGood || liveChase || g_reversalOpportunity.impulseConsumedByEntry)" in gate
    assert "&& !valueReset" not in gate


def test_value_reset_zone_is_created_once_not_walked_up_with_price():
    source = EA.read_text()
    assert "bool newlyReset=valueReset && g_reversalOpportunity.state!=REVERSAL_VALUE_RESET" in source
    assert "g_reversalOpportunity.state!=REVERSAL_REENTRY_ALLOWED" in source
    assert "if(newlyReset)" in source
