import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from market_outlook import _canonical_m10_signal  # noqa: E402
from notifications import build_trade_notification_payload, classify_trade_activity  # noqa: E402


def test_explicit_m10_candidate_wins_over_transition_watch_context():
    evidence = {
        "ts": "2026-07-21T12:50:00+00:00",
        "m10_signal": {
            "decision": "SELL_CANDIDATE",
            "preferred_direction": "SELL",
            "confidence": 64,
            "freshness_state": "FRESH",
            "bar_time": "2026.07.21 12:50",
        },
        "entry_readiness": {"final_action": "TRANSITION_WATCH"},
        "market_thesis": {"action": "WAIT", "exhaustion_decision": "TRANSITION_WATCH"},
    }
    resolved = _canonical_m10_signal(evidence)
    assert resolved["actionable"] is True
    assert resolved["direction"] == "SELL"
    assert resolved["confidence"] == 64


def test_pressure_without_explicit_candidate_is_not_fabricated_into_signal():
    resolved = _canonical_m10_signal({
        "m10_signal": {"buy_evidence": 20, "sell_evidence": 90, "decision": "NO_VALID_SIGNAL"}
    })
    assert resolved["actionable"] is False
    assert resolved["direction"] == ""


def test_rejected_broker_open_never_notifies():
    activity = {
        "event_type": "TRADE_EXECUTED",
        "ticket": "123",
        "broker_retcode": 10030,
        "final_decision": "EXECUTED",
    }
    assert classify_trade_activity(activity) is None


def test_confirmed_open_payload_contains_real_trade_fields():
    activity = {
        "id": "event-1", "event_type": "TRADE_EXECUTED", "account": "1098", "symbol": "XAUUSD",
        "details": {
            "ticket": "12345", "broker_retcode": 10009, "final_decision": "EXECUTED",
            "position_direction": "BUY", "price": 4052.44, "volume": 0.40,
            "sl": 4045.11, "tp": 4078.30, "setup_type": "CORE",
        },
    }
    assert classify_trade_activity(activity) == "TRADE_OPENED"
    payload = build_trade_notification_payload(activity, "TRADE_OPENED")
    assert "BUY XAUUSD opened" in payload["title"]
    assert "Entry 4,052.44" in payload["body"]
    assert "Ticket 12345" in payload["body"]


def test_confirmed_close_payload_preserves_signed_loss_amount():
    activity = {
        "id": "event-2", "event_type": "TRADE_CLOSED", "event_category": "exits",
        "account": "1098", "symbol": "XAUUSD",
        "details": {
            "ticket": "12345", "position_direction": "SELL", "profit": -418.33,
            "price": 4061.20, "close_reason_exact": "BROKER_SL", "final_r": -1.0,
        },
    }
    assert classify_trade_activity(activity) == "TRADE_CLOSED"
    payload = build_trade_notification_payload(activity, "TRADE_CLOSED")
    assert "loss" in payload["title"]
    assert "P/L -$418.33" in payload["body"]
    assert "BROKER_SL" in payload["body"]
