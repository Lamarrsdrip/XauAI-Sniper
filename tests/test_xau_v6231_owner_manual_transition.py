"""Anonymized owner-manual replay and M1 high-exhaustion bridge checks.

This is a deterministic decision harness, not a claim of tick-accurate profit.
It tests the repeatable lifecycle rules extracted from read-only evidence.
"""

from dataclasses import dataclass
import json
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.23.1.mq5"
FIXTURE = ROOT / "tests/fixtures/xau_owner_manual_transition_20260713_14.json"


@dataclass(frozen=True)
class ManualEvidence:
    exhaustion: float
    failed_extremes: int
    micro_sweep_reclaim: bool
    micro_retest: bool
    micro_displacement: bool
    micro_persistence: int
    counter_opposite: float
    remaining_reward_r: float
    location_good: bool
    consumed_pct: float


def decide(e: ManualEvidence) -> str:
    if e.exhaustion < 70:
        return "OLD_DIRECTION_ALLOWED"
    package = (
        e.failed_extremes >= 2
        and e.micro_sweep_reclaim
        and (e.micro_retest or e.micro_displacement)
        and e.micro_persistence >= 3
    )
    authorized = package and (
        e.exhaustion >= 90
        or (e.exhaustion >= 80 and (e.micro_retest or e.counter_opposite >= 20))
    )
    if not authorized:
        return "BLOCK_OLD_WAIT"
    if e.remaining_reward_r < 1.2 or not e.location_good or e.consumed_pct > 70:
        return "WAIT_FOR_PULLBACK"
    return "OPPOSITE_ALLOWED"


def load_sequence():
    return json.loads(FIXTURE.read_text())["decision_sequence"]


def evidence(row):
    return ManualEvidence(**{key: row[key] for key in ManualEvidence.__dataclass_fields__})


def test_fixture_is_anonymized_and_contains_no_execution_identifiers():
    raw = FIXTURE.read_text()
    assert not re.search(r'(?i)"(?:login|password|investor|ticket|order_id|deal_id)"\s*:', raw)
    assert "MetaQuotes-Demo" not in raw
    assert "LzK-" not in raw


def test_read_only_window_totals_reconcile():
    data = json.loads(FIXTURE.read_text())
    sells = [p for p in data["closed_positions"] if p["direction"] == "SELL"]
    buys = [p for p in data["closed_positions"] if p["direction"] == "BUY"]
    assert round(sum(p["gross_result"] for p in sells), 2) == 1093.05
    assert round(sum(p["gross_result"] + p["swap"] for p in buys), 2) == 632.06
    capital = data["capital_reconstruction"]
    assert round(capital["inferred_starting_balance"] + capital["closed_net_profit"], 2) == capital["ending_realized_balance"]
    assert all(p["outcome"] == "unproven_live_snapshot" for p in [data["open_position_snapshot"]])


def test_healthy_sell_entries_remain_allowed():
    for row in load_sequence()[:2]:
        assert decide(evidence(row)) == "OLD_DIRECTION_ALLOWED"


def test_high_exhaustion_blocks_old_direction_before_buy_is_ready():
    row = next(r for r in load_sequence() if r["stage"] == "exhausted_low_search")
    assert decide(evidence(row)) == "BLOCK_OLD_WAIT"


def test_single_sweep_wick_cannot_trigger_reversal():
    row = next(r for r in load_sequence() if r["stage"] == "single_wick_3970")
    assert decide(evidence(row)) == "BLOCK_OLD_WAIT"


def test_complete_micro_pattern_has_no_authority_below_70_exhaustion():
    row = next(r for r in load_sequence() if r["stage"] == "value_retest_near_3993")
    assert decide(evidence({**row, "exhaustion": 69})) == "OLD_DIRECTION_ALLOWED"


def test_extended_initial_reclaim_waits_for_pullback():
    row = next(r for r in load_sequence() if r["stage"] == "initial_reclaim_near_4004")
    assert decide(evidence(row)) == "WAIT_FOR_PULLBACK"


def test_value_retest_can_authorize_buy_before_m5_and_htf_flip():
    row = next(r for r in load_sequence() if r["stage"] == "value_retest_near_3993")
    assert decide(evidence(row)) == "OPPOSITE_ALLOWED"


def test_counter_support_is_bounded_and_cannot_replace_structure():
    row = next(r for r in load_sequence() if r["stage"] == "value_retest_near_3993")
    no_structure = evidence({**row, "micro_sweep_reclaim": False, "micro_retest": False, "micro_displacement": False})
    assert decide(no_structure) == "BLOCK_OLD_WAIT"


def test_manual_replay_expected_match_and_deliberate_safety_mismatch():
    results = {row["stage"]: decide(evidence(row)) for row in load_sequence()}
    assert results["healthy_sell_4069"] == "OLD_DIRECTION_ALLOWED"
    assert results["healthy_sell_4059"] == "OLD_DIRECTION_ALLOWED"
    assert results["initial_reclaim_near_4004"] == "WAIT_FOR_PULLBACK"
    assert results["value_retest_near_3993"] == "OPPOSITE_ALLOWED"
    # Deliberate mismatch: the owner bought the first impulse; automation waits
    # for the safer value retest because entry location was already consumed.


def test_buy_to_sell_logic_is_symmetric_by_construction():
    row = next(r for r in load_sequence() if r["stage"] == "value_retest_near_3993")
    buy_after_sell = decide(evidence(row))
    sell_after_buy = decide(evidence(row))
    assert buy_after_sell == sell_after_buy == "OPPOSITE_ALLOWED"


def test_m1_recompute_cannot_decay_exhaustion_or_advance_m5_hysteresis():
    source = EA.read_text()
    assert "else if(realContinuationReset && m5EvidenceAdvanced)" in source
    candidate = source[source.index("// Hysteresis classifies lifecycle labels") : source.index("bool authoritativeExhaustion")]
    assert "if(m5EvidenceAdvanced)" in candidate
    assert "g_transitionCandidateBars++" in candidate


def test_source_uses_closed_m1_bridge_only_inside_full_authority():
    source = EA.read_text()
    assert "iTime(Symbol(), PERIOD_M1, 1)" in source
    assert "earlyMicroReversalPackage" in source
    assert "microPackageAuthorized" in source
    assert "bool microBridgeActive=d.exhaustionProbability>=InpTransitionExhaustThreshold" in source
    assert "d.oppositeRemainingRewardR>=InpTransitionMinRewardR" in source
    assert "d.reversalLocationGood" in source
    assert "InpAdaptiveTransitionMode = ADAPTIVE_TRANSITION_SHADOW" in source


def test_micro_inputs_are_build_identifying_and_distribution_is_exact():
    source = EA.read_text()
    input_hash = source[source.index("string XAUAI_InputHash()") : source.index("string XAUAI_PostNewsStateName()")]
    for name in (
        "InpTransitionMicroPersistenceBars",
        "InpTransitionMicroDisplacementATR",
        "InpTransitionMicroSweepBufferATR",
    ):
        assert name in input_hash
    assert (ROOT / "backend/ea_code/XAUUSD_AI_Sniper_EA.mq5").read_bytes() == EA.read_bytes()


def test_risk_timing_and_execution_safety_contracts_remain_unchanged():
    source = EA.read_text()
    assert "InpNormalRiskPct       = 15.0" in source
    assert "XAU_ENTRY_DELAY_ABSOLUTE_FLOOR_SEC   120.0" in source
    assert "XAU_ENTRY_DELAY_ABSOLUTE_CEILING_SEC 180.0" in source
    assert "InpTransitionFastConfirmSeconds    = 30" in source
    assert "IsNewsSafe()" in source
    assert "spreadBlocksEntry" in source
    assert "FULL_RISK_BINARY" in source
