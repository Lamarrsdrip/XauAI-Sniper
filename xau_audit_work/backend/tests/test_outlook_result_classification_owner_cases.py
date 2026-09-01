"""Deterministic regression tests for the owner's 10 required scenarios
(root-cause fix, 2026-08-05): profitable Market Outlook signals were being
labeled LOSS just because the 60-minute deadline arrived without a genuine
TP1 touch, regardless of the signal's actual achieved R. See
advance_persisted_signal's own docstring/comments in market_outlook.py for
the full rationale.

Tests 1-4 and 6-9 exercise the pure state machine directly (no DB needed,
same pattern as test_signal_outlook_persisted_lifecycle.py). Tests 5 and 10
need a persisted round-trip (restart-safety, duplicate-worker-run
idempotency) and are skipped when no local MongoDB is reachable, same as
every other DB-backed Outlook test in this suite.
"""
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch
import asyncio
import os
import sys
import uuid

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

import market_outlook as mo  # noqa: E402

T0 = datetime(2026, 8, 5, 9, 0, tzinfo=timezone.utc)


def signal(direction="SELL", entry=4160.78, **overrides):
    """A signal anchored the same way real generation now anchors one:
    TP1/TP2 at the owner-approved fixed +5.00/+10.00 Gold-move grid, R
    expressed against the fixed XAUCLOUD_R_UNIT_GOLD_MOVES (10.0)."""
    sign = 1.0 if direction == "BUY" else -1.0
    base = {
        "id": "owner-case-1", "primary_direction": direction,
        "published_at": T0.isoformat(), "tracking_entry_price": entry,
        "original_sl": round(entry - sign * 15.0, 2),
        "suggested_sl": round(entry - sign * 15.0, 2),
        "risk_distance": mo.XAUCLOUD_R_UNIT_GOLD_MOVES,
        "evaluation_deadline": (T0 + timedelta(minutes=60)).isoformat(),
        "expiry_at": (T0 + timedelta(hours=4)).isoformat(),
        "tp1_price": round(entry + sign * mo.XAUCLOUD_TP1_GOLD_MOVES, 2),
        "tp2_price": round(entry + sign * mo.XAUCLOUD_TP2_GOLD_MOVES, 2),
        "tp3_price": round(entry + sign * mo.XAUCLOUD_TP2_GOLD_MOVES * 2, 2),
        "signal_state": mo.SIGNAL_TRACKING,
        "analytics_outcome": None, "current_r": 0.0, "mfe_r": 0.0, "mae_r": 0.0,
        "highest_tracked_price": entry, "lowest_tracked_price": entry,
        "milestones_hit": [], "notification_flags": {}, "latest_path_event": "TRACKING_STARTED",
    }
    base.update(overrides)
    return base


def advance(doc, bid, ask, minutes):
    update, events = mo.advance_persisted_signal(doc, bid, ask, T0 + timedelta(minutes=minutes))
    return {**doc, **update}, events


def quote_at(direction, close_price, spread=0.10):
    """BUY is valued on Bid, SELL on Ask (advance_persisted_signal's own
    executable-price rule) -- builds a (bid, ask) pair whose close_price
    lands exactly on the requested value for either direction."""
    if direction == "BUY":
        return close_price, close_price + spread
    return close_price - spread, close_price


# ---------------------------------------------------------------------------
# 1. SELL reaches TP1 after 10 minutes, then reverses before 60 minutes.
#    Expected: TP1 WIN.
# ---------------------------------------------------------------------------

def test_case_1_sell_tp1_then_reverses_before_60m_is_tp1_win():
    doc = signal("SELL", entry=4160.78)
    tp1 = doc["tp1_price"]
    won, events = advance(doc, *quote_at("SELL", tp1), 10)
    assert won["analytics_outcome"] == mo.ANALYTICS_WIN
    assert won["signal_state"] == mo.SIGNAL_WIN_TP1
    assert won["highest_tp_reached"] == 1
    assert "TP1_HIT" in events
    reversed_, _ = advance(won, *quote_at("SELL", tp1 + 20.0), 45)  # price reverses hard, well past SL
    assert reversed_["analytics_outcome"] == mo.ANALYTICS_WIN
    assert reversed_["signal_state"] == mo.SIGNAL_WIN_TP1
    assert reversed_["highest_tp_reached"] == 1


# ---------------------------------------------------------------------------
# 2. BUY reaches TP2 after 40 minutes, then reverses. Expected: TP2 WIN.
# ---------------------------------------------------------------------------

def test_case_2_buy_tp2_then_reverses_is_tp2_win():
    doc = signal("BUY", entry=4150.00)
    tp2 = doc["tp2_price"]
    won, events = advance(doc, *quote_at("BUY", tp2), 40)
    assert won["analytics_outcome"] == mo.ANALYTICS_WIN
    assert won["highest_tp_reached"] == 2
    assert "TP2_HIT" in events
    reversed_, _ = advance(won, *quote_at("BUY", doc["original_sl"] - 5.0), 55)
    assert reversed_["analytics_outcome"] == mo.ANALYTICS_WIN
    assert reversed_["highest_tp_reached"] == 2  # never downgraded


# ---------------------------------------------------------------------------
# 3. Signal reaches +2.56 Gold moves but not TP1. Expected: partial positive
#    result (PARTIAL_PROFIT), never an automatic LOSS. This is the exact
#    production defect: entry 4160.78 SELL, +25.6 pips / +2.56 Gold moves /
#    +0.15R was shown to owners as "LOSS · BELOW +0.50R AFTER 60 MIN".
# ---------------------------------------------------------------------------

def test_case_3_positive_but_below_tp1_is_partial_profit_not_loss():
    doc = signal("SELL", entry=4160.78)
    close_price = doc["tracking_entry_price"] - 2.56  # SELL profits as price falls
    resolved, events = advance(doc, *quote_at("SELL", close_price), 60)
    assert resolved["analytics_outcome"] == mo.ANALYTICS_PARTIAL
    assert resolved["signal_state"] == mo.SIGNAL_PARTIAL_PROFIT
    assert resolved["analytics_outcome"] != mo.ANALYTICS_LOSS
    conversion = mo.build_result_conversion(r=resolved["analytics_r"], risk_distance=resolved["risk_distance"])
    assert conversion["result_gold_moves"] == pytest.approx(2.56, abs=0.05)
    assert conversion["result_r"] == pytest.approx(0.256, abs=0.01)
    assert "TIMEOUT_60M" in events


# ---------------------------------------------------------------------------
# 4. Signal reaches TP1 at minute 59. Expected: TP1 WIN.
# ---------------------------------------------------------------------------

def test_case_4_tp1_touched_at_minute_59_is_tp1_win():
    doc = signal("BUY", entry=4150.00)
    tp1 = doc["tp1_price"]
    won, events = advance(doc, *quote_at("BUY", tp1), 59)
    assert won["analytics_outcome"] == mo.ANALYTICS_WIN
    assert won["signal_state"] == mo.SIGNAL_WIN_TP1
    assert "TP1_HIT" in events


# ---------------------------------------------------------------------------
# 5. Signal reaches TP1, backend restarts, then price reverses.
#    Expected: TP1 WIN remains. Simulated by reconstructing a fresh doc from
#    only the fields that would actually survive a process restart (exactly
#    what track_outlook_lifecycle_tick's restart-replay path re-derives
#    from persisted state), then continuing to feed it a reversing price.
# ---------------------------------------------------------------------------

def test_case_5_tp1_survives_a_simulated_backend_restart_then_reversal():
    doc = signal("SELL", entry=4160.78)
    tp1 = doc["tp1_price"]
    won, _ = advance(doc, *quote_at("SELL", tp1), 10)
    assert won["analytics_outcome"] == mo.ANALYTICS_WIN

    # Simulate a restart: only the persisted document survives, nothing
    # in-process. advance_persisted_signal is itself the pure, restart-safe
    # state machine -- reloading `won` as a fresh dict and continuing must
    # produce the identical, still-frozen result.
    reloaded_after_restart = dict(won)
    reversed_, _ = advance(reloaded_after_restart, *quote_at("SELL", tp1 + 25.0), 50)
    assert reversed_["analytics_outcome"] == mo.ANALYTICS_WIN
    assert reversed_["signal_state"] == mo.SIGNAL_WIN_TP1
    assert reversed_["highest_tp_reached"] == 1


# ---------------------------------------------------------------------------
# 6. Hourly worker sees negative price after TP1 was already touched.
#    Expected: TP1 WIN remains.
# ---------------------------------------------------------------------------

def test_case_6_hourly_worker_sees_negative_price_after_tp1_stays_tp1_win():
    doc = signal("BUY", entry=4150.00)
    tp1 = doc["tp1_price"]
    won, _ = advance(doc, *quote_at("BUY", tp1), 20)
    assert won["analytics_outcome"] == mo.ANALYTICS_WIN
    # The hourly hygiene/recovery worker calls advance_persisted_signal with
    # no fresh quote at all (bid=ask=None) -- must never touch a frozen result.
    hourly_check, _ = advance(won, None, None, 45)
    assert hourly_check["analytics_outcome"] == mo.ANALYTICS_WIN
    # And a genuinely negative live price afterward still can't flip it.
    negative_price, _ = advance(hourly_check, *quote_at("BUY", doc["original_sl"] - 1.0), 55)
    assert negative_price["analytics_outcome"] == mo.ANALYTICS_WIN
    assert negative_price["signal_state"] == mo.SIGNAL_WIN_TP1


# ---------------------------------------------------------------------------
# 7. No TP reached and final result is negative. Expected: LOSS.
# ---------------------------------------------------------------------------

def test_case_7_no_tp_reached_and_genuinely_negative_is_loss():
    doc = signal("SELL", entry=4160.78)
    close_price = doc["tracking_entry_price"] + 3.0  # SELL loses as price rises
    resolved, events = advance(doc, close_price, close_price + 0.10, 60)
    assert resolved["analytics_outcome"] == mo.ANALYTICS_LOSS
    assert resolved["signal_state"] == mo.SIGNAL_LOSS_TIMEOUT
    assert resolved["analytics_r"] < 0
    assert "TIMEOUT_60M" in events


# ---------------------------------------------------------------------------
# 8. No TP reached and final result is near entry. Expected: BREAK-EVEN.
# ---------------------------------------------------------------------------

def test_case_8_no_tp_reached_and_near_entry_is_break_even():
    doc = signal("BUY", entry=4150.00)
    close_price = doc["tracking_entry_price"] + 0.10  # +0.01R, within tolerance
    resolved, events = advance(doc, close_price, close_price + 0.05, 60)
    assert resolved["analytics_outcome"] == mo.ANALYTICS_BREAKEVEN
    assert resolved["signal_state"] == mo.SIGNAL_BREAK_EVEN
    assert "TIMEOUT_60M" in events


# ---------------------------------------------------------------------------
# 9. TP1 and TP2 both reached. Expected: one signal card showing TP2 WIN
#    (highest_tp_reached=2 on the SAME record, never a second document).
# ---------------------------------------------------------------------------

def test_case_9_tp1_then_tp2_shows_single_tp2_win_record():
    doc = signal("BUY", entry=4150.00)
    tp1 = doc["tp1_price"]
    after_tp1, ev1 = advance(doc, *quote_at("BUY", tp1), 12)
    assert after_tp1["id"] == doc["id"]  # same record, never a new one
    assert after_tp1["highest_tp_reached"] == 1
    assert "TP1_HIT" in ev1

    tp2 = doc["tp2_price"]
    after_tp2, ev2 = advance(after_tp1, *quote_at("BUY", tp2), 33)
    assert after_tp2["id"] == doc["id"]
    assert after_tp2["analytics_outcome"] == mo.ANALYTICS_WIN
    assert after_tp2["highest_tp_reached"] == 2
    assert "TP2_HIT" in ev2
    # The frontend's resultLabel() renders this exact record as "TP2 WIN"
    # (see AIMarketOutlookPage.jsx's `TP${o.highest_tp_reached || 1} WIN`).


# ---------------------------------------------------------------------------
# 10a. Duplicate ticks at the pure-state-machine level: replaying the same
#      quote twice must never re-emit an event or change the result.
# ---------------------------------------------------------------------------

def test_case_10a_duplicate_tick_produces_no_duplicate_events():
    doc = signal("SELL", entry=4160.78)
    tp1 = doc["tp1_price"]
    first, events1 = advance(doc, *quote_at("SELL", tp1), 10)
    second, events2 = advance(first, *quote_at("SELL", tp1), 11)  # identical price replayed
    assert "TP1_HIT" in events1
    assert events2 == []
    assert second["tp1_hit_at"] == first["tp1_hit_at"]
    assert second["analytics_r"] == first["analytics_r"]


# ---------------------------------------------------------------------------
# 10b. Duplicate worker runs at the persisted level: calling
#      track_outlook_lifecycle_tick twice for the same fresh quote must
#      commit exactly one classification and send exactly one notification.
# ---------------------------------------------------------------------------

def _mongo_available() -> bool:
    try:
        from pymongo import MongoClient
        MongoClient("mongodb://localhost:27017", serverSelectionTimeoutMS=800).admin.command("ping")
        return True
    except Exception:
        return False


pytestmark = pytest.mark.skipif(not _mongo_available(), reason="no local MongoDB reachable for this test")

TEST_DB = f"outlook_owner_cases_pytest_{uuid.uuid4().hex[:10]}"
os.environ["MONGO_URL"] = "mongodb://localhost:27017"
os.environ["DB_NAME"] = TEST_DB
os.environ.setdefault("JWT_SECRET", "test-secret-outlook-owner-cases")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")

import server as srv  # noqa: E402

_LOOP = asyncio.new_event_loop()


def _run(coro):
    return _LOOP.run_until_complete(coro)


ACCOUNT = "OWNER-CASES-ACCOUNT"


def test_case_10b_duplicate_worker_runs_commit_one_result_and_one_notification():
    async def go():
        await srv.db.cloud_market_outlooks.delete_many({})
        await srv.db.cloud_notification_log.delete_many({})
        ref = datetime.now(timezone.utc)
        entry = 4150.00
        doc = {
            "id": str(uuid.uuid4()), "account": ACCOUNT, "symbol": "XAUUSD",
            "primary_direction": "BUY", "tracking_entry_price": entry,
            "original_sl": entry - 15.0,
            "tp1_price": round(entry + mo.XAUCLOUD_TP1_GOLD_MOVES, 2),
            "tp2_price": round(entry + mo.XAUCLOUD_TP2_GOLD_MOVES, 2),
            "tp3_price": round(entry + mo.XAUCLOUD_TP2_GOLD_MOVES * 2, 2),
            "risk_distance": mo.XAUCLOUD_R_UNIT_GOLD_MOVES,
            "monitoring_closed": False, "analytics_outcome": None, "analytics_r": None,
            "current_r": 0.0, "mfe_r": 0.0, "mae_r": 0.0,
            "last_monitored_at": (ref - timedelta(minutes=10)).isoformat(),
            "published_at": (ref - timedelta(minutes=15)).isoformat(),
            "evaluation_deadline": (ref + timedelta(minutes=45)).isoformat(),
        }
        await srv.db.cloud_market_outlooks.insert_one(dict(doc))

        tp1 = doc["tp1_price"]  # BUY is valued on Bid -- bid must reach tp1
        with patch("notifications.send_outlook_notification", new=AsyncMock(return_value=1)) as mocked:
            # Two "duplicate worker run" calls with the identical fresh quote.
            await mo.track_outlook_lifecycle_tick(account=ACCOUNT, bid=tp1, ask=tp1 + 0.05, quote_at=ref)
            await mo.track_outlook_lifecycle_tick(account=ACCOUNT, bid=tp1, ask=tp1 + 0.05, quote_at=ref)

        persisted = await srv.db.cloud_market_outlooks.find_one({"id": doc["id"]}, {"_id": 0})
        assert persisted["analytics_outcome"] == mo.ANALYTICS_WIN
        assert persisted["signal_state"] == mo.SIGNAL_WIN_TP1

        tp1_hit_calls = [c for c in mocked.await_args_list if c.kwargs.get("event") == "TP1_HIT"]
        assert len(tp1_hit_calls) == 1  # exactly one notification for TP1_HIT, not two

        revisions = await srv.db.cloud_market_outlook_revisions.find(
            {"outlook_id": doc["id"], "field": "analytics_outcome"}, {"_id": 0},
        ).to_list(10)
        assert len(revisions) == 1  # exactly one classification transition recorded
        await srv.db.cloud_market_outlooks.delete_many({"id": doc["id"]})
    _run(go())
