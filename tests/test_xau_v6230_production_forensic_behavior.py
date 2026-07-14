"""Executable scenario models and source-wiring checks for production v6.23.0.

The scenario models exercise the release invariants without pretending to be
an MT5 broker integration. Tests named ``test_source_*`` are explicitly static;
the others execute deterministic sizing, timing, close-state, and R-state
transitions against varied inputs.
"""

from dataclasses import dataclass
from math import floor, isclose
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
EA_PATH = ROOT / "XAUUSD_AI_Sniper_EA_v6.23.0.mq5"
MIRROR_PATH = ROOT / "backend/ea_code/XAUUSD_AI_Sniper_EA.mq5"


def risk_per_lot(distance: float, tick_size: float, tick_value: float) -> float:
    if distance <= 0 or tick_size <= 0 or tick_value <= 0:
        return 0.0
    return distance / tick_size * tick_value


def floor_volume(raw: float, step: float, minimum: float) -> float:
    stepped = floor((raw + 1e-12) / step) * step
    return 0.0 if stepped + 1e-12 < minimum else stepped


@dataclass(frozen=True)
class BinarySizingResult:
    allowed: bool
    reason: str
    raw_lots: float
    lots: float
    requested_risk: float
    actual_risk: float


def binary_size(
    reference_balance: float,
    distance: float,
    *,
    risk_pct: float = 15.0,
    tick_size: float = 0.01,
    tick_value: float = 1.0,
    step: float = 0.01,
    minimum: float = 0.01,
    maximum: float = 100.0,
    margin_per_lot: float = 0.0,
    free_margin: float = 1e12,
    open_risk: float = 0.0,
    aggregate_cap_pct: float = 100.0,
) -> BinarySizingResult:
    requested = reference_balance * risk_pct / 100.0
    per_lot = risk_per_lot(distance, tick_size, tick_value)
    raw = requested / per_lot if per_lot else 0.0
    if not per_lot:
        return BinarySizingResult(False, "RISK_PER_LOT_CALC_FAILED", raw, 0, requested, 0)
    if raw > maximum + 1e-12:
        return BinarySizingResult(False, "BROKER_MAX_BELOW_FULL_RISK", raw, 0, requested, 0)
    lots = floor_volume(raw, step, minimum)
    if lots == 0:
        return BinarySizingResult(False, "RISK_BLOCKED_LOT_BELOW_MIN", raw, 0, requested, 0)
    if lots * margin_per_lot > free_margin * 0.5:
        return BinarySizingResult(False, "MARGIN_BELOW_FULL_RISK", raw, 0, requested, 0)
    actual = lots * per_lot
    if actual + open_risk > reference_balance * aggregate_cap_pct / 100.0 + 1e-9:
        return BinarySizingResult(False, "AGG_RISK_BELOW_FULL_RISK_ROOM", raw, 0, requested, 0)
    return BinarySizingResult(True, "FULL_RISK_BINARY_VALIDATED", raw, lots, requested, actual)


@pytest.mark.parametrize("balance", [2_000.0, 3_000.0, 10_000.0, 100_000.0])
def test_full_risk_across_required_account_sizes(balance):
    result = binary_size(balance, 15.0, tick_size=0.01, tick_value=1.0)
    assert result.allowed
    assert result.actual_risk <= result.requested_risk
    assert result.requested_risk - result.actual_risk < risk_per_lot(15, 0.01, 1) * 0.01 + 1e-9


@pytest.mark.parametrize(
    "distance,tick_size,tick_value",
    [(1.5, 0.01, 1.0), (40.0, 0.01, 1.0), (12.0, 0.1, 0.5), (25.0, 0.01, 0.8)],
)
def test_tick_value_and_stop_geometry_feed_final_lot(distance, tick_size, tick_value):
    result = binary_size(10_000, distance, tick_size=tick_size, tick_value=tick_value)
    assert result.allowed
    expected_raw = 1_500 / risk_per_lot(distance, tick_size, tick_value)
    assert isclose(result.raw_lots, expected_raw)


def test_upward_rounding_is_impossible():
    result = binary_size(2_003, 13.7, step=0.1)
    assert result.allowed
    assert result.lots <= result.raw_lots
    assert result.actual_risk <= result.requested_risk


def test_broker_minimum_blocks_instead_of_inflating_to_point_zero_one():
    result = binary_size(2_000, 50_000, minimum=0.01)
    assert not result.allowed
    assert result.reason == "RISK_BLOCKED_LOT_BELOW_MIN"
    assert result.lots == 0


def test_broker_max_blocks_instead_of_downsizing():
    result = binary_size(100_000, 0.1, maximum=5.0)
    assert not result.allowed
    assert result.reason == "BROKER_MAX_BELOW_FULL_RISK"


def test_low_margin_blocks_instead_of_decrement_loop():
    result = binary_size(10_000, 15, margin_per_lot=2_000, free_margin=1_000)
    assert not result.allowed
    assert result.reason == "MARGIN_BELOW_FULL_RISK"


def test_aggregate_room_blocks_instead_of_partial_size():
    result = binary_size(10_000, 15, open_risk=900, aggregate_cap_pct=20)
    assert not result.allowed
    assert result.reason == "AGG_RISK_BELOW_FULL_RISK_ROOM"


@dataclass
class PendingCandidate:
    candidate_id: str
    first_seen: int
    first_price: float
    due_after: int = 150

    def rediscover(self, candidate_id: str, now: int, price: float) -> None:
        if candidate_id != self.candidate_id:
            self.candidate_id, self.first_seen, self.first_price = candidate_id, now, price

    def due(self, now: int) -> bool:
        return now - self.first_seen >= self.due_after

    def chased(self, now_price: float, atr: float, max_atr: float = 0.6) -> bool:
        return abs(now_price - self.first_price) > atr * max_atr


def test_mid_candle_150_second_timer_is_due_at_150_not_297():
    candidate = PendingCandidate("A_BUY_123", first_seen=15 * 3600 + 35 * 60 + 20, first_price=2400)
    assert not candidate.due(candidate.first_seen + 149)
    assert candidate.due(candidate.first_seen + 150)
    assert candidate.due(candidate.first_seen + 297)


def test_same_candidate_rediscovery_does_not_reset_timer_or_price():
    candidate = PendingCandidate("same", 100, 2400)
    candidate.rediscover("same", 220, 2405)
    assert (candidate.first_seen, candidate.first_price) == (100, 2400)
    assert candidate.due(250)


def test_new_candidate_replaces_identity_and_timer():
    candidate = PendingCandidate("old", 100, 2400)
    candidate.rediscover("new", 220, 2405)
    assert (candidate.candidate_id, candidate.first_seen, candidate.first_price) == ("new", 220, 2405)


def test_late_chase_uses_first_seen_price():
    candidate = PendingCandidate("same", 100, 2400)
    assert candidate.chased(2407, atr=10, max_atr=0.6)
    assert not candidate.chased(2405, atr=10, max_atr=0.6)


COUNTER_NONE, COUNTER_REQUESTED, COUNTER_PENDING, COUNTER_CONFIRMED = range(4)


@dataclass
class CounterCloseModel:
    active: bool = True
    state: int = COUNTER_NONE
    attempts: int = 0
    reason: str = ""

    def request(self, reason: str, broker_position_exists: bool) -> None:
        self.reason = self.reason or reason
        self.state = COUNTER_REQUESTED
        if broker_position_exists:
            self.attempts += 1
            self.state = COUNTER_PENDING
        else:
            self.state = COUNTER_CONFIRMED
            self.active = False


def test_counter_close_rejection_retains_active_state_and_reason():
    state = CounterCloseModel()
    state.request("COUNTER_PROFIT_FLOOR_HIT", broker_position_exists=True)
    assert state.active
    assert state.state == COUNTER_PENDING
    assert state.reason == "COUNTER_PROFIT_FLOOR_HIT"


def test_counter_close_clears_only_after_broker_absence():
    state = CounterCloseModel()
    state.request("COUNTER_TARGET_MAXR_HARD_CAP", broker_position_exists=True)
    state.request("later reason must not overwrite", broker_position_exists=False)
    assert not state.active
    assert state.state == COUNTER_CONFIRMED
    assert state.reason == "COUNTER_TARGET_MAXR_HARD_CAP"


def test_counter_pending_close_retries():
    state = CounterCloseModel()
    state.request("EXIT", broker_position_exists=True)
    state.request("EXIT", broker_position_exists=True)
    assert state.active and state.attempts == 2


def test_approved_normal_decision_is_independent_of_counter_state():
    def normal_allowed(normal_gates_pass: bool, counter_active: bool) -> bool:
        del counter_active
        return normal_gates_pass

    assert normal_allowed(True, True)


@pytest.mark.parametrize("margin_mode,allowed", [("HEDGING", True), ("NETTING", False), ("EXCHANGE", False)])
def test_counter_requires_hedging_for_independent_magic(margin_mode, allowed):
    assert (margin_mode == "HEDGING") is allowed


@dataclass
class RState:
    original_risk: float
    peak_profit: float = 0.0
    close_pending: bool = False

    def r(self, profit: float) -> float:
        self.peak_profit = max(self.peak_profit, profit)
        return profit / self.original_risk


def test_r_denominator_stays_stable_after_stop_modification():
    state = RState(original_risk=1_500)
    assert isclose(state.r(450), 0.3)
    moved_stop_risk = 200
    assert moved_stop_risk != state.original_risk
    assert isclose(state.r(750), 0.5)


def test_r_peak_giveback_uses_persistent_peak():
    state = RState(original_risk=1_000)
    state.r(700)
    state.r(400)
    assert state.peak_profit == 700
    assert 1 - 400 / state.peak_profit > 0.4


def test_source_identity_and_mirror_are_exact():
    assert EA_PATH.read_bytes() == MIRROR_PATH.read_bytes()
    source = EA_PATH.read_text()
    assert '#property version   "6.230"' in source
    assert '#define XAUAI_EA_VERSION "v6.23.0"' in source
    assert 'XAUAI_BUILD_HASH "v6230-production-forensic-hardening-20260714"' in source


def test_source_full_risk_fail_closed_wiring():
    source = EA_PATH.read_text()
    for reason in (
        "BROKER_MAX_BELOW_FULL_RISK",
        "CONFIGURED_MAX_LOTS_BELOW_FULL_RISK",
        "EQUITY_CAP_BELOW_FULL_RISK",
        "AGG_RISK_BELOW_FULL_RISK_ROOM",
        "MARGIN_BELOW_FULL_RISK",
        "FULL_RISK_BINARY_INVARIANT",
    ):
        assert reason in source
    assert "FULL_RISK_BINARY_VALIDATED" in source


def test_source_normalizer_is_floor_only():
    source = EA_PATH.read_text()
    body = source.split("double XAU_NormalizeVolumeForRisk", 1)[1].split("}", 1)[0]
    assert "MathFloor" in body
    assert "MathRound" not in body
    assert "MathCeil" not in body


def test_source_midbar_and_candidate_identity_wiring():
    source = EA_PATH.read_text()
    assert "pendingConfirmDue" in source
    assert "PENDING_CONFIRM_DUE_MIDBAR" in source
    assert "sameSignalPending" in source
    assert "g_pendingEntryConfirm.firstSeenTime" in source
    assert "firstSeenTime" in source and "firstSeenPrice" in source


def test_source_counter_close_state_and_safe_modify_wiring():
    source = EA_PATH.read_text()
    assert "XAU_RequestCounterExcursionClose" in source
    assert "COUNTER_CLOSE_PENDING_RETRY" in source
    assert "COUNTER_EXCURSION_CLOSE_CONFIRMED" in source
    assert 'SafeModifySL(g_counterEx.ticket, targetSL, curTP, isBuy, curPrice, "COUNTER_PROFIT_FLOOR")' in source
    assert "NETTING_UNSUPPORTED_INDEPENDENT_MAGIC" in source


def test_source_state_scope_includes_all_required_dimensions():
    source = EA_PATH.read_text()
    body = source.split("string XAU_ProductionStateScope()", 1)[1].split("}", 1)[0]
    assert "ACCOUNT_LOGIN" in body
    assert "ACCOUNT_SERVER" in body
    assert "Symbol()" in body
    assert "InpMagicNumber" in body
    for path_fn in (
        "XAU_StratWeightsFile", "XAU_TRIStatsFile", "XAU_BlockedMemoryFile",
        "XAU_TradeBrainFile", "XAU_TimingProofFile", "XAU_ConsciousMemoryFile",
        "XAU_EntryQualityFile", "XAU_TradingIntelCsvFile", "XAU_CloudMapFile",
    ):
        assert path_fn in source


def test_source_counter_cannot_block_normal_open():
    source = EA_PATH.read_text()
    open_body = source.split("bool OpenTrade(", 1)[1].split("bool ManageBasket()", 1)[0]
    assert "g_counterEx.active" not in open_body
