"""v6.26.0 R-to-pips/Gold-moves migration -- customer-facing trade
notifications must never show a bare "R" unit label. Covers the two real
bugs found and fixed during the telemetry sweep:

1. build_trade_notification_payload (raw EA activity feed notifications)
   used to append f"{final_r}R" straight from the activity's final_r/
   r_multiple field. Fixed to derive result_pips from real entry/exit
   prices via market_outlook.build_result_conversion, the same conversion
   function the rest of the codebase already uses.

2. That fix's first draft had its own bug: extracting the "entry" price
   fell back to the event's own "price" field, which on a TRADE_CLOSED
   activity record is actually the CLOSE price (see
   market_outlook._build_automated_trade_result's own comment on this).
   That made entry_f == exit_f whenever a dedicated entry_price/open_price
   field wasn't posted, silently producing a false price_move of exactly
   0 instead of correctly falling back to "no pips available, omit."

3. _build_automated_trade_payload (the Outlook automated_trade_result
   notification) used to append f"{r_multiple}R" from realized_r, when
   the same result dict already carries result_pips (spread in by
   market_outlook._build_automated_trade_result's own
   build_result_conversion call) right next to it.
"""
import os
import sys

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "notification_pips_labels_pytest")
os.environ.setdefault("JWT_SECRET", "test-secret-notif-pips")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")

from notifications import build_trade_notification_payload, _build_automated_trade_payload  # noqa: E402


def test_trade_closed_notification_shows_pips_not_r_when_prices_available():
    activity = {
        "id": "event-pips-1", "event_type": "TRADE_CLOSED", "event_category": "exits",
        "account": "1098", "symbol": "XAUUSD",
        "details": {
            "ticket": "55501", "position_direction": "BUY", "profit": 250.0,
            "entry_price": 4050.00, "price": 4055.00,
            "close_reason_exact": "TP_HIT", "final_r": 1.0,
        },
    }
    payload = build_trade_notification_payload(activity, "TRADE_CLOSED")
    assert "pips" in payload["body"]
    assert "R" not in payload["body"].replace("Ticket", "").replace("TRADE", "")


def test_trade_closed_notification_never_fakes_price_move_from_single_price_field():
    """Regression test for the entry/exit-collision bug: when only "price"
    is posted (no entry_price/open_price), the entry side must NOT silently
    reuse "price" too -- that would make price_move == 0 even for a real
    -1.0R loss. Must omit the pips detail rather than show a fabricated
    "0.0 pips"."""
    activity = {
        "id": "event-pips-2", "event_type": "TRADE_CLOSED", "event_category": "exits",
        "account": "1098", "symbol": "XAUUSD",
        "details": {
            "ticket": "55502", "position_direction": "SELL", "profit": -418.33,
            "price": 4061.20, "close_reason_exact": "BROKER_SL", "final_r": -1.0,
        },
    }
    payload = build_trade_notification_payload(activity, "TRADE_CLOSED")
    assert "0.0 pips" not in payload["body"]
    assert "P/L -$418.33" in payload["body"]


def test_automated_trade_payload_shows_pips_not_r():
    doc = {
        "id": "outlook-pips-1", "primary_direction": "BUY", "symbol": "XAUUSD",
        "automated_trade_result": {
            "result": "WIN", "direction": "BUY", "symbol": "XAUUSD",
            "realized_profit": 300.0, "realized_r": 1.5,
            "result_pips": 150.0, "result_gold_moves": 15.0, "result_r": 1.5,
            "entry_price": 4050.0, "exit_price": 4065.0,
            "close_reason": "TP_HIT", "ticket": 99001,
        },
    }
    payload = _build_automated_trade_payload(doc)
    assert "150.0 pips" in payload["body"]
    assert "1.5R" not in payload["body"]


def test_automated_trade_payload_omits_pips_when_not_computed():
    """No fabrication: if result_pips genuinely isn't available, the pips
    detail is simply omitted from the notification body, never backfilled
    with a bare R value."""
    doc = {
        "id": "outlook-pips-2", "primary_direction": "SELL", "symbol": "XAUUSD",
        "automated_trade_result": {
            "result": "LOSS", "direction": "SELL", "symbol": "XAUUSD",
            "realized_profit": -80.0, "realized_r": -0.5,
            "result_pips": None, "result_gold_moves": None, "result_r": -0.5,
            "entry_price": 4050.0, "exit_price": 4055.0,
            "close_reason": "SL_HIT", "ticket": 99002,
        },
    }
    payload = _build_automated_trade_payload(doc)
    assert "pips" not in payload["body"]
    assert "R" not in payload["body"].replace("Ticket", "").replace("TRADE", "")
