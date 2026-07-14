"""Owner-manual replay for the isolated longer-hold v6.22.0 experiment."""
from dataclasses import dataclass
import json
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.22.0_ADAPTIVE_TREND_CAMPAIGN_EXP1.mq5"
FIXTURE = ROOT / "tests/fixtures/xau_owner_manual_transition_20260713_14.json"


@dataclass(frozen=True)
class Evidence:
    exhaustion: float
    failed_extremes: int
    sweep: bool
    retest: bool
    displacement: bool
    persistence: int
    reward_r: float
    location_good: bool
    consumed_pct: float


def decide(e: Evidence) -> str:
    if e.exhaustion < 70:
        return "OLD_ALLOWED"
    package = e.failed_extremes >= 2 and e.sweep and (e.retest or e.displacement) and e.persistence >= 3
    authorized = package and (e.exhaustion >= 90 or (e.exhaustion >= 80 and e.retest))
    if not authorized:
        return "BLOCK_OLD_WAIT"
    if e.reward_r < 1.2 or not e.location_good or e.consumed_pct > 70:
        return "WAIT_PULLBACK"
    return "OPPOSITE_ALLOWED"


def decide_for_old_direction(e: Evidence, old_direction: str) -> str:
    action = decide(e)
    if action != "OPPOSITE_ALLOWED":
        return action
    return "BUY" if old_direction == "SELL" else "SELL"


def rows():
    return json.loads(FIXTURE.read_text())["sequence"]


def ev(row):
    return Evidence(**{k: row[k] for k in Evidence.__dataclass_fields__})


def test_fixture_is_anonymized_and_reconciles_capital_growth():
    raw = FIXTURE.read_text()
    assert not re.search(r'(?i)"(?:login|password|investor|ticket|order_id|deal_id)"\s*:', raw)
    data = json.loads(raw)
    assert round(sum(x["gross"] + x["swap"] for x in data["closed"]), 2) == 1725.11
    assert round(data["capital"]["inferred_start"] + data["capital"]["closed_net"], 2) == data["capital"]["ending_balance"]


def test_manual_sequence_replay_matches_expected_safe_campaign_decisions():
    assert {r["stage"]: decide(ev(r)) for r in rows()} == {r["stage"]: r["expected"] for r in rows()}


def test_69_percent_complete_micro_pattern_cannot_override_healthy_campaign():
    template = next(r for r in rows() if r["stage"] == "value_retest_3993")
    assert decide(ev({**template, "exhaustion": 69})) == "OLD_ALLOWED"


def test_one_wick_does_not_reverse_and_3993_value_retest_can():
    wick = next(r for r in rows() if r["stage"] == "single_sweep_wick")
    value = next(r for r in rows() if r["stage"] == "value_retest_3993")
    assert decide(ev(wick)) == "BLOCK_OLD_WAIT"
    assert decide(ev(value)) == "OPPOSITE_ALLOWED"


def test_first_reclaim_can_be_right_direction_but_bad_automated_location():
    reclaim = next(r for r in rows() if r["stage"] == "first_reclaim_4004")
    assert reclaim["owner"] == "BUY"
    assert decide(ev(reclaim)) == "WAIT_PULLBACK"


def test_buy_to_sell_transition_is_symmetric():
    value = next(r for r in rows() if r["stage"] == "value_retest_3993")
    assert decide_for_old_direction(ev(value), "SELL") == "BUY"
    assert decide_for_old_direction(ev(value), "BUY") == "SELL"


def test_experiment_keeps_long_hold_campaign_owner_and_full_risk_contract():
    source = EA.read_text()
    assert "ADAPTIVE_TREND_CAMPAIGN_MANAGER" in source
    assert "InpNormalRiskPct       = 15.0" in source
    assert "CAMPAIGN_THESIS_CONFIRMED" in source
    assert "CAMPAIGN_EXPANSION" in source
    assert "CAMPAIGN_MATURE_TREND" in source
    assert "XAU_Campaign_ApplyTransitionPositionAuthority" in source
    assert "XAU_Campaign_Finalize" in source
    assert "counter=REMOVED_BY_EXPERIMENT_CONTRACT" in source


def test_micro_bridge_cannot_replace_campaign_close_or_broker_safety():
    source = EA.read_text()
    assert "bool microBridgeActive=d.exhaustionProbability>=InpCampaignTransitionExhaustAt" in source
    assert "if(InpCampaignTransitionMode!=CAMPAIGN_TRANSITION_ACTIVE || !InpCampaignTransitionExitAuthority || !oldDirection)" in source
    assert "entryExecutionBlocked" in source
    assert "spreadBlocksEntry" in source
    assert "IsNewsSafe()" in source
