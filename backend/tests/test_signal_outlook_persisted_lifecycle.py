"""Focused v2 Signal Outlook lifecycle regression tests."""

from datetime import datetime, timedelta, timezone
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


def test_buy_half_r_at_17_minutes_is_immediate_green_win():
    doc, events = advance(signal(), 100.50, 100.55, 17)
    assert doc["signal_state"] == mo.SIGNAL_WIN_HALF_R
    assert doc["analytics_outcome"] == mo.ANALYTICS_WIN
    assert doc["mfe_r"] == 0.5
    assert "HALF_R_REACHED" in events


def test_sell_uses_executable_ask_for_half_r():
    pending, _ = advance(signal("SELL"), 99.40, 99.60, 10)
    assert pending["analytics_outcome"] is None  # Bid is +0.60R, Ask is only +0.40R.
    won, _ = advance(pending, 99.25, 99.50, 11)
    assert won["analytics_outcome"] == mo.ANALYTICS_WIN
    assert won["current_r"] == 0.5


def test_tp1_can_classify_win_before_half_r_threshold():
    doc = signal(tp1_price=100.40)
    won, events = advance(doc, 100.40, 100.45, 9)
    assert won["signal_state"] == mo.SIGNAL_WIN_TP1
    assert won["analytics_outcome"] == mo.ANALYTICS_WIN
    assert "TP1_HIT" in events


def test_sl_at_12_minutes_is_immediate_red_loss_event():
    lost, events = advance(signal(), 99.0, 99.05, 12)
    assert lost["signal_state"] == mo.SIGNAL_LOSS_SL
    assert lost["analytics_outcome"] == mo.ANALYTICS_LOSS
    assert lost["analytics_r"] == -1.0
    assert events == ["SL_HIT"]


def test_exact_60_minute_deadline_is_red_timeout():
    lost, events = advance(signal(), 100.20, 100.25, 60)
    assert lost["signal_state"] == mo.SIGNAL_LOSS_TIMEOUT
    assert lost["analytics_outcome"] == mo.ANALYTICS_LOSS
    assert "TIMEOUT_60M" in events


def test_half_r_after_deadline_remains_timeout_loss():
    timed_out, _ = advance(signal(), 100.20, 100.25, 60)
    late, _ = advance(timed_out, 100.60, 100.65, 61)
    assert late["analytics_outcome"] == mo.ANALYTICS_LOSS
    assert late["signal_state"] == mo.SIGNAL_LOSS_TIMEOUT
    assert late["latest_path_event"] == "LATE_HALF_R_AFTER_60M"


def test_half_r_then_later_sl_remains_win_with_path_metadata():
    won, _ = advance(signal(), 100.50, 100.55, 17)
    later, events = advance(won, 99.0, 99.05, 40)
    assert later["analytics_outcome"] == mo.ANALYTICS_WIN
    assert later["signal_state"] == mo.SIGNAL_WIN_HALF_R
    assert later["latest_path_event"] == "LATER_SL_AFTER_WIN"
    assert "SL_HIT" in events


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


def test_actionable_state_machine_never_emits_no_entry():
    lost, _ = advance(signal(), 100.1, 100.2, 60)
    assert "NO_ENTRY" not in str(lost)
    assert lost["signal_state"] == mo.SIGNAL_LOSS_TIMEOUT


def test_unavailable_history_constant_is_not_win_or_loss():
    assert mo.ANALYTICS_UNAVAILABLE not in (mo.ANALYTICS_WIN, mo.ANALYTICS_LOSS)


def test_event_payload_contains_anchor_hit_r_and_timestamps():
    won, _ = advance(signal(), 100.5, 100.55, 17)
    import notifications
    payload = notifications._build_payload(won, "HALF_R_REACHED")
    assert "entry 100.0" in payload["body"]
    assert "R 0.5" in payload["body"]
    assert won["first_half_r_at"] in payload["body"]


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
