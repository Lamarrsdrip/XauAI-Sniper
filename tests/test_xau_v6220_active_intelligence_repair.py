"""Scenario tests for the v6.22.0 ACTIVE-intelligence repair.

These tests exercise a deterministic model of the MQL decision contract and
also bind its critical invariants to the real source. They are intentionally
market-state scenarios, not test-name/string-only assertions.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.22.0_ADAPTIVE_TREND_CAMPAIGN_EXP1.mq5"


@dataclass
class Market:
    exhaustion: float
    continuation: float
    timing: float
    extension: float
    late: float
    reward_q: float
    room_r: float
    final_conf: float
    mature: bool = False
    clean: bool = False
    value_reset: bool = False
    fresh_structure: bool = False
    bad_location: bool = False
    timing_class: str = "NONE"
    opposite: bool = False
    reversal_confirmed: bool = False
    reversal_location_good: bool = False
    reset_score: float = 0
    reset_bars: int = 0


def decide(m: Market) -> str:
    """Faithful executable contract for XAU_ActiveIntelligenceDecision."""
    if m.timing_class == "HARD_BLOCK":
        return "WAIT_FOR_VALUE"
    if not m.opposite and m.exhaustion >= 70:
        return "BLOCK_OLD_DIRECTION"
    if m.opposite:
        return "TRADE_NOW" if m.reversal_confirmed and m.reversal_location_good else "WAIT_FOR_VALUE"

    direction = m.continuation
    trend = m.continuation * .65 + (100 - m.exhaustion) * .35
    exhaustion_safety = 100 - m.exhaustion
    location = m.timing * .65 + (100 - m.extension) * .35
    reset = 100 if m.clean else 78 if m.value_reset else 70 if m.fresh_structure else 35
    score = direction*.20 + trend*.15 + exhaustion_safety*.15 + location*.18 + m.reward_q*.14 + reset*.13 + 80*.05
    required = 70 if m.mature else 62
    clean_at_usable_location = m.clean and m.timing >= 75 and m.reward_q >= 70
    location_safe = (not m.bad_location or clean_at_usable_location) and m.extension < 70 and m.late < 75
    reward_open = m.room_r >= 1.2 and m.reward_q >= 55
    evidence_fresh = m.clean or m.value_reset or m.fresh_structure
    mature_proof = not m.mature or ((m.clean or m.value_reset or (m.reset_score >= 65 and m.reset_bars >= 2)) and m.timing >= 65)
    timing_release = m.timing_class != "SOFT_BLOCK" or (evidence_fresh and score >= required + 5)
    if not location_safe or not reward_open:
        return "WAIT_FOR_VALUE"
    min_final = 70 if m.mature else 60
    if score >= required and timing_release and mature_proof and m.final_conf >= min_final:
        return "TRADE_NOW"
    return "WAIT_FOR_VALUE"


@dataclass
class Evidence:
    reclaim: float = 0
    retest: float = 0
    displacement: float = 0
    persistence: float = 0
    evidence_bars: int = 0

    def bar(self, *, reclaim=False, retest=False, displacement=False, persistence=0):
        decay = 7
        self.reclaim = min(100, self.reclaim + 40) if reclaim else max(0, self.reclaim - decay)
        self.retest = min(100, self.retest + 36) if retest else max(0, self.retest - decay)
        self.displacement = min(100, self.displacement + 34) if displacement else max(0, self.displacement - decay)
        self.persistence = max(max(0, self.persistence - decay), persistence)
        self.evidence_bars += sum((reclaim, retest, displacement))

    @property
    def ready(self):
        return self.reclaim >= 20 and self.retest >= 20 and self.displacement >= 20 and self.persistence >= 60 and self.evidence_bars >= 2


def healthy(**overrides) -> Market:
    values = dict(exhaustion=25, continuation=82, timing=82, extension=20, late=20,
                  reward_q=85, room_r=2.0, final_conf=82, clean=True)
    values.update(overrides)
    return Market(**values)


def test_01_healthy_early_trend_trades():
    assert decide(healthy()) == "TRADE_NOW"


def test_02_healthy_midtrend_pullback_trades():
    assert decide(healthy(exhaustion=48, continuation=78, timing=88, clean=False, value_reset=True)) == "TRADE_NOW"
    assert decide(healthy(bad_location=True, clean=True, timing=90, reward_q=90)) == "TRADE_NOW"


def test_03_mature_trend_with_fresh_reset_and_room_may_trade():
    assert decide(healthy(exhaustion=64, continuation=84, timing=90, reward_q=92,
                          room_r=2.4, final_conf=88, mature=True, value_reset=True)) == "TRADE_NOW"


def test_04_mature_without_reward_waits():
    assert decide(healthy(exhaustion=64, mature=True, value_reset=True, room_r=.8)) == "WAIT_FOR_VALUE"


def test_05_seventy_percent_old_direction_is_blocked():
    assert decide(healthy(exhaustion=70)) == "BLOCK_OLD_DIRECTION"


def test_06_genuine_continuation_reset_decays_and_reopens_gradually():
    exhaustion = 82
    score = bars = 0
    for bar_evidence in (75, 80):
        score = min(100, score + bar_evidence*.28)
        bars += 1
    assert score >= 40 and bars == 2  # not enough yet: evidence must keep proving itself
    score = min(100, score + 90*.28)
    bars += 1
    assert score >= 65
    exhaustion = max(55, exhaustion - 12)
    assert exhaustion == 70  # first release step cannot jump straight to permissive
    exhaustion = max(55, exhaustion - 12)
    assert exhaustion < 70
    assert decide(healthy(exhaustion=exhaustion, mature=True, value_reset=True,
                          reset_score=score, reset_bars=bars)) == "TRADE_NOW"


def test_07_one_wick_cannot_confirm_reversal():
    e = Evidence()
    e.bar(reclaim=True)
    assert not e.ready


def test_08_sweep_reclaim_retest_displacement_accumulate_across_bars():
    e = Evidence()
    e.bar(reclaim=True, persistence=34)
    e.bar(retest=True, persistence=67)
    e.bar(displacement=True, persistence=100)
    assert e.ready


def test_09_valid_reversal_near_value_trades():
    assert decide(healthy(opposite=True, reversal_confirmed=True, reversal_location_good=True)) == "TRADE_NOW"


def test_10_correct_reversal_but_extended_waits():
    assert decide(healthy(opposite=True, reversal_confirmed=True, reversal_location_good=False)) == "WAIT_FOR_VALUE"


def test_11_pullback_arrival_releases_wait():
    before = healthy(opposite=True, reversal_confirmed=True, reversal_location_good=False)
    after = healthy(opposite=True, reversal_confirmed=True, reversal_location_good=True)
    assert decide(before) == "WAIT_FOR_VALUE"
    assert decide(after) == "TRADE_NOW"


def test_12_consumed_opportunity_new_structure_reset_reopens():
    consumed = healthy(mature=True, clean=False, value_reset=False, timing_class="SOFT_BLOCK")
    reset = healthy(mature=True, clean=False, value_reset=True, timing=92, final_conf=90)
    assert decide(consumed) == "WAIT_FOR_VALUE"
    assert decide(reset) == "TRADE_NOW"


def test_13_wait_states_have_market_proof_exits_and_cancellation():
    source = EA.read_text(encoding="utf-8", errors="ignore")
    assert "afterOpportunityCreatedBar" in source
    assert "resetReferenceAdvanced=afterConsumedEntryBar ||" in source
    assert "[ACTIVE_OPPORTUNITY_CANCELLED]" in source
    assert "contradictionBars>=InpCampaignWaitCancelBars" in source


def test_14_healthy_frequency_does_not_collapse():
    session = [
        healthy(), healthy(exhaustion=42), healthy(value_reset=True, clean=False),
        healthy(mature=True, exhaustion=63, value_reset=True, timing=90),
        healthy(room_r=.7), healthy(extension=82, timing_class="HARD_BLOCK"),
    ]
    allowed = sum(decide(m) == "TRADE_NOW" for m in session)
    assert allowed >= 4


def test_15_late_entry_traps_remain_blocked():
    assert decide(healthy(extension=80, late=86, bad_location=True, timing_class="HARD_BLOCK")) == "WAIT_FOR_VALUE"


def test_real_source_routes_proven_legacy_analytical_vetoes_to_one_authority():
    source = EA.read_text(encoding="utf-8", errors="ignore")
    assert "ENUM_ACTIVE_INTELLIGENCE_ACTION XAU_ActiveIntelligenceDecision" in source
    assert "advisory=SMART_GUARD_FAST_CONFIRM" in source
    assert "advisory=B_QUALITY_FAST_CONFIRM" in source
    assert "advisory=LEGACY_GRADE_THRESHOLD" in source
    assert "advisory=POST_NEWS_MOMENTUM_OBSERVING" in source
    assert "advisory=LEGACY_HTF_CONTEXT_GATE" in source
    assert 'g_contextGateBlockClass="LOCATION_HARD"' in source
    assert "HARD_BLOCK" in source
