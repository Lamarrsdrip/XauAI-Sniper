"""Deterministic liveness tests for the v6.24.16 Entry Readiness handoff.

These are controlled-path tests, not a claim that a live broker filled an
order.  They model the two observations that reach the actual OpenTrade()
boundary and assert the source keeps the already-matured aligned timer alive
only while readiness itself is waiting.
"""

from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.24.16.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


@dataclass
class Candidate:
    direction: int
    origin: int = 0
    generation: int = 0
    state: str = "BIAS_ONLY"
    active: bool = False
    order_calls: int = 0

    def observe(self, now: int, confirmed: bool, invalidated: bool = False) -> bool:
        """Mirror the tested readiness contract at OpenTrade's boundary."""
        if invalidated:
            self.active = False
            self.state = "INVALIDATED"
            return False
        if not self.active:
            self.active, self.origin, self.generation = True, now, self.generation + 1
        self.state = "CONFIRMED" if confirmed else "WAIT_FOR_RECLAIM"
        # Exactly the MQL candidateAlreadyExisted rule: first observation
        # never sends, a later stable confirmation may reach the broker.
        return confirmed and now > self.origin

    def attempt(self, now: int, confirmed: bool, broker_accepts: bool = True) -> str:
        ready = self.observe(now, confirmed)
        if not ready:
            return "PRESERVED_FOR_READINESS_RECHECK" if self.active else "INVALIDATED"
        self.order_calls += 1
        self.active = False  # one attempt only; no order spam after outcome
        return "ORDER_FILLED" if broker_accepts else "BROKER_REJECTED"


def source() -> str:
    return EA.read_text(encoding="utf-8", errors="ignore")


def test_deploy_source_is_synced():
    assert source() == BACKEND_EA.read_text(encoding="utf-8", errors="ignore")


def test_first_confirmed_then_second_confirmed_reaches_mock_broker_for_buy_and_sell():
    for direction in (1, -1):
        c = Candidate(direction)
        assert c.attempt(150, True) == "PRESERVED_FOR_READINESS_RECHECK"
        assert c.attempt(155, True) == "ORDER_FILLED"
        assert c.order_calls == 1


def test_wait_then_confirm_preserves_generation_and_reaches_broker():
    c = Candidate(1)
    assert c.attempt(150, False) == "PRESERVED_FOR_READINESS_RECHECK"
    generation = c.generation
    assert c.attempt(155, True) == "ORDER_FILLED"
    assert c.generation == generation


def test_confirm_weaken_confirm_is_deterministic_and_never_first_tick_entry():
    c = Candidate(-1)
    assert c.attempt(150, True) == "PRESERVED_FOR_READINESS_RECHECK"
    assert c.attempt(155, False) == "PRESERVED_FOR_READINESS_RECHECK"
    assert c.attempt(160, True) == "ORDER_FILLED"
    assert c.order_calls == 1


def test_invalidated_candidate_never_sends_and_new_origin_is_new_generation():
    c = Candidate(1)
    assert c.attempt(150, False) == "PRESERVED_FOR_READINESS_RECHECK"
    old_generation = c.generation
    assert c.observe(155, False, invalidated=True) is False
    assert c.attempt(300, True) == "PRESERVED_FOR_READINESS_RECHECK"
    assert c.generation == old_generation + 1


def test_broker_rejection_is_one_bounded_attempt_not_order_spam():
    c = Candidate(-1)
    assert c.attempt(150, True) == "PRESERVED_FOR_READINESS_RECHECK"
    assert c.attempt(155, True, broker_accepts=False) == "BROKER_REJECTED"
    assert c.order_calls == 1


def test_source_preserves_due_timer_only_for_readiness_wait_and_throttles_live_recheck():
    ea = source()
    start = ea.index("bool tradeOpened = OpenTrade(signal")
    block = ea[start:start + 2200]
    assert "bool readinessAwaitingStableObservation = !tradeOpened" in block
    assert "!g_lastEntryReadiness.entryReady" in block
    assert "g_alignedCandidates[0].readinessRecheckAt = TimeCurrent() + 5;" in block
    assert "g_alignedCandidates[0].firstCandidateTime = 0;" in block
    assert "ENTRY_TIMER_REUSED" in block


def test_source_uses_origin_and_generation_in_addition_to_coarse_fingerprint():
    ea = source()
    fn = ea[ea.index("XAU_EntryReadinessDecision XAU_UpdateEntryReadiness("):]
    assert 'StringFormat("%s|%s|%d", RegimeName()' in fn
    assert 'StringFormat("%s|O=%I64d|G=%I64d", fingerprint' in ea
    assert "g_alignedCandidates[lane].candidateGeneration" in ea


def test_source_has_lifecycle_conflict_shadow_and_position_active_observability():
    ea = source()
    for marker in (
        "CANDIDATE_CREATED", "CANDIDATE_REPLACED", "CANDIDATE_STATE_CHANGED",
        "CANDIDATE_ENTRY_READY", "CANDIDATE_TRADED", "ENTRY_READY_BLOCKED",
        "READINESS_STUCK_DIAGNOSTIC", "READINESS_SHADOW", "POSITION_ACTIVE",
        "ENTRY_TIMER_STARTED", "ENTRY_TIMER_COMPLETED", "ENTRY_TIMER_REUSED",
    ):
        assert marker in ea
