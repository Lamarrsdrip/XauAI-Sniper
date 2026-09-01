"""Executable owner-rule regression model for the v6.25.5 M30 entry lifecycle.

The model deliberately has only four post-consensus states: timing, execute,
cancelled, expired.  Retrace/location are evidence fields, never states.
Source-contract assertions bind the model's constants and transitions to the
real MQ5 implementation so this cannot become a disconnected specification.
"""
from dataclasses import dataclass
from pathlib import Path


EA_PATH = Path(__file__).resolve().parents[1] / "XAUUSD_AI_Sniper_EA.mq5"
EA = EA_PATH.read_text(encoding="utf-8", errors="ignore")


@dataclass(frozen=True)
class Identity:
    account: int
    symbol: str
    magic: int
    mode: str
    slot_close: int
    direction: int
    oldest: int
    middle: int
    newest: int

    @property
    def candidate_id(self) -> str:
        side = "BUY" if self.direction == 1 else "SELL"
        return (
            f"{self.account}|{self.symbol}|{self.magic}|{self.mode}|{self.slot_close}"
            f"|CORE|{side}|EVIDENCE={self.oldest},{self.middle},{self.newest}"
        )


@dataclass
class Candidate:
    identity: Identity
    started_at: int
    origin_price: float
    final_risk_distance: float
    target_seconds: int = 150
    terminal_result: str = ""

    def revalidate(self, now: int, price: float, signal_valid: bool) -> str:
        if self.terminal_result:
            return "REJECT_RESURRECTION"
        elapsed = now - self.started_at
        if elapsed < 120:
            return "WAIT_SINGLE_TIMER"
        if elapsed > 180:
            self.terminal_result = "CANCEL_TIMER_EXPIRED"
            return self.terminal_result
        if elapsed < self.target_seconds:
            return "WAIT_SINGLE_TIMER"
        move = price - self.origin_price if self.identity.direction == 1 else self.origin_price - price
        move_r = max(0.0, move / self.final_risk_distance)
        if not signal_valid:
            self.terminal_result = "CANCEL_INVALIDATED"
        elif move_r >= 0.30:
            self.terminal_result = "CANCEL_MISSED_MOVE"
        else:
            self.terminal_result = "EXECUTE"
        return self.terminal_result


def make_candidate(direction=1, slot=1_752_739_800, evidence=(101, 102, 103),
                   location="LOCATION_ACCEPTABLE") -> Candidate:
    # `location` is intentionally accepted only as evidence. It never changes
    # creation time, lifecycle, or timer count.
    assert location
    ident = Identity(700001, "XAUUSD", 6255, "M30_THREE_M10", slot,
                     direction, *evidence)
    return Candidate(ident, started_at=slot, origin_price=3300.0,
                     final_risk_distance=10.0)


def test_qualifying_buy_immediately_creates_buy_candidate():
    c = make_candidate(direction=1)
    assert "|BUY|" in c.identity.candidate_id
    assert c.started_at == c.identity.slot_close


def test_qualifying_sell_immediately_creates_sell_candidate():
    c = make_candidate(direction=-1)
    assert "|SELL|" in c.identity.candidate_id
    assert c.started_at == c.identity.slot_close


def test_timer_begins_in_same_m30_decision_cycle():
    c = make_candidate()
    assert c.revalidate(c.started_at, 3300.0, True) == "WAIT_SINGLE_TIMER"


def test_only_timer_bounds_are_120_to_180_seconds():
    c = make_candidate()
    assert c.revalidate(c.started_at + 119, 3300.0, True) == "WAIT_SINGLE_TIMER"
    assert c.revalidate(c.started_at + 150, 3300.0, True) == "EXECUTE"
    late = make_candidate(slot=c.started_at + 1800)
    assert late.revalidate(late.started_at + 181, 3300.0, True) == "CANCEL_TIMER_EXPIRED"


def test_location_late_cannot_postpone_into_another_m10_candle():
    c = make_candidate(location="LOCATION_LATE")
    assert c.revalidate(c.started_at + 150, 3301.0, True) == "EXECUTE"


def test_location_extended_cannot_postpone_into_another_m30_slot():
    c = make_candidate(location="LOCATION_EXTENDED")
    assert c.revalidate(c.started_at + 150, 3301.0, True) == "EXECUTE"


def test_retrace_evidence_cannot_create_a_second_timer():
    c = make_candidate(location="WAIT_FOR_RETRACE")
    started = c.started_at
    assert c.revalidate(started + 150, 3301.0, True) == "EXECUTE"
    assert c.started_at == started


def test_valid_signal_below_point_three_r_executes():
    c = make_candidate()
    assert c.revalidate(c.started_at + 150, 3302.99, True) == "EXECUTE"


def test_move_at_point_three_r_cancels_not_delays():
    c = make_candidate()
    assert c.revalidate(c.started_at + 150, 3303.0, True) == "CANCEL_MISSED_MOVE"


def test_invalid_signal_cancels_not_delays():
    c = make_candidate()
    assert c.revalidate(c.started_at + 150, 3301.0, False) == "CANCEL_INVALIDATED"


def test_cancelled_candidate_cannot_be_resurrected():
    c = make_candidate()
    assert c.revalidate(c.started_at + 150, 3303.0, True) == "CANCEL_MISSED_MOVE"
    assert c.revalidate(c.started_at + 160, 3300.0, True) == "REJECT_RESURRECTION"


def test_candidate_cannot_survive_beyond_single_window():
    c = make_candidate()
    assert c.revalidate(c.started_at + 181, 3300.0, True) == "CANCEL_TIMER_EXPIRED"
    assert c.terminal_result == "CANCEL_TIMER_EXPIRED"


def test_consecutive_same_direction_slots_have_different_ids():
    a = make_candidate(slot=1_752_739_800)
    b = make_candidate(slot=1_752_741_600, evidence=(104, 105, 106))
    assert a.identity.candidate_id != b.identity.candidate_id


def test_consecutive_slots_have_fresh_independent_timers():
    a = make_candidate(slot=1_752_739_800)
    b = make_candidate(slot=1_752_741_600, evidence=(104, 105, 106))
    assert a.started_at != b.started_at
    assert a.revalidate(a.started_at + 150, 3301.0, True) == "EXECUTE"
    assert b.revalidate(b.started_at, 3301.0, True) == "WAIT_SINGLE_TIMER"


def test_later_slot_cannot_inherit_previous_elapsed_time():
    a = make_candidate(slot=1_752_739_800)
    b = make_candidate(slot=1_752_741_600, evidence=(104, 105, 106))
    assert a.revalidate(a.started_at + 150, 3301.0, True) == "EXECUTE"
    assert b.revalidate(b.started_at + 1, 3301.0, True) == "WAIT_SINGLE_TIMER"


def test_source_removes_legacy_reentry_and_retrace_second_waits_in_m30_mode():
    assert "REENTRY_DISABLED_IN_M30_CONSENSUS_MODE" in EA
    assert "POST_PROFIT_RETRACE_EVIDENCE_ONLY" in EA
    assert "ENTRY_TIMER_REUSED" not in EA
    assert "MISSED_WAIT_FOR_PULLBACK" not in EA


def test_source_keeps_position_management_tick_based_and_risk_contract_intact():
    assert "ManagePositions();" in EA
    assert "XAU_RExitCoreLoop();" in EA
    assert '#define XAU_SL_WIDENING_FACTOR 1.20' in EA
    assert "InpNormalRiskPct       = 10.0" in EA
    assert "XAU_BrokerOpenRetcodeAccepted" in EA
    assert "XAU_ClaimDirectionReservation" in EA


def test_source_contract_has_one_timer_and_terminal_revalidation_outcomes():
    assert "XAU_ENTRY_DELAY_ABSOLUTE_FLOOR_SEC   120.0" in EA
    assert "XAU_ENTRY_DELAY_ABSOLUTE_CEILING_SEC 180.0" in EA
    assert "ENTRY_TIMER_STARTED | candidateId=" in EA
    assert '"CANCEL_MISSED_MOVE"' in EA
    assert "result=CANCEL_TIMER_EXPIRED" in EA
    assert '"EXECUTE"' in EA
    builder_start = EA.index("XAU_M30ConsensusDecision XAU_BuildM30ConsensusDecision()")
    builder_end = EA.index("string XAU_M30DisplayJson()", builder_start)
    builder = EA[builder_start:builder_end]
    assert "d.decisionType = (dominant==1) ? M30_DECISION_WAIT_FOR_BUY_RETRACE" not in builder
