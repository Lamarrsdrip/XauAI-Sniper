"""Tests for the automated-trade-result reconciliation layer: linking a
published Market Outlook signal to the REAL automated trade (if any) that
followed it, sourced from trade_journal (broker-confirmed data), kept
strictly separate from the outlook's own advisory price-tracking fields.

Covers deterministic matching (account/symbol/direction/time-window/entry
tolerance), the no-guessing rule for zero/multiple candidates, idempotency
(a matched result can never be overwritten or flipped back), the real-time
trigger from a simulated /journal/log close event, and the honest
WIN/LOSS/BREAK_EVEN-from-profit classification (never inferred from
exit_reason text alone).
"""
import sys
import os
import uuid
import asyncio
from datetime import datetime, timedelta, timezone

import pytest

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)


def _mongo_available() -> bool:
    try:
        from pymongo import MongoClient
        MongoClient("mongodb://localhost:27017", serverSelectionTimeoutMS=800).admin.command("ping")
        return True
    except Exception:
        return False


pytestmark = pytest.mark.skipif(not _mongo_available(), reason="no local MongoDB reachable for this test")

TEST_DB = f"outlook_reconciliation_pytest_{uuid.uuid4().hex[:10]}"
os.environ["MONGO_URL"] = "mongodb://localhost:27017"
os.environ["DB_NAME"] = TEST_DB
os.environ.setdefault("JWT_SECRET", "test-secret-outlook-reconciliation")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")

import server as srv  # noqa: E402
import market_outlook as mo  # noqa: E402

_LOOP = asyncio.new_event_loop()


def _run(coro):
    return _LOOP.run_until_complete(coro)


ACCOUNT = "12345678"


async def _clear():
    await srv.db.trade_journal.delete_many({})
    await srv.db.cloud_market_outlooks.delete_many({})


# A single shared reference instant for a test case's outlook + trade,
# rather than two independent datetime.now() calls (which previously made
# the trade's opened_at nondeterministically land a fraction of a second
# BEFORE the outlook's published_at depending on call order -- correctly
# excluded by the "trade must open at/after publication" window check, but
# not what these tests meant to exercise).
_REF = datetime.now(timezone.utc)


def _outlook_doc(**overrides):
    doc = {
        "id": str(uuid.uuid4()),
        "account": ACCOUNT,
        "symbol": "XAUUSD",
        "primary_direction": "BUY",
        "published_at": _REF.isoformat(),
        "expiry_at": (_REF + timedelta(hours=4)).isoformat(),
        "tracking_entry_price": 2650.0,
        "risk_distance": 5.0,
    }
    doc.update(overrides)
    return doc


def _trade(**overrides):
    trade = {
        "ticket": 1001,
        "account_login": ACCOUNT,
        "symbol": "XAUUSD",
        "direction": "BUY",
        "entry_price": 2650.5,
        "price": 2660.0,
        "profit": 150.0,
        "final_r": 2.0,
        "exit_reason": "TAKE_PROFIT_1R",
        "opened_at": int((_REF + timedelta(minutes=5)).timestamp()),
        "closed_at": int((_REF + timedelta(minutes=35)).timestamp()),
    }
    trade.update(overrides)
    return trade


class TestFindMatchingTrade:
    def test_no_match_when_no_trades_exist(self):
        async def go():
            await _clear()
            result = await mo._find_matching_automated_trade(_outlook_doc())
            assert result["status"] == "no_trade_found"
        _run(go())

    def test_matches_single_candidate(self):
        async def go():
            await _clear()
            await srv.db.trade_journal.insert_one(_trade())
            result = await mo._find_matching_automated_trade(_outlook_doc())
            assert result["status"] == "matched"
            assert result["trade"]["ticket"] == 1001
        _run(go())

    def test_uncertain_with_multiple_candidates_never_guesses(self):
        async def go():
            await _clear()
            await srv.db.trade_journal.insert_one(_trade(ticket=1001, entry_price=2650.5))
            await srv.db.trade_journal.insert_one(_trade(ticket=1002, entry_price=2650.8))
            result = await mo._find_matching_automated_trade(_outlook_doc())
            assert result["status"] == "uncertain"
            assert set(result["candidate_tickets"]) == {1001, 1002}
        _run(go())

    def test_wrong_direction_not_matched(self):
        async def go():
            await _clear()
            await srv.db.trade_journal.insert_one(_trade(direction="SELL"))
            result = await mo._find_matching_automated_trade(_outlook_doc(primary_direction="BUY"))
            assert result["status"] == "no_trade_found"
        _run(go())

    def test_wrong_account_not_matched(self):
        async def go():
            await _clear()
            await srv.db.trade_journal.insert_one(_trade(account_login="99999999"))
            result = await mo._find_matching_automated_trade(_outlook_doc(account=ACCOUNT))
            assert result["status"] == "no_trade_found"
        _run(go())

    def test_entry_price_outside_tolerance_not_matched(self):
        async def go():
            await _clear()
            # risk_distance=5.0, tolerance=0.5R=2.5 -- 20 points away is well outside
            await srv.db.trade_journal.insert_one(_trade(entry_price=2670.0))
            result = await mo._find_matching_automated_trade(_outlook_doc(tracking_entry_price=2650.0, risk_distance=5.0))
            assert result["status"] == "no_trade_found"
        _run(go())

    def test_trade_opened_outside_time_window_not_matched(self):
        async def go():
            await _clear()
            now = datetime.now(timezone.utc)
            old_trade = _trade(opened_at=int((now - timedelta(days=2)).timestamp()))
            await srv.db.trade_journal.insert_one(old_trade)
            result = await mo._find_matching_automated_trade(_outlook_doc())
            assert result["status"] == "no_trade_found"
        _run(go())

    def test_open_trade_not_closed_yet_not_matched(self):
        async def go():
            await _clear()
            await srv.db.trade_journal.insert_one(_trade(closed_at=0))
            result = await mo._find_matching_automated_trade(_outlook_doc())
            assert result["status"] == "no_trade_found"
        _run(go())


class TestClassification:
    def test_profitable_trade_with_tp_reason_is_tp_hit(self):
        result = mo._classify_automated_close(_trade(profit=150.0, exit_reason="TAKE_PROFIT_1R"))
        assert result == "TP_HIT"

    def test_losing_trade_with_sl_reason_is_sl_hit(self):
        result = mo._classify_automated_close(_trade(profit=-80.0, exit_reason="STOP_LOSS"))
        assert result == "SL_HIT"

    def test_profit_sign_always_wins_over_misleading_reason_text(self):
        """A losing trade whose exit_reason happens to contain "TP"-like
        text (e.g. a owner-specific exit tag) must never be reported as a
        TP hit -- the realized P/L sign is authoritative."""
        result = mo._classify_automated_close(_trade(profit=-50.0, exit_reason="OWNER_R_EXIT_TP_PARTIAL_THEN_REVERSAL"))
        assert result == "LOSS"

    def test_unrecognized_exit_reason_falls_back_to_plain_win(self):
        result = mo._classify_automated_close(_trade(profit=75.0, exit_reason="OWNER_R_EXIT_GIVEBACK_45"))
        assert result == "WIN"

    def test_unrecognized_exit_reason_falls_back_to_plain_loss(self):
        result = mo._classify_automated_close(_trade(profit=-30.0, exit_reason="RUNNER_CONTINUATION_FAILED"))
        assert result == "LOSS"

    def test_break_even(self):
        result = mo._classify_automated_close(_trade(profit=0.0, exit_reason="MANUAL_CLOSE"))
        assert result == "BREAK_EVEN"


class TestResultConversion:
    """Owner-approved XauCloud convention: 1.00 Gold price move = 10
    XauCloud pips, so TP1 (+0.50R) = +5.00 Gold moves = +50 XauCloud pips.
    This is the one function every customer-facing surface must use."""

    def test_sell_example_from_spec(self):
        # entry 4061.00, TP1 4056.00 -> +5.00 price move in the profitable direction
        conversion = mo.build_result_conversion(price_move=4061.00 - 4056.00, r=0.5)
        assert conversion == {"result_r": 0.5, "result_gold_moves": 5.0, "result_pips": 50.0}

    def test_buy_example_from_spec(self):
        # entry 4050.00, TP1 4055.00 -> same +5.00 result
        conversion = mo.build_result_conversion(price_move=4055.00 - 4050.00, r=0.5)
        assert conversion == {"result_r": 0.5, "result_gold_moves": 5.0, "result_pips": 50.0}

    def test_derives_price_move_from_r_and_risk_distance(self):
        conversion = mo.build_result_conversion(r=1.0, risk_distance=10.0)
        assert conversion == {"result_r": 1.0, "result_gold_moves": 10.0, "result_pips": 100.0}

    def test_derives_r_from_price_move_and_risk_distance(self):
        conversion = mo.build_result_conversion(price_move=-17.59, risk_distance=17.59)
        assert conversion["result_r"] == -1.0
        assert conversion["result_pips"] == -175.9

    def test_missing_inputs_return_none_not_zero(self):
        conversion = mo.build_result_conversion(r=0.5)
        assert conversion == {"result_r": 0.5, "result_gold_moves": None, "result_pips": None}

    def test_automated_trade_result_includes_conversion_fields(self):
        trade = _trade(direction="SELL", entry_price=4061.00, price=4056.00, final_r=0.5)
        result = mo._build_automated_trade_result(trade)
        assert result["result_gold_moves"] == 5.0
        assert result["result_pips"] == 50.0
        assert result["result_r"] == 0.5


class TestReconcileAutomatedTradeResult:
    def test_persists_matched_result_with_real_fields(self):
        async def go():
            await _clear()
            await srv.db.trade_journal.insert_one(_trade())
            doc = _outlook_doc()
            await srv.db.cloud_market_outlooks.insert_one(dict(doc))
            result = await mo.reconcile_automated_trade_result(doc)
            assert result["status"] == "matched"
            assert result["ticket"] == 1001
            assert result["realized_profit"] == 150.0
            assert result["realized_r"] == 2.0
            assert result["result"] == "TP_HIT"
            persisted = await srv.db.cloud_market_outlooks.find_one({"id": doc["id"]}, {"_id": 0})
            assert persisted["automated_trade_result"]["status"] == "matched"
        _run(go())

    def test_never_touches_advisory_tracking_fields(self):
        """The core safety guarantee: reconciling an automated result must
        not modify tracking_entry_price/final_result/current_r/etc -- those
        remain the advisory system's own, separate from
        automated_trade_result."""
        async def go():
            await _clear()
            await srv.db.trade_journal.insert_one(_trade())
            doc = _outlook_doc(final_result="TRACKING", current_r=0.3)
            await srv.db.cloud_market_outlooks.insert_one(dict(doc))
            await mo.reconcile_automated_trade_result(doc)
            persisted = await srv.db.cloud_market_outlooks.find_one({"id": doc["id"]}, {"_id": 0})
            assert persisted["final_result"] == "TRACKING"
            assert persisted["current_r"] == 0.3
            assert persisted["tracking_entry_price"] == 2650.0
        _run(go())

    def test_matched_result_is_idempotent_never_overwritten(self):
        async def go():
            await _clear()
            await srv.db.trade_journal.insert_one(_trade(ticket=1001))
            doc = _outlook_doc()
            await srv.db.cloud_market_outlooks.insert_one(dict(doc))
            first = await mo.reconcile_automated_trade_result(doc)
            assert first["status"] == "matched"
            # A second, different trade now also exists in-window -- re-running
            # reconciliation against the ALREADY-matched doc must be a no-op.
            await srv.db.trade_journal.insert_one(_trade(ticket=9999, profit=-999.0))
            refetched = await srv.db.cloud_market_outlooks.find_one({"id": doc["id"]}, {"_id": 0})
            second = await mo.reconcile_automated_trade_result(refetched)
            assert second is None
            persisted = await srv.db.cloud_market_outlooks.find_one({"id": doc["id"]}, {"_id": 0})
            assert persisted["automated_trade_result"]["ticket"] == 1001  # unchanged
        _run(go())

    def test_uncertain_status_persisted_and_queued_not_guessed(self):
        async def go():
            await _clear()
            await srv.db.trade_journal.insert_one(_trade(ticket=1001))
            await srv.db.trade_journal.insert_one(_trade(ticket=1002))
            doc = _outlook_doc()
            await srv.db.cloud_market_outlooks.insert_one(dict(doc))
            result = await mo.reconcile_automated_trade_result(doc)
            assert result["status"] == "uncertain"
            assert len(result["candidate_tickets"]) == 2
        _run(go())

    def test_no_trade_found_status_persisted(self):
        async def go():
            await _clear()
            doc = _outlook_doc()
            await srv.db.cloud_market_outlooks.insert_one(dict(doc))
            result = await mo.reconcile_automated_trade_result(doc)
            assert result["status"] == "no_trade_found"
        _run(go())


class TestRealTimeTrigger:
    def test_journal_entry_reconciles_matching_outlook_immediately(self):
        async def go():
            await _clear()
            doc = _outlook_doc()
            await srv.db.cloud_market_outlooks.insert_one(dict(doc))
            trade = _trade()
            await srv.db.trade_journal.insert_one(dict(trade))
            result = await mo.reconcile_trade_journal_entry(trade)
            assert result is not None
            assert result["outlook_id"] == doc["id"]
            assert result["result"]["status"] == "matched"
        _run(go())


USER_ID = "user-notif-1"


async def _clear_notifications():
    await srv.db.cloud_notification_prefs.delete_many({})
    await srv.db.cloud_notification_log.delete_many({})


async def _seed_prefs(tier="HOURLY_PLUS_RESULTS", user_id=USER_ID, account=ACCOUNT):
    await srv.db.cloud_notification_prefs.update_one(
        {"account": account, "user_id": user_id},
        {"$set": {"account": account, "user_id": user_id, "tier": tier}},
        upsert=True,
    )


class TestAutomatedTradeNotification:
    def test_matched_result_dispatches_notification_and_sets_flag(self):
        async def go():
            await _clear()
            await _clear_notifications()
            await _seed_prefs()
            await srv.db.trade_journal.insert_one(_trade())
            doc = _outlook_doc()
            await srv.db.cloud_market_outlooks.insert_one(dict(doc))

            await mo.reconcile_automated_trade_result(doc)

            log_entry = await srv.db.cloud_notification_log.find_one(
                {"outlook_id": doc["id"], "notification_type": "AUTOMATED_TRADE_RESULT"})
            assert log_entry is not None
            assert log_entry["delivery_status"] in ("NO_DEVICE", "SENT", "FAILED")

            persisted = await srv.db.cloud_market_outlooks.find_one({"id": doc["id"]}, {"_id": 0})
            assert persisted["notification_flags"]["AUTOMATED_TRADE_RESULT"]
        _run(go())

    def test_below_tier_recipient_not_notified(self):
        async def go():
            await _clear()
            await _clear_notifications()
            await _seed_prefs(tier="HOURLY_ONLY")
            await srv.db.trade_journal.insert_one(_trade())
            doc = _outlook_doc()
            await srv.db.cloud_market_outlooks.insert_one(dict(doc))

            await mo.reconcile_automated_trade_result(doc)

            log_entry = await srv.db.cloud_notification_log.find_one(
                {"outlook_id": doc["id"], "notification_type": "AUTOMATED_TRADE_RESULT"})
            assert log_entry is None
        _run(go())

    def test_notification_never_sent_twice_for_same_outlook(self):
        async def go():
            await _clear()
            await _clear_notifications()
            await _seed_prefs()
            await srv.db.trade_journal.insert_one(_trade(ticket=1001))
            doc = _outlook_doc()
            await srv.db.cloud_market_outlooks.insert_one(dict(doc))

            await mo.reconcile_automated_trade_result(doc)
            first_count = await srv.db.cloud_notification_log.count_documents(
                {"outlook_id": doc["id"], "notification_type": "AUTOMATED_TRADE_RESULT"})
            assert first_count == 1

            # Re-running reconciliation against the already-matched doc is a
            # no-op (tested elsewhere) so dispatch must not be reinvoked either.
            refetched = await srv.db.cloud_market_outlooks.find_one({"id": doc["id"]}, {"_id": 0})
            await mo.reconcile_automated_trade_result(refetched)
            second_count = await srv.db.cloud_notification_log.count_documents(
                {"outlook_id": doc["id"], "notification_type": "AUTOMATED_TRADE_RESULT"})
            assert second_count == 1
        _run(go())

    def test_uncertain_and_no_trade_found_never_notify(self):
        async def go():
            await _clear()
            await _clear_notifications()
            await _seed_prefs()
            doc = _outlook_doc()
            await srv.db.cloud_market_outlooks.insert_one(dict(doc))
            await mo.reconcile_automated_trade_result(doc)  # no_trade_found
            log_entry = await srv.db.cloud_notification_log.find_one(
                {"outlook_id": doc["id"], "notification_type": "AUTOMATED_TRADE_RESULT"})
            assert log_entry is None
        _run(go())


class TestAutomatedTradePayload:
    def test_tp_hit_payload(self):
        doc = _outlook_doc()
        doc["automated_trade_result"] = {
            "status": "matched", "result": "TP_HIT", "direction": "BUY", "symbol": "XAUUSD",
            "realized_profit": 150.0, "realized_r": 2.0, "entry_price": 2650.5, "exit_price": 2660.0,
            "close_reason": "TAKE_PROFIT_1R", "ticket": 1001,
        }
        from notifications import _build_automated_trade_payload
        payload = _build_automated_trade_payload(doc)
        assert "hit take-profit" in payload["title"]
        assert "BUY" in payload["title"] and "XAUUSD" in payload["title"]
        assert "P/L +$150.00" in payload["body"]
        assert "2.00R" in payload["body"]
        assert payload["outlook_id"] == doc["id"]
        assert payload["event"] == "AUTOMATED_TRADE_RESULT"

    def test_sl_hit_payload(self):
        doc = _outlook_doc()
        doc["automated_trade_result"] = {
            "status": "matched", "result": "SL_HIT", "direction": "SELL", "symbol": "XAUUSD",
            "realized_profit": -80.0, "realized_r": -1.0, "entry_price": 2650.5, "exit_price": 2640.0,
            "close_reason": "STOP_LOSS", "ticket": 1002,
        }
        from notifications import _build_automated_trade_payload
        payload = _build_automated_trade_payload(doc)
        assert "hit stop-loss" in payload["title"]
        assert "P/L -$80.00" in payload["body"]

    def test_break_even_payload(self):
        doc = _outlook_doc()
        doc["automated_trade_result"] = {
            "status": "matched", "result": "BREAK_EVEN", "direction": "BUY", "symbol": "XAUUSD",
            "realized_profit": 0.0, "realized_r": 0.0, "entry_price": 2650.5, "exit_price": 2650.5,
            "close_reason": "MANUAL_CLOSE", "ticket": 1003,
        }
        from notifications import _build_automated_trade_payload
        payload = _build_automated_trade_payload(doc)
        assert "closed break-even" in payload["title"]

    def test_open_trade_never_triggers_reconciliation(self):
        async def go():
            await _clear()
            doc = _outlook_doc()
            await srv.db.cloud_market_outlooks.insert_one(dict(doc))
            trade = _trade(closed_at=0)
            result = await mo.reconcile_trade_journal_entry(trade)
            assert result is None
        _run(go())

    def test_no_matching_outlook_returns_none_without_raising(self):
        async def go():
            await _clear()
            trade = _trade()
            result = await mo.reconcile_trade_journal_entry(trade)
            assert result is None
        _run(go())

    def test_already_reconciled_outlook_skipped(self):
        async def go():
            await _clear()
            doc = _outlook_doc(automated_trade_result={"status": "matched", "ticket": 5555})
            await srv.db.cloud_market_outlooks.insert_one(dict(doc))
            trade = _trade(ticket=1001)
            result = await mo.reconcile_trade_journal_entry(trade)
            assert result is None
        _run(go())

    def test_never_raises_on_malformed_entry(self):
        async def go():
            await _clear()
            # missing every expected field
            result = await mo.reconcile_trade_journal_entry({})
            assert result is None
        _run(go())
