"""Tests for GET /performance/daily-results (owner spec, 2026-08-04) --
real closed-trade results (the actual bot, not the advisory Outlook
feature) grouped by day in pips/Gold-moves/R.

Same eligibility/dedup rules as every other real-performance number
(performance_engine.is_eligible_trade/dedupe_by_ticket), and the same
pip/Gold-move conversion market_outlook.py uses everywhere else, computed
from each trade's own real entry/exit price.
"""
import os
import sys
import time
import uuid
import asyncio

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

TEST_DB = f"daily_results_pytest_{uuid.uuid4().hex[:10]}"
os.environ["MONGO_URL"] = "mongodb://localhost:27017"
os.environ["DB_NAME"] = TEST_DB
os.environ.setdefault("JWT_SECRET", "test-secret-daily-results")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")

import server as srv  # noqa: E402

_LOOP = asyncio.new_event_loop()


def _run(coro):
    return _LOOP.run_until_complete(coro)


ADMIN = {"email": "admin@test.com", "role": "admin"}


async def _clear():
    await srv.db.trade_journal.delete_many({})
    await srv.db.performance_periods.delete_many({})
    await srv.db.users.delete_many({})


async def _seed_admin():
    await srv.db.users.insert_one({
        "email": "admin@test.com", "password_hash": srv.hash_password("AdminPass123"),
        "name": "Admin", "role": "admin", "created_at": "2026-07-17T00:00:00Z",
    })
    return ADMIN


async def _start_period():
    req = srv.StartPerformancePeriodRequest(
        name="Daily Results Test Period", reason="testing", current_password="AdminPass123", confirm=True,
    )
    result = await srv.admin_start_performance_period(req, admin=ADMIN)
    period = await srv.db.performance_periods.find_one({"id": result["period"]["id"]}, {"_id": 0})
    return period["epoch_started_at_unix"]


def _real_trade(ticket, opened_at, closed_at, direction, entry_price, exit_price, final_r,
                 profit=0.0, commission=0.0, swap=0.0, account_login="1001"):
    return {
        "ticket": ticket, "opened_at": opened_at, "closed_at": closed_at,
        "profit": profit, "commission": commission, "swap": swap, "balance": 10000.0,
        "has_rich_ledger_data": True, "direction": direction,
        "entry_price": entry_price, "price": exit_price, "final_r": final_r,
        "original_risk_usd": 50.0, "ea_version": "v6.25.31", "account_login": account_login,
        "symbol": "XAUUSD",
    }


def test_real_buy_win_converts_to_correct_pips_and_gold_moves():
    async def go():
        await _clear()
        await _seed_admin()
        epoch = await _start_period()
        # BUY: entry 4000.00 -> exit 4010.00 = +10.00 price move = +10.0 Gold moves = +100 pips
        # (1 Gold move = 1.0 XAUUSD price point; XAUCLOUD_PIPS_PER_GOLD_MOVE = 10)
        await srv.db.trade_journal.insert_one(_real_trade(
            1, epoch + 10, epoch + 20, "BUY", 4000.00, 4010.00, final_r=1.0, profit=50.0))
        result = await srv.get_performance_daily_results(days=30)
        assert result["status"] == "ok"
        assert result["totals"]["trades"] == 1
        assert result["totals"]["wins"] == 1
        assert result["totals"]["net_gold_moves"] == 10.0
        assert result["totals"]["net_pips"] == 100.0
        assert result["totals"]["net_r"] == 1.0
        await _clear()
    _run(go())


def test_real_sell_loss_converts_with_correct_sign():
    async def go():
        await _clear()
        await _seed_admin()
        epoch = await _start_period()
        # SELL: entry 4000.00 -> exit 4005.00 (price rose against a SELL) = -5.00 price move
        await srv.db.trade_journal.insert_one(_real_trade(
            2, epoch + 10, epoch + 20, "SELL", 4000.00, 4005.00, final_r=-0.5, profit=-25.0))
        result = await srv.get_performance_daily_results(days=30)
        assert result["totals"]["losses"] == 1
        assert result["totals"]["net_gold_moves"] == -5.0
        assert result["totals"]["net_pips"] == -50.0
        assert result["totals"]["net_r"] == -0.5
        await _clear()
    _run(go())


def test_multiple_trades_same_day_aggregate_correctly():
    async def go():
        await _clear()
        await _seed_admin()
        epoch = await _start_period()
        await srv.db.trade_journal.insert_one(_real_trade(
            10, epoch + 10, epoch + 20, "BUY", 4000.00, 4010.00, final_r=1.0, profit=50.0))
        await srv.db.trade_journal.insert_one(_real_trade(
            11, epoch + 30, epoch + 40, "BUY", 4010.00, 4005.00, final_r=-0.5, profit=-25.0))
        result = await srv.get_performance_daily_results(days=30)
        assert len(result["days"]) == 1
        day = result["days"][0]
        assert day["trades"] == 2
        assert day["wins"] == 1
        assert day["losses"] == 1
        assert day["net_gold_moves"] == 5.0  # +10.0 (trade 10) + -5.0 (trade 11)
        await _clear()
    _run(go())


def test_ineligible_and_duplicate_trades_excluded():
    async def go():
        await _clear()
        await _seed_admin()
        epoch = await _start_period()
        # ticket 0 -- pre-v6.25.3, unreliable, must be excluded
        bad = _real_trade(0, epoch + 10, epoch + 20, "BUY", 4000.00, 4010.00, final_r=1.0, profit=50.0)
        await srv.db.trade_journal.insert_one(bad)
        # duplicate ticket -- only first-seen counts
        dup1 = _real_trade(20, epoch + 10, epoch + 20, "BUY", 4000.00, 4010.00, final_r=1.0, profit=50.0)
        dup2 = _real_trade(20, epoch + 10, epoch + 30, "BUY", 4000.00, 4010.00, final_r=1.0, profit=50.0)
        await srv.db.trade_journal.insert_many([dup1, dup2])
        result = await srv.get_performance_daily_results(days=30)
        assert result["totals"]["trades"] == 1  # only the deduped real one
        await _clear()
    _run(go())


def test_trades_outside_the_days_window_excluded():
    async def go():
        await _clear()
        await _seed_admin()
        epoch = await _start_period()
        # Simulate a long-running period (epoch pushed back 60 real days) so
        # an old-but-in-period trade exists to prove the `days` cutoff (not
        # just the period's own epoch filter) is doing real work.
        period = await srv.db.performance_periods.find_one({}, {"_id": 0})
        old_epoch = epoch - 60 * 86400
        await srv.db.performance_periods.update_one(
            {"id": period["id"]}, {"$set": {"epoch_started_at_unix": old_epoch}})
        old = _real_trade(30, old_epoch + 10, old_epoch + 20, "BUY", 4000.00, 4010.00, final_r=1.0, profit=50.0)
        recent = _real_trade(31, epoch + 10, epoch + 20, "BUY", 4000.00, 4010.00, final_r=1.0, profit=50.0)
        await srv.db.trade_journal.insert_many([old, recent])
        result = await srv.get_performance_daily_results(days=30)
        assert result["totals"]["trades"] == 1
        await _clear()
    _run(go())


def test_no_active_period_returns_unavailable_not_error():
    async def go():
        await _clear()
        result = await srv.get_performance_daily_results(days=30)
        assert result["status"] == "unavailable"
        assert result["days"] == []
        await _clear()
    _run(go())


def test_days_param_is_clamped_to_a_sane_range():
    async def go():
        await _clear()
        await _seed_admin()
        await _start_period()
        result = await srv.get_performance_daily_results(days=99999)
        assert result["days_requested"] == 90
        result2 = await srv.get_performance_daily_results(days=0)
        assert result2["days_requested"] == 1
        await _clear()
    _run(go())


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
