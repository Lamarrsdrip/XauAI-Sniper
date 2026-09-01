"""v6.24.3-v6.24.7 combined July 15 replay.

Deterministic Python replay of the exact 2026-07-15 sequence documented in
audits/v6243_reentry_snapshot_forensic_20260715.md, exercised against the
combined decision model built across this branch's stages (fresh-snapshot
re-entry authority, custom-window-1 30-minute news block, trade-horizon
classification, and campaign-exhaustion-gated pyramid adds). This is the
same "deterministic dataclass mirror of the control flow" pattern already
used throughout this repo (e.g. test_xau_v6243_reentry_snapshot_repair.py);
it proves the combined *decision* contract, not a claim that MT5 itself
was re-run.

No-hindsight rule (same as the audit doc): every decision below is made
only from evidence that would have been available at that exact moment
(current snapshot direction, current lifecycle/exhaustion, current news
window state) -- outcomes are asserted, not used as an input.
"""

from dataclasses import dataclass


# ---------------------------------------------------------------------------
# Minimal decision model combining the four stages shipped on this branch
# ---------------------------------------------------------------------------

TREND_EARLY, TREND_DEVELOPING, TREND_HEALTHY, TREND_MATURE = 0, 1, 2, 3
TREND_LATE, TREND_EXHAUSTING, TRANSITION_NEUTRAL = 4, 5, 6
OPPOSITE_DIRECTION_FORMING, OPPOSITE_DIRECTION_CONFIRMED = 7, 8

TRANSITION_HOLD = 0
TRANSITION_STOP_ADDS = 1
TRANSITION_TIGHTEN_PROTECTION = 2
TRANSITION_EXIT_PROFITABLE = 3
TRANSITION_EXIT_CONTROLLED = 4

BLOCKING_PYRAMID_ACTIONS = {TRANSITION_STOP_ADDS, TRANSITION_TIGHTEN_PROTECTION,
                            TRANSITION_EXIT_PROFITABLE, TRANSITION_EXIT_CONTROLLED}


@dataclass
class Snapshot:
    """Mirrors XAU_EntryDecisionSnapshot: the one immutable object a
    re-entry (or fresh entry) must match against."""
    valid: bool
    generation: int
    signal_direction: int          # 1=BUY, -1=SELL
    lifecycle: int
    exhaustion_pct: float


@dataclass
class ReentryRequest:
    requested_direction: int       # direction the stale/legacy path wants to send
    snapshot: Snapshot


def reentry_decision(req: ReentryRequest) -> str:
    """Mirrors CheckReEntryOpportunity post-fb4866b: direction must match
    the CURRENT snapshot, not an inherited lastClose.dir."""
    if not req.snapshot.valid:
        return "REENTRY_BLOCKED_STALE_SNAPSHOT"
    if req.requested_direction != req.snapshot.signal_direction:
        return "REENTRY_BLOCKED_AFTER_SL"
    return "REENTRY_APPROVED_FRESH_CONFIRMATION"


def pyramid_add_decision(existing_direction_action: int) -> str:
    """Mirrors the v6.24.6 CheckPyramidOpportunity gate."""
    if existing_direction_action in BLOCKING_PYRAMID_ACTIONS:
        return "PYRAMID_BLOCKED_CAMPAIGN_EXHAUSTION"
    return "PYRAMID_ALLOWED"


def custom_window_1_blocks(dow: int, hour: int, minute: int, duration_min: int = 30) -> bool:
    """Mirrors IsScheduledNewsWindow's Custom window 1 math (v6.24.4: 30, not 90)."""
    if dow != 3:
        return False
    m_now = hour * 60 + minute
    win_start = 18 * 60
    return win_start <= m_now < win_start + duration_min


# ---------------------------------------------------------------------------
# July 15 timeline (from audits/v6243_reentry_snapshot_forensic_20260715.md
# and audits/v6243_mac_vps_trade_learning_20260715.md)
# ---------------------------------------------------------------------------

def test_step1_early_bearish_sells_are_independent_fresh_setups_not_hindsight():
    # 4035.09, 4027.58, 4028.30 -- each a fresh SELL against a then-current
    # bearish snapshot. Not re-entries off a stale direction; each has its
    # own valid, matching snapshot.
    for gen in (1, 2, 3):
        snap = Snapshot(valid=True, generation=gen, signal_direction=-1,
                        lifecycle=TREND_HEALTHY, exhaustion_pct=30.0 + gen * 10)
        req = ReentryRequest(requested_direction=-1, snapshot=snap)
        assert reentry_decision(req) == "REENTRY_APPROVED_FRESH_CONFIRMATION"


def test_step2_near_4027_4029_high_exhaustion_stops_new_pyramid_sells():
    # "detect high move consumption; detect rising exhaustion; set
    # ACTION_NO_MORE_ADDS; protect the SELL runner" -- the v6.24.6 gate.
    exhausted_sell_campaign_action = TRANSITION_STOP_ADDS
    assert pyramid_add_decision(exhausted_sell_campaign_action) == "PYRAMID_BLOCKED_CAMPAIGN_EXHAUSTION"


def test_step3_sell_hits_broker_sl_then_bearish_snapshot_still_stale_by_next_bar():
    # 18:25:12 SELL 0.35 hits broker SL at 4039.56 -- context only, not a ban.
    # The snapshot that existed AT THAT MOMENT was still bearish (SELL); a
    # re-entry attempt sent immediately, before the engine re-scans, must
    # still be evaluated against whatever the CURRENT snapshot is when it
    # actually reaches the check -- which by 18:27:43 was already BUY.
    stale_sell_snapshot_at_sl_instant = Snapshot(valid=True, generation=10,
                                                  signal_direction=-1,
                                                  lifecycle=TREND_EXHAUSTING,
                                                  exhaustion_pct=88.0)
    req = ReentryRequest(requested_direction=-1, snapshot=stale_sell_snapshot_at_sl_instant)
    # this alone would still approve -- the bug was never re-checking the
    # snapshot immediately before OrderSend once a NEWER one existed
    assert reentry_decision(req) == "REENTRY_APPROVED_FRESH_CONFIRMATION"


def test_step4_18_25_17_fresh_buy_snapshot_supersedes_the_stale_sell_intent():
    # 18:25:17.449: DECISION_FINGERPRINT reports TREND_PULLBACK BUY,
    # regime=TREND_UP, activeDir=BUY_ONLY -- a NEWER, current snapshot now
    # exists. The 18:27:43 stale-SELL RE_ENTRY that actually executed in
    # the incident evaluated against the OLD snapshot instead of this one.
    current_buy_snapshot = Snapshot(valid=True, generation=11, signal_direction=1,
                                     lifecycle=OPPOSITE_DIRECTION_CONFIRMED,
                                     exhaustion_pct=0.0)
    stale_sell_request = ReentryRequest(requested_direction=-1, snapshot=current_buy_snapshot)
    assert reentry_decision(stale_sell_request) == "REENTRY_BLOCKED_AFTER_SL"


def test_step5_buy_candidate_preserved_and_allowed_through_normal_path():
    current_buy_snapshot = Snapshot(valid=True, generation=11, signal_direction=1,
                                     lifecycle=OPPOSITE_DIRECTION_CONFIRMED,
                                     exhaustion_pct=0.0)
    buy_request = ReentryRequest(requested_direction=1, snapshot=current_buy_snapshot)
    assert reentry_decision(buy_request) == "REENTRY_APPROVED_FRESH_CONFIRMATION"


def test_step6_final_sell_into_4053_4066_recovery_rejected_without_fresh_bearish_reversal():
    # After BUY 0.20 (4050.52->4053.45), a SELL entered the 4053->4066 rise
    # and lost -$275.52. Under the current-snapshot authority, that SELL
    # needed its OWN fresh bearish snapshot -- reusing the BUY-superseded
    # context is exactly what's now blocked.
    current_buy_snapshot = Snapshot(valid=True, generation=12, signal_direction=1,
                                     lifecycle=TREND_EARLY, exhaustion_pct=5.0)
    late_sell_into_recovery = ReentryRequest(requested_direction=-1, snapshot=current_buy_snapshot)
    assert reentry_decision(late_sell_into_recovery) == "REENTRY_BLOCKED_AFTER_SL"


def test_step7_1929_gmt_no_longer_shows_a_custom_window_1_block():
    # the exact incident log line: "NEWS-CALENDAR: CALENDAR: Custom window 1
    # (day3 18:00 GMT +90min) — entries blocked" at 19:29 GMT. Under the
    # v6.24.4 30-minute window (expiry 18:30 GMT), 19:29 GMT is not blocked.
    assert custom_window_1_blocks(dow=3, hour=19, minute=29) is False
    assert custom_window_1_blocks(dow=3, hour=19, minute=29, duration_min=90) is True  # old behavior, for contrast


def test_full_sequence_end_to_end():
    """One consolidated replay asserting the whole chain together."""
    events = []

    # early bearish core + 2 controlled adds
    bearish_snap = Snapshot(True, 1, -1, TREND_HEALTHY, 25.0)
    events.append(reentry_decision(ReentryRequest(-1, bearish_snap)))

    # exhaustion reached near 4027-4029 -> pyramid add blocked
    events.append(pyramid_add_decision(TRANSITION_STOP_ADDS))

    # SL hit, stale SELL attempted against what is by now a fresh BUY snapshot
    buy_snap = Snapshot(True, 11, 1, OPPOSITE_DIRECTION_CONFIRMED, 0.0)
    events.append(reentry_decision(ReentryRequest(-1, buy_snap)))   # stale SELL
    events.append(reentry_decision(ReentryRequest(1, buy_snap)))    # preserved BUY

    # late SELL into the recovery, no fresh bearish snapshot exists
    events.append(reentry_decision(ReentryRequest(-1, buy_snap)))

    assert events == [
        "REENTRY_APPROVED_FRESH_CONFIRMATION",     # core SELL
        "PYRAMID_BLOCKED_CAMPAIGN_EXHAUSTION",      # no more adds near exhaustion
        "REENTRY_BLOCKED_AFTER_SL",                 # stale SELL cancelled
        "REENTRY_APPROVED_FRESH_CONFIRMATION",      # BUY preserved
        "REENTRY_BLOCKED_AFTER_SL",                 # late SELL into recovery rejected
    ]
