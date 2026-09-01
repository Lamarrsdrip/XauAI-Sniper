"""Focused v2 Signal Outlook lifecycle regression tests."""

from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sys

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

import market_outlook as mo  # noqa: E402
from market_outlook_routes import compute_outlook_stats  # noqa: E402


T0 = datetime(2026, 7, 18, 12, 0, tzinfo=timezone.utc)


def signal(direction="BUY", **overrides):
    entry = 100.0
    base = {
        "id": "signal-1", "primary_direction": direction,
        "published_at": T0.isoformat(), "tracking_entry_price": entry,
        "original_sl": 99.0 if direction == "BUY" else 101.0,
        "suggested_sl": 99.0 if direction == "BUY" else 101.0,
        "risk_distance": 1.0, "evaluation_deadline": (T0 + timedelta(minutes=60)).isoformat(),
        "expiry_at": (T0 + timedelta(hours=4)).isoformat(),
        "tp1_price": 101.0 if direction == "BUY" else 99.0,
        "tp2_price": 102.0 if direction == "BUY" else 98.0,
        "tp3_price": 103.0 if direction == "BUY" else 97.0,
        "tp1_r": 1.0, "signal_state": mo.SIGNAL_TRACKING,
        "analytics_outcome": None, "current_r": 0.0, "mfe_r": 0.0, "mae_r": 0.0,
        "highest_tracked_price": entry, "lowest_tracked_price": entry,
        "milestones_hit": [], "notification_flags": {}, "latest_path_event": "TRACKING_STARTED",
    }
    base.update(overrides)
    return base


def advance(doc, bid, ask, minutes):
    update, events = mo.advance_persisted_signal(doc, bid, ask, T0 + timedelta(minutes=minutes))
    return {**doc, **update}, events


def test_buy_half_r_alone_is_recorded_but_does_not_win():
    """Owner-approved rule (2026-08-04): the generic +0.50R threshold no
    longer independently wins a signal -- only a genuine TP1 price touch
    does. Entry 100, tp1_price=101.0: reaching 100.50 is +0.50R but tp1
    genuinely was not touched, so this must stay TRACKING, not WIN."""
    doc, events = advance(signal(), 100.50, 100.55, 17)
    assert doc["analytics_outcome"] is None
    assert doc["signal_state"] == mo.SIGNAL_TRACKING
    assert doc["mfe_r"] == 0.5
    assert "HALF_R_REACHED" in events  # still recorded as an informational milestone
    assert doc["first_half_r_at"] is not None


def test_sell_uses_executable_ask_for_tp1_touch():
    pending, _ = advance(signal("SELL"), 99.40, 99.60, 10)
    assert pending["analytics_outcome"] is None  # Bid is +0.60R, Ask is only +0.40R (tp1_price=99.0 not yet touched).
    won, _ = advance(pending, 98.90, 99.00, 11)  # Ask reaches tp1_price=99.0 -- genuine touch.
    assert won["analytics_outcome"] == mo.ANALYTICS_WIN
    assert won["signal_state"] == mo.SIGNAL_WIN_TP1


def test_tp1_can_classify_win_before_half_r_threshold():
    doc = signal(tp1_price=100.40, tp1_r=1.75)
    won, events = advance(doc, 100.40, 100.45, 9)
    assert won["signal_state"] == mo.SIGNAL_WIN_TP1
    assert won["analytics_outcome"] == mo.ANALYTICS_WIN
    assert won["analytics_r"] == 0.4  # executable anchor R, not stale suggested-zone tp1_r
    assert "TP1_HIT" in events


def test_sl_at_12_minutes_is_recorded_but_never_finalizes_alone():
    """Owner-approved rule (2026-08-04): SL touching must never by itself
    finalize the result or stop monitoring anymore -- the signal stays
    open in case a TP is reached later in the same evaluation window."""
    touched, events = advance(signal(), 99.0, 99.05, 12)
    assert touched["analytics_outcome"] is None
    assert touched["signal_state"] == mo.SIGNAL_TRACKING
    assert touched["sl_hit_at"] is not None
    assert touched["monitoring_closed"] is False
    assert events == ["SL_HIT"]


def test_sl_then_tp1_within_the_window_is_still_a_win():
    """The exact bug this fix addresses: price dips to SL, then later
    reaches TP1, all inside the same 60-minute window -- must be WIN, not
    LOSS."""
    dipped, _ = advance(signal(), 99.0, 99.05, 12)
    assert dipped["analytics_outcome"] is None
    won, events = advance(dipped, 101.0, 101.05, 30)
    assert won["analytics_outcome"] == mo.ANALYTICS_WIN
    assert won["signal_state"] == mo.SIGNAL_WIN_TP1
    assert "TP1_HIT" in events


def test_exact_60_minute_deadline_with_positive_r_is_partial_profit_not_loss():
    """Root-cause fix (2026-08-05): a signal that reaches its 60-minute
    deadline still positive but short of TP1 must never be forced into
    LOSS just because no TP was touched -- this is the exact bug that
    marked a genuine +0.15R/+2.56-Gold-move signal a LOSS in production."""
    resolved, events = advance(signal(), 100.20, 100.25, 60)
    assert resolved["signal_state"] == mo.SIGNAL_PARTIAL_PROFIT
    assert resolved["analytics_outcome"] == mo.ANALYTICS_PARTIAL
    assert resolved["analytics_r"] == 0.2
    assert "TIMEOUT_60M" in events


def test_exact_60_minute_deadline_with_negative_r_is_still_a_loss():
    """A genuinely negative close at the deadline (beyond
    BREAK_EVEN_R_TOLERANCE) remains a real LOSS -- this fix narrows the old
    blanket rule, it does not remove LOSS as an outcome."""
    lost, events = advance(signal(), 99.70, 99.75, 60)
    assert lost["signal_state"] == mo.SIGNAL_LOSS_TIMEOUT
    assert lost["analytics_outcome"] == mo.ANALYTICS_LOSS
    assert lost["analytics_r"] == -0.3
    assert "TIMEOUT_60M" in events


def test_exact_60_minute_deadline_near_entry_is_break_even():
    resolved, events = advance(signal(), 100.02, 100.05, 60)
    assert resolved["signal_state"] == mo.SIGNAL_BREAK_EVEN
    assert resolved["analytics_outcome"] == mo.ANALYTICS_BREAKEVEN
    assert resolved["analytics_r"] == 0.02
    assert "TIMEOUT_60M" in events


def test_half_r_without_genuine_tp1_touch_at_deadline_is_partial_profit():
    """+0.50R alone (entry 100, tp1_price=101.0, price only reached 100.50)
    is not a genuine TP1 touch -- with no TP ever touched by the deadline,
    this resolves against its own achieved R: +0.50R here is a positive
    close below TP1, so PARTIAL_PROFIT, not an automatic LOSS or WIN."""
    resolved, events = advance(signal(), 100.50, 100.55, 60)
    assert resolved["analytics_outcome"] == mo.ANALYTICS_PARTIAL
    assert resolved["signal_state"] == mo.SIGNAL_PARTIAL_PROFIT
    assert "TIMEOUT_60M" in events


def test_sl_first_observed_after_deadline_is_timeout_partial_profit_not_sl_loss():
    resolved, events = advance(signal(current_r=0.2, last_tracked_price=100.2), 99.0, 99.05, 61)
    assert resolved["analytics_outcome"] == mo.ANALYTICS_PARTIAL
    assert resolved["signal_state"] == mo.SIGNAL_PARTIAL_PROFIT
    assert resolved["analytics_r"] == 0.2
    assert resolved["latest_path_event"] == "LATE_SL_AFTER_60M"
    assert {"TIMEOUT_60M", "SL_HIT"}.issubset(events)
    assert resolved["event_snapshots"]["TIMEOUT_60M"]["hit_price"] == 100.2
    assert resolved["event_snapshots"]["SL_HIT"]["hit_price"] == 99.0


def test_half_r_after_deadline_remains_partial_profit_not_loss():
    timed_out, _ = advance(signal(), 100.20, 100.25, 60)
    late, _ = advance(timed_out, 100.60, 100.65, 61)
    assert late["analytics_outcome"] == mo.ANALYTICS_PARTIAL
    assert late["signal_state"] == mo.SIGNAL_PARTIAL_PROFIT
    assert late["latest_path_event"] == "LATE_HALF_R_AFTER_60M"


def test_tp1_then_later_sl_remains_win_with_path_metadata():
    won, _ = advance(signal(), 101.0, 101.05, 17)
    assert won["analytics_outcome"] == mo.ANALYTICS_WIN
    later, events = advance(won, 99.0, 99.05, 40)
    assert later["analytics_outcome"] == mo.ANALYTICS_WIN
    assert later["signal_state"] == mo.SIGNAL_WIN_TP1
    assert later["latest_path_event"] == "LATER_SL_AFTER_WIN"
    assert "SL_HIT" in events


def test_tp3_win_closes_monitoring_since_it_is_the_maximum_target():
    won, _ = advance(signal(), 103.0, 103.05, 20)
    assert won["analytics_outcome"] == mo.ANALYTICS_WIN
    assert won["highest_tp_reached"] == 3
    assert won["monitoring_closed"] is True


def test_tp1_win_keeps_monitoring_open_and_upgrades_to_tp2():
    """A TP1-only win must keep monitoring open (TP2/TP3 could still be
    reached) and the stored result must upgrade to reflect the higher TP
    once it's touched -- "highest TP achieved" per the owner-approved rule."""
    won, _ = advance(signal(), 101.0, 101.05, 17)
    assert won["analytics_outcome"] == mo.ANALYTICS_WIN
    assert won["highest_tp_reached"] == 1
    assert won["monitoring_closed"] is False

    upgraded, events = advance(won, 102.0, 102.05, 25)
    assert upgraded["analytics_outcome"] == mo.ANALYTICS_WIN
    assert upgraded["highest_tp_reached"] == 2
    assert upgraded["latest_path_event"] == "TP2_HIT"
    assert "TP2_HIT" in events
    assert upgraded["monitoring_closed"] is False  # TP3 is still reachable

    maxed, _ = advance(upgraded, 103.0, 103.05, 30)
    assert maxed["highest_tp_reached"] == 3
    assert maxed["latest_path_event"] == "TP3_HIT"
    assert maxed["monitoring_closed"] is True


def test_transition_is_informational_and_not_advanced():
    update, events = mo.advance_persisted_signal({"primary_direction": "TRANSITION"}, 100, 101, T0)
    assert update == {}
    assert events == []


def test_restart_resume_preserves_existing_mfe_and_mae():
    adverse, _ = advance(signal(), 99.80, 99.85, 5)
    assert adverse["mae_r"] == -0.2
    resumed, _ = advance(dict(adverse), 100.30, 100.35, 8)
    assert resumed["mae_r"] == -0.2
    assert resumed["mfe_r"] == 0.3


def test_repeated_quote_has_no_duplicate_events():
    first, events1 = advance(signal(), 101.0, 101.05, 20)
    second, events2 = advance(first, 101.0, 101.05, 21)
    assert "TP1_HIT" in events1
    assert events2 == []
    assert second["tp1_hit_at"] == first["tp1_hit_at"]


def test_buy_uses_bid_not_ask():
    doc, _ = advance(signal(), 100.40, 100.60, 10)
    assert doc["current_r"] == 0.4
    assert doc["analytics_outcome"] is None


def test_publication_anchor_includes_initial_spread_in_mae():
    # Root-cause fix (2026-08-05): current_r/mae_r are now the initial
    # spread's price move divided by the fixed XAUCLOUD_R_UNIT_GOLD_MOVES
    # (10.0), not the real SL distance -- -0.1 price move / 10.0 = -0.01R.
    buy = mo._build_tracking_anchor("BUY", 100.0, 100.1, 99.1)
    sell = mo._build_tracking_anchor("SELL", 100.0, 100.1, 101.0)
    assert buy["tracking_entry_price"] == 100.1
    assert sell["tracking_entry_price"] == 100.0
    assert buy["risk_distance"] == mo.XAUCLOUD_R_UNIT_GOLD_MOVES
    assert buy["current_r"] == -0.01 and buy["mae_r"] == -0.01
    assert sell["current_r"] == -0.01 and sell["mae_r"] == -0.01
    assert mo._build_tracking_anchor("BUY", 100.0, 100.1, 101.0) is None
    assert mo._build_tracking_anchor("SELL", 100.0, 100.1, 99.0) is None


def test_target_ladder_must_be_directionally_profitable_and_ordered():
    assert mo._targets_have_valid_geometry("BUY", 100.0, 100.4, 101.0, 102.0)
    assert mo._targets_have_valid_geometry("SELL", 100.0, 99.6, 99.0, 98.0)
    assert not mo._targets_have_valid_geometry("BUY", 100.0, 0, 101.0, 102.0)
    assert not mo._targets_have_valid_geometry("BUY", 100.0, 99.9, 101.0, 102.0)
    assert not mo._targets_have_valid_geometry("SELL", 100.0, 100.1, 99.0, 98.0)
    assert not mo._targets_have_valid_geometry("SELL", 100.0, 99.0, 99.5, 98.0)


def test_corrupt_target_ladder_never_creates_false_tp_win():
    corrupt = signal(tp1_price=0.0, tp2_price=99.0, tp3_price=98.0)
    pending, events = advance(corrupt, 100.10, 100.15, 10)
    assert pending["analytics_outcome"] is None
    assert pending.get("tp1_hit_at") is None
    assert not any(event.startswith("TP") for event in events)


def test_actionable_state_machine_never_emits_no_entry():
    resolved, _ = advance(signal(), 100.1, 100.2, 60)
    assert "NO_ENTRY" not in str(resolved)
    assert resolved["signal_state"] == mo.SIGNAL_PARTIAL_PROFIT


def test_unavailable_history_constant_is_not_win_or_loss():
    assert mo.ANALYTICS_UNAVAILABLE not in (mo.ANALYTICS_WIN, mo.ANALYTICS_LOSS)


def test_event_payload_contains_anchor_hit_r_and_timestamps():
    won, _ = advance(signal(), 100.5, 100.55, 17)
    import notifications
    payload = notifications._build_payload(won, "HALF_R_REACHED")
    assert "entry 100.0" in payload["body"]
    assert "R 0.5" in payload["body"]
    assert won["first_half_r_at"] in payload["body"]


def test_delayed_notification_uses_immutable_event_quote_not_later_market_price():
    won, _ = advance(signal(), 100.5, 100.55, 17)
    later, _ = advance(won, 100.9, 100.95, 25)
    import notifications
    payload = notifications._build_payload(later, "HALF_R_REACHED")
    assert "hit 100.5" in payload["body"]
    assert "R 0.5" in payload["body"]
    assert "100.9" not in payload["body"]


def test_timeout_event_snapshot_preserves_deadline_checkpoint():
    timed_out, events = advance(signal(current_r=0.2, last_tracked_price=100.2), None, None, 60)
    assert "TIMEOUT_60M" in events
    snapshot = timed_out["event_snapshots"]["TIMEOUT_60M"]
    assert snapshot["event_at"] == (T0 + timedelta(minutes=60)).isoformat()
    assert snapshot["hit_price"] == 100.2
    assert snapshot["achieved_r"] == 0.2


def test_analytics_denominator_excludes_pending_transition_and_unavailable():
    rows = [
        {"primary_direction": "BUY", "analytics_outcome": mo.ANALYTICS_WIN,
         "analytics_r": 0.5, "highest_tp_reached": 1, "mfe_r": 0.8, "mae_r": -0.1},
        {"primary_direction": "SELL", "analytics_outcome": mo.ANALYTICS_LOSS,
         "analytics_r": -0.2, "highest_tp_reached": 0, "mfe_r": 0.3, "mae_r": -0.4},
        {"primary_direction": "BUY", "analytics_outcome": None,
         "mfe_r": 0.2, "mae_r": -0.05},
        {"primary_direction": "TRANSITION", "analytics_outcome": None},
        {"primary_direction": "SELL", "analytics_outcome": mo.ANALYTICS_UNAVAILABLE,
         "historical_repair_status": mo.ANALYTICS_UNAVAILABLE,
         "excluded_from_signal_analytics": True},
    ]
    stats = compute_outlook_stats(rows)
    assert stats["wins"] == 1
    assert stats["losses"] == 1
    assert stats["win_rate"] == 0.5
    assert stats["resolved_count"] == 2
    assert stats["active_unresolved_count"] == 1
    assert stats["informational_outlooks"] == 1
    assert stats["unavailable_historical_count"] == 1
    assert stats["total_r"] == 0.3
    assert stats["tp1_hit_rate"] == 0.5


def test_all_win_filtered_stats_are_json_serializable():
    stats = compute_outlook_stats([{
        "primary_direction": "BUY", "analytics_outcome": mo.ANALYTICS_WIN,
        "analytics_r": 0.5, "highest_tp_reached": 1, "mfe_r": 0.8, "mae_r": -0.1,
    }])
    assert stats["profit_factor"] is None
    json.dumps(stats, allow_nan=False)
