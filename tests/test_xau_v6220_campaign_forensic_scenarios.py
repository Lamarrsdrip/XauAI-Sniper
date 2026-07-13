"""Executable forensic scenarios for the isolated v6.22.0 campaign experiment.

These models independently exercise the numerical/state invariants implemented
in MQL5.  Static call-path assertions remain in the experiment's companion test
files; this suite supplies broker variants, generated price paths, persistence,
and rejection/retry scenarios.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from hashlib import sha256
import json
import math
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.22.0_ADAPTIVE_TREND_CAMPAIGN_EXP1.mq5"
PROD = ROOT / "XAUUSD_AI_Sniper_EA_v6.21.3.mq5"
MIRROR = ROOT / "backend/ea_code/XAUUSD_AI_Sniper_EA.mq5"
PRODUCTION_SHA256 = "9e6d9712d56d55124880feb0235067f4b92b8528b1c3dded00797f121a57903e"


@dataclass(frozen=True)
class Broker:
    tick_size: float
    tick_value: float
    min_lot: float
    max_lot: float
    step: float
    margin_per_lot: float


def money_per_lot(distance: float, broker: Broker) -> float:
    assert distance > 0 and broker.tick_size > 0 and broker.tick_value > 0
    return distance / broker.tick_size * broker.tick_value


def floor_volume(raw: float, broker: Broker) -> float:
    # epsilon only offsets binary representation; it cannot reach a new step.
    lots = math.floor((raw + 1e-12) / broker.step) * broker.step
    if lots < broker.min_lot - 1e-12 or lots > broker.max_lot + 1e-12:
        return 0.0
    return round(lots, 8)


def full_risk_lot(
    equity: float,
    entry: float,
    stop: float,
    broker: Broker,
    free_margin: float = 1e12,
    open_worst_case: float = 0.0,
    aggregate_cap_pct: float = 30.0,
) -> tuple[float, float]:
    risk_usd = equity * 0.15
    per_lot = money_per_lot(abs(entry - stop), broker)
    raw = risk_usd / per_lot
    if raw > broker.max_lot + 1e-12:
        return 0.0, risk_usd
    lots = floor_volume(raw, broker)
    if lots == 0.0:
        return 0.0, risk_usd
    actual = lots * per_lot
    if broker.margin_per_lot * lots > free_margin * 0.5:
        return 0.0, risk_usd
    if open_worst_case + actual > equity * aggregate_cap_pct / 100 + 1e-9:
        return 0.0, risk_usd
    return lots, actual


@dataclass
class Campaign:
    initial_risk: float
    peak_r: float = 0.0
    floor_r: float = -999.0
    armed: bool = False
    pending_close: bool = False
    closed: bool = False
    close_attempts: int = 0

    def observe(self, net_pnl: float) -> None:
        current = net_pnl / self.initial_risk
        self.peak_r = max(self.peak_r, current)
        if self.peak_r >= 0.50:
            self.armed = True
            self.floor_r = max(self.floor_r, 0.25)
        if self.peak_r >= 0.60:
            self.floor_r = max(self.floor_r, self.peak_r * 0.60)

    def request_close(self, broker_accepts: bool) -> None:
        self.pending_close = True
        self.close_attempts += 1
        if broker_accepts:
            self.closed = True
            self.pending_close = False


@dataclass
class PyramidBook:
    base_lot: float
    equity: float
    seen_bars: set[int]
    live_risks: list[float]
    legs: list[float]

    FRACTIONS = (0.70, 0.50, 0.30, 0.20, 0.10)

    def add(self, bar: int, current_r: float, continuation: bool, exhausted: bool,
            broker: Broker, risk_per_lot: float) -> bool:
        if bar in self.seen_bars or current_r <= 0 or not continuation or exhausted:
            return False
        self.seen_bars.add(bar)
        if len(self.legs) >= len(self.FRACTIONS):
            return False
        lot = floor_volume(self.base_lot * self.FRACTIONS[len(self.legs)], broker)
        if lot == 0:
            return False
        candidate = lot * risk_per_lot
        if sum(self.live_risks) + candidate > self.equity * 0.30 + 1e-9:
            return False
        self.legs.append(lot)
        self.live_risks.append(candidate)
        return True


@dataclass
class PyramidEventMachine:
    """Independent executable model of the EA's closed-bar event contract."""
    equity: float = 2_000.0
    state: str = "IDLE"
    event: int = 0
    consumed: set[int] = None
    last_add_bar: int = 0
    last_add_price: float = 100.0
    adds: int = 0

    def __post_init__(self):
        if self.consumed is None:
            self.consumed = set()

    def step(self, *, bar: int, price: float, atr: float, impulse=False,
             reset=False, continuation=False, current_r=.8, floor_armed=True,
             margin=500.0, free_margin=1_500.0, add_margin=100.0) -> bool:
        if self.state in {"IDLE", "CONSUMED"}:
            if (impulse and bar - self.last_add_bar >= 2
                    and abs(price - self.last_add_price) / atr >= .30):
                self.event += 1
                self.state = "WAIT_RESET"
            return False
        if self.state == "WAIT_RESET":
            if reset:
                self.state = "RESET"
            return False
        if self.state != "RESET" or not continuation:
            return False
        if self.event in self.consumed or bar == self.last_add_bar:
            return False
        if bar - self.last_add_bar < 2 or abs(price - self.last_add_price) / atr < .40:
            return False
        if current_r < .50 or (self.adds >= 1 and not floor_armed):
            return False
        projected_margin = margin + add_margin
        projected_free = free_margin - add_margin
        post_level = self.equity / projected_margin * 100
        reserve = max(100.0, self.equity * .20)
        if post_level < 200 or projected_free < reserve:
            return False
        self.consumed.add(self.event)
        self.state = "CONSUMED"
        self.last_add_bar = bar
        self.last_add_price = price
        self.adds += 1
        return True


def reset_allows(direction: int, old_direction: int, retrace_r: float,
                 required: float, fresh_structure: bool, order_filled: bool) -> tuple[bool, bool]:
    """Returns (entry_allowed, reset_still_active)."""
    if direction != old_direction:
        return True, True
    approved = retrace_r >= required and fresh_structure
    return approved, not (approved and order_filled)


def maturity_state(reversal: float, maturity: float, bos_opposed: bool, htf_opposed: bool) -> str:
    if reversal >= 70 and bos_opposed and htf_opposed:
        return "CONFIRMED_REVERSAL"
    if reversal >= 70:
        return "EARLY_REVERSAL"
    if reversal >= 55:
        return "TRANSITION"
    if reversal >= 50 and maturity >= 80:
        return "EXHAUSTION"
    if maturity >= 80:
        return "LATE"
    if maturity >= 60:
        return "MATURE"
    return "HEALTHY"


@pytest.mark.parametrize(
    "equity,broker",
    [
        (1_000, Broker(0.01, 1.0, 0.01, 50.0, 0.01, 100)),
        (10_000, Broker(0.10, 10.0, 0.10, 100.0, 0.10, 250)),
        (100_000, Broker(0.01, 0.50, 0.001, 200.0, 0.001, 40)),
    ],
)
def test_full_15pct_risk_across_account_and_symbol_variants(equity, broker):
    lots, actual = full_risk_lot(equity, 2400, 2390, broker)
    assert lots > 0
    assert actual <= equity * 0.15 + 1e-9
    assert equity * 0.15 - actual < money_per_lot(10, broker) * broker.step + 1e-6


def test_wider_stop_reduces_lot_while_preserving_dollar_risk():
    b = Broker(0.01, 1, 0.01, 100, 0.01, 50)
    narrow_lot, narrow_risk = full_risk_lot(20_000, 2400, 2395, b)
    wide_lot, wide_risk = full_risk_lot(20_000, 2400, 2380, b)
    assert wide_lot < narrow_lot
    assert abs(narrow_risk - wide_risk) <= money_per_lot(20, b) * b.step


def test_volume_never_rounds_up():
    b = Broker(0.01, 1, 0.01, 100, 0.01, 50)
    assert floor_volume(0.019999, b) == 0.01
    assert floor_volume(0.010001, b) == 0.01


def test_no_minimum_lot_fallback():
    b = Broker(0.01, 10, 0.01, 100, 0.01, 50)
    lots, _ = full_risk_lot(100, 2400, 2200, b)
    assert lots == 0.0


def test_margin_and_aggregate_constraints_block_instead_of_reduce():
    b = Broker(0.01, 1, 0.01, 100, 0.01, 10_000)
    assert full_risk_lot(10_000, 2400, 2390, b, free_margin=1_000)[0] == 0
    assert full_risk_lot(10_000, 2400, 2390, b, open_worst_case=2_000)[0] == 0


def test_049_does_not_arm_and_050_arms_quarter_r():
    c = Campaign(1_000)
    c.observe(490)
    assert not c.armed and c.floor_r == -999
    c.observe(500)
    assert c.armed and c.floor_r == pytest.approx(0.25)


@pytest.mark.parametrize("peak,expected", [(1, .6), (2, 1.2), (5, 3.0)])
def test_sixty_percent_peak_floor(peak, expected):
    c = Campaign(1_000)
    c.observe(peak * 1_000)
    assert c.floor_r == pytest.approx(expected)


def test_floor_never_loosens_on_giveback():
    c = Campaign(1_000)
    c.observe(5_000)
    c.observe(700)
    c.observe(-500)
    assert c.floor_r == 3.0 and c.peak_r == 5.0


def test_restart_round_trip_preserves_peak_floor_and_pending_close():
    c = Campaign(1_000)
    c.observe(2_000)
    c.request_close(False)
    restored = Campaign(**json.loads(json.dumps(asdict(c))))
    assert restored == c
    restored.request_close(True)
    assert restored.closed and restored.close_attempts == 2


def test_close_rejection_does_not_clear_campaign():
    c = Campaign(1_000)
    c.request_close(False)
    assert c.pending_close and not c.closed
    c.request_close(False)
    assert c.pending_close and c.close_attempts == 2


def test_descending_five_leg_ladder_and_duplicate_signal_rejection():
    b = Broker(.01, 1, .01, 100, .01, 10)
    book = PyramidBook(1.0, 1_000_000, set(), [1_000], [])
    for bar in range(1, 6):
        assert book.add(bar, 1, True, False, b, 100)
        assert not book.add(bar, 1, True, False, b, 100)
    assert book.legs == [.7, .5, .3, .2, .1]


def test_pyramid_below_min_is_blocked_not_rounded_up():
    b = Broker(.01, 1, .10, 100, .10, 10)
    book = PyramidBook(.5, 1_000_000, set(), [1_000], [.35, .25, .15, .10])
    assert not book.add(5, 1, True, False, b, 100)


def test_no_add_losing_stale_unconfirmed_or_exhausted():
    b = Broker(.01, 1, .01, 100, .01, 10)
    for current_r, continuation, exhausted in [(-.01, True, False), (1, False, False), (1, True, True)]:
        book = PyramidBook(1, 1_000_000, set(), [1_000], [])
        assert not book.add(1, current_r, continuation, exhausted, b, 100)


def test_aggregate_risk_cannot_exceed_30pct():
    b = Broker(.01, 1, .01, 100, .01, 10)
    book = PyramidBook(1, 10_000, set(), [2_950], [])
    assert not book.add(1, 1, True, False, b, 100)
    assert sum(book.live_risks) <= 3_000


def test_post_profit_reset_is_direction_aware_and_fill_safe():
    assert reset_allows(-1, 1, 0, 1, False, False) == (True, True)
    assert reset_allows(1, 1, .99, 1, True, False) == (False, True)
    assert reset_allows(1, 1, 1, 1, True, False) == (True, True)
    assert reset_allows(1, 1, 1, 1, True, True) == (True, False)


def test_gradual_transition_precedes_confirmed_flip_and_one_wick_cannot_flip():
    assert maturity_state(20, 80, True, False) != "CONFIRMED_REVERSAL"  # one hostile wick/BOS vote
    assert maturity_state(58, 75, False, False) == "TRANSITION"
    assert maturity_state(72, 80, True, False) == "EARLY_REVERSAL"
    assert maturity_state(72, 80, True, True) == "CONFIRMED_REVERSAL"


def test_mature_existing_campaign_is_protected_not_automatically_closed():
    c = Campaign(1_000)
    c.observe(2_000)
    state = maturity_state(30, 85, False, False)
    assert state == "LATE" and not c.closed and c.floor_r == 1.2


def test_generated_multi_hour_five_r_path_has_no_fixed_one_r_exit():
    c = Campaign(1_000)
    # 61 five-minute observations: ordinary pullbacks interspersed through a
    # five-hour move. Only a thesis/floor event would request close.
    path_r = [i / 10 for i in range(51)] + [4.7, 4.5, 4.8, 5.0, 4.7, 4.9, 5.1, 4.8, 5.0]
    for r in path_r:
        c.observe(r * c.initial_risk)
        assert not c.closed and not c.pending_close
    assert c.peak_r == pytest.approx(5.1)


def test_midbar_wall_clock_timer_fires_at_150_not_next_297_seconds():
    first_seen = 1_000
    due = first_seen + 150
    ticks = [first_seen, first_seen + 73, first_seen + 149, first_seen + 151, first_seen + 297]
    actual = next(t for t in ticks if t >= due)
    assert actual == first_seen + 151
    assert actual - due == 1


def test_pyramid_same_m5_bar_and_same_event_open_at_most_once():
    p = PyramidEventMachine()
    assert not p.step(bar=2, price=100.4, atr=1, impulse=True)
    assert not p.step(bar=3, price=100.2, atr=1, reset=True)
    assert p.step(bar=4, price=100.6, atr=1, continuation=True)
    assert not p.step(bar=4, price=100.7, atr=1, continuation=True)
    assert p.adds == 1 and p.consumed == {1}


def test_continuous_impulse_without_reset_cannot_repeatedly_pyramid():
    p = PyramidEventMachine()
    for bar, price in enumerate((100.4, 100.8, 101.2, 101.6), start=2):
        assert not p.step(bar=bar, price=price, atr=1, impulse=True, continuation=True)
    assert p.adds == 0 and p.state == "WAIT_RESET"


def test_real_impulse_pullback_continuation_opens_exactly_one_add():
    p = PyramidEventMachine()
    assert not p.step(bar=2, price=100.5, atr=1, impulse=True)
    assert not p.step(bar=3, price=100.25, atr=1, reset=True)
    assert p.step(bar=4, price=100.7, atr=1, continuation=True)
    assert p.adds == 1


def test_next_add_requires_an_entirely_new_cycle():
    p = PyramidEventMachine()
    p.step(bar=2, price=100.5, atr=1, impulse=True)
    p.step(bar=3, price=100.2, atr=1, reset=True)
    assert p.step(bar=4, price=100.7, atr=1, continuation=True)
    assert not p.step(bar=6, price=101.2, atr=1, continuation=True)
    assert not p.step(bar=6, price=101.2, atr=1, impulse=True)
    assert not p.step(bar=7, price=100.9, atr=1, reset=True)
    assert p.step(bar=8, price=101.4, atr=1, continuation=True)
    assert p.adds == 2 and p.consumed == {1, 2}


def test_too_small_atr_separation_blocks_even_after_valid_reset():
    p = PyramidEventMachine()
    p.step(bar=2, price=100.5, atr=1, impulse=True)
    p.step(bar=3, price=100.2, atr=1, reset=True)
    assert not p.step(bar=4, price=100.39, atr=1, continuation=True)


@pytest.mark.parametrize(
    "margin,free_margin,add_margin",
    [(1_921.14, 27.37, 20.0), (1_000.0, 1_000.0, 100.0)],
)
def test_unsafe_post_add_margin_level_or_free_reserve_blocks(margin, free_margin, add_margin):
    p = PyramidEventMachine(equity=1_936.67)
    p.step(bar=2, price=100.5, atr=1, impulse=True)
    p.step(bar=3, price=100.2, atr=1, reset=True)
    assert not p.step(bar=4, price=100.7, atr=1, continuation=True,
                      margin=margin, free_margin=free_margin, add_margin=add_margin)


def test_long_trend_can_build_multiple_legs_only_at_distinct_cycles():
    p = PyramidEventMachine(equity=100_000)
    price = 100.0
    for cycle in range(5):
        base_bar = 2 + cycle * 4
        price += .5
        assert not p.step(bar=base_bar, price=price, atr=1, impulse=True,
                          margin=1_000, free_margin=90_000, add_margin=100)
        assert not p.step(bar=base_bar + 1, price=price - .25, atr=1, reset=True,
                          margin=1_000, free_margin=90_000, add_margin=100)
        price += .3
        assert p.step(bar=base_bar + 2, price=price, atr=1, continuation=True,
                      margin=1_000, free_margin=90_000, add_margin=100)
    assert p.adds == 5


def test_initial_entry_is_not_part_of_pyramid_event_machine_and_duplicate_campaign_is_blocked():
    src = EA.read_text(errors="ignore")
    assert "OPEN_TRADE_BLOCKED_EXISTING_CAMPAIGN" in src
    assert "if(CountMyPositions() > 0)" in src
    assert "XAU_Campaign_EvaluatePyramid" in src


def test_source_has_persistent_event_states_unique_ids_and_hard_margin_projection():
    src = EA.read_text(errors="ignore")
    for token in (
        "PYRAMID_WAITING_FOR_RESET", "PYRAMID_RESET_CONFIRMED",
        "PYRAMID_CONTINUATION_CONFIRMATION", "PYRAMID_EVENT_CONSUMED",
        "[PYRAMID_EVENT_CREATED]", "[PYRAMID_ADD_OPENED]",
        "lastContinuationSignalId", "projectedMarginLevel",
        "InpCampaignPyramidMinPostMarginLevel", "OrderCalcMargin",
    ):
        assert token in src


def test_restart_reconciliation_uses_oldest_leg_as_original_r_denominator():
    observed = [
        {"id": 9545080653, "time": 4, "lot": .01, "entry": 3999.57},
        {"id": 9545008768, "time": 3, "lot": .02, "entry": 4001.43},
        {"id": 9544972576, "time": 2, "lot": .02, "entry": 4001.63},
        {"id": 9544968855, "time": 1, "lot": .04, "entry": 4001.93},
    ]
    legs = sorted(observed, key=lambda leg: leg["time"])
    assert legs[0] == {"id": 9544968855, "time": 1, "lot": .04, "entry": 4001.93}
    src = EA.read_text(errors="ignore")
    assert "unassignedTime[b] < unassignedTime[b - 1]" in src
    assert "unassignedTicket[b - 1] = unassignedTicket[b]" in src
    assert "guaranteeHistoryKnown=false" in src
    assert "g_campaign[idx].peakR = 0.0" in src


def test_production_files_remain_exact_and_byte_identical():
    assert sha256(PROD.read_bytes()).hexdigest() == PRODUCTION_SHA256
    assert PROD.read_bytes() == MIRROR.read_bytes()


def test_source_uses_structural_invalidation_no_fixed_tp_and_retry_close():
    src = EA.read_text(errors="ignore")
    assert "XAU_Campaign_CalculateInvalidationSL" in src
    assert "tp = 0.0;" in src
    assert "CAMPAIGN_CLOSE_CONFIRMED" in src
    assert "if(anyStillLive)" in src
    assert "XAU_Campaign_LiveWorstCaseRiskUSD" in src


def test_experiment_memory_names_and_backend_writes_are_isolated():
    src = EA.read_text(errors="ignore")
    for obsolete in (
        '"XAUAI_StratWeights_v1.csv"', '"XAUAI_TRI_Stats_v1.csv"',
        '"XAUAI_TradeBrain_v1.csv"', '"xauai_cloud_map.csv"',
        'return "XAUAI_TimingProof_" + Symbol() + ".csv"',
        'return "XAUAI_EntryQualityReview_" + Symbol() + ".csv"',
    ):
        assert obsolete not in src
    assert "if(InpCloudFanout || InpExperimentBackendLearning)" in src


def test_no_executable_counter_or_inverse_hooks():
    src = EA.read_text(errors="ignore")
    for token in ("XAU_TryCounterExcursionEntry", "90205001", "INVERSEEXP1", "originalNormalDir"):
        assert token not in src
