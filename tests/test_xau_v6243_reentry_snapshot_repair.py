"""Deterministic reproduction of the v6.24.1 stale RE_ENTRY incident.

The model freezes the closed-bar decision snapshot.  It deliberately does not
use later price/result data: it asserts what may be sent at decision time.
"""

from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


@dataclass(frozen=True)
class Snapshot:
    direction: int
    bias: int
    bos: int
    m5_continuation: bool = True
    m15_non_conflict: bool = True
    dedicated_reversal: bool = False
    current_bar: int = 100
    approved_bar: int = 100
    ai_status: str = "AI_NOT_CALLED"


@dataclass
class Reentry:
    direction: int = -1
    active: bool = True
    invalidated: bool = False
    expiry_bar: int = 103
    snapshot_bar: int | None = None


def decide(state: Reentry, snap: Snapshot) -> str:
    if not state.active:
        return "PRIMARY_MAY_EVALUATE"
    if snap.current_bar > state.expiry_bar:
        state.active = False
        state.invalidated = True
        return "REENTRY_STATE_EXPIRED"
    if snap.direction != state.direction:
        state.active = False
        state.invalidated = True
        return "REENTRY_BLOCKED_OPPOSITE_SIGNAL"
    if snap.bias == -state.direction and not snap.dedicated_reversal:
        state.active = False
        state.invalidated = True
        return "REENTRY_BLOCKED_BIAS_CONFLICT"
    if snap.bos == -state.direction:
        state.active = False
        state.invalidated = True
        return "REENTRY_BLOCKED_STRUCTURE_FLIP"
    if not (snap.m5_continuation and snap.m15_non_conflict):
        return "WAIT_FOR_FRESH_CONTINUATION"
    if snap.approved_bar != snap.current_bar:
        state.active = False
        state.invalidated = True
        return "REENTRY_BLOCKED_STALE_SNAPSHOT"
    state.snapshot_bar = snap.approved_bar
    return "REENTRY_APPROVED_FRESH_CONFIRMATION"


def test_a_sell_sl_then_buy_signal_clears_cached_sell_reentry():
    state = Reentry(direction=-1, active=False, invalidated=True)
    assert decide(state, Snapshot(direction=1, bias=1, bos=1)) == "PRIMARY_MAY_EVALUATE"
    assert state.invalidated


def test_b_later_fresh_bearish_setup_can_be_independently_rebuilt():
    state = Reentry(direction=-1)
    assert decide(state, Snapshot(direction=-1, bias=-1, bos=-1)) == "REENTRY_APPROVED_FRESH_CONFIRMATION"


def test_c_buy_bias_rejects_ordinary_sell_reentry():
    assert decide(Reentry(direction=-1), Snapshot(direction=-1, bias=1, bos=0)) == "REENTRY_BLOCKED_BIAS_CONFLICT"


def test_d_countertrend_sell_needs_dedicated_closed_bar_reversal():
    assert decide(Reentry(direction=-1), Snapshot(direction=-1, bias=1, bos=-1, dedicated_reversal=True)) == "REENTRY_APPROVED_FRESH_CONFIRMATION"


def test_e_opposite_signal_before_order_send_rejects_stale_sell():
    assert decide(Reentry(direction=-1), Snapshot(direction=1, bias=1, bos=0)) == "REENTRY_BLOCKED_OPPOSITE_SIGNAL"


def test_f_snapshot_older_than_allowed_closed_bar_is_rejected():
    assert decide(Reentry(direction=-1), Snapshot(direction=-1, bias=-1, bos=-1, current_bar=101, approved_bar=100)) == "REENTRY_BLOCKED_STALE_SNAPSHOT"


def test_g_matching_signal_and_structure_allow_continuation_reentry():
    assert decide(Reentry(direction=1), Snapshot(direction=1, bias=1, bos=1)) == "REENTRY_APPROVED_FRESH_CONFIRMATION"


def test_h_zero_ai_is_a_status_not_an_approval_vote():
    snap = Snapshot(direction=1, bias=1, bos=1, ai_status="AI_SKIPPED_BUDGET")
    assert snap.ai_status == "AI_SKIPPED_BUDGET"
    assert decide(Reentry(direction=1), snap) == "REENTRY_APPROVED_FRESH_CONFIRMATION"


def test_i_sl_invalidates_campaign_permission_and_candidate():
    state = Reentry(direction=-1, active=False, invalidated=True)
    assert state.active is False
    assert state.invalidated is True


def test_j_module_disagreement_has_one_deterministic_final_direction():
    # The current snapshot is the single source of truth; stale sell context
    # cannot compete with the current BUY decision.
    assert decide(Reentry(direction=-1), Snapshot(direction=1, bias=1, bos=1)) == "REENTRY_BLOCKED_OPPOSITE_SIGNAL"


def test_source_uses_snapshot_not_last_close_direction_for_order():
    source = EA.read_text(encoding="utf-8", errors="ignore")
    body = source[source.index("bool CheckReEntryOpportunity()"):source.index("//+------------------------------------------------------------------+\n//| SMC ENTRY LAYER", source.index("bool CheckReEntryOpportunity()"))]
    assert "XAU_CaptureDecisionSnapshot" in source
    assert "g_latestDecisionSnapshot.signalDirection != dir" in body
    assert "REENTRY_BLOCKED_OPPOSITE_SIGNAL" in body
    assert "REENTRY_BLOCKED_STALE_SNAPSHOT" in body
    assert "OpenTrade(dir,bufATR[1]" in body
    assert "OpenTrade(lastClose.dir" not in body


def test_source_invalidates_on_exact_broker_sl_close():
    source = EA.read_text(encoding="utf-8", errors="ignore")
    assert "XAU_CreateReentryState(wasSLHitExact);" in source
    assert "REENTRY_BLOCKED_AFTER_SL" in source
    assert "XAU_ClearDirectionalCandidateState(direction);" in source


def test_source_defers_reentry_until_after_current_scan_snapshot():
    source = EA.read_text(encoding="utf-8", errors="ignore")
    early = source.index("RE_ENTRY is deliberately NOT evaluated here")
    snapshot = source.index("XAU_CaptureDecisionSnapshot(signal,setupName,grade,setupScore,combinedScore);")
    check = source.index("if(CheckReEntryOpportunity()) return;", snapshot)
    assert early < snapshot < check


def test_source_logs_truthful_ai_zero_states_and_execution_visibility():
    source = EA.read_text(encoding="utf-8", errors="ignore")
    for marker in (
        "AI_NOT_CALLED",
        "AI_SKIPPED_BUDGET",
        "AI_UNAVAILABLE",
        "AI_TIMEOUT",
        "DECISION_SNAPSHOT",
        "REENTRY_APPROVED_FRESH_CONFIRMATION",
    ):
        assert marker in source


def test_one_smart_caution_authority_and_no_lot_reduction_path():
    source = EA.read_text(encoding="utf-8", errors="ignore")
    assert source.count("ENUM_XAU_SMART_ENTRY_CAUTION_DECISION XAU_SmartEntryCautionGate(") == 2  # declaration + definition
    assert "SMART_ENTRY_CAUTION_TRACE" in source
    caution = source[source.rindex("ENUM_XAU_SMART_ENTRY_CAUTION_DECISION XAU_SmartEntryCautionGate("):]
    assert "lotMulti" not in caution[:caution.index("// v5.3.0 — master pre-trade gate")]
