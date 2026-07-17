"""Real, executable tests for the v6.25.3 Phase 7A (P0) Command Center
analytics rewrite (final pre-launch hardening).

Root problem fixed: the Command Center's Analytics page equity curve was
`[base-d*1.4, base-d, base-d*0.55, base-d*0.2, equity]` in
frontend/src/components/cloud/CloudDashboard.jsx -- a synthetic
interpolation from the CURRENT balance/equity/daily_pnl, not real trade
history. This adds a real backend source of truth: GET
/api/cloud/performance/analytics, computing win rate, profit factor,
average R, MAE/MFE, drawdown, and a real cumulative equity curve from
actual closed-trade records the EA reports at close.

Also proves the /api/journal/log schema change is additive, not breaking:
a pre-v6.25.3 EA install posting only the old thin fields (no ticket/
risk/R/etc.) is still accepted and stored, but is correctly excluded from
analytics (has_rich_ledger_data=False) rather than forcing fabricated
risk/R numbers for data that was never sent.

Uses a live local MongoDB in an isolated database (skips cleanly if none
reachable).
"""
import sys
import os
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


pytestmark = pytest.mark.skipif(not _mongo_available(), reason="no local MongoDB reachable for this live analytics test")

TEST_DB = f"analytics_pytest_{uuid.uuid4().hex[:10]}"
os.environ["MONGO_URL"] = "mongodb://localhost:27017"
os.environ["DB_NAME"] = TEST_DB
os.environ.setdefault("JWT_SECRET", "test-secret-analytics")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")

import server as srv  # noqa: E402
from fastapi import HTTPException  # noqa: E402

_LOOP = asyncio.new_event_loop()


def _run(coro):
    return _LOOP.run_until_complete(coro)


async def _clear():
    await srv.db.trade_journal.delete_many({})
    await srv.db.cloud_users.delete_many({})
    await srv.db.pin_licenses.delete_many({})


def setup_function(_fn):
    _run(_clear())


async def _make_user_with_license(pin="ASE-ANALYTICS1"):
    uid = str(uuid.uuid4())
    email = f"{uid}@test.com"
    await srv.db.cloud_users.insert_one({
        "id": uid, "email": email, "password_hash": "x",
        "license_key": pin, "created_at": "2026-07-17T00:00:00Z",
    })
    await srv.db.pin_licenses.insert_one({
        "pin": pin, "is_active": True, "mt5_account": "12345",
        "buyer_email": email,
    })
    return {"id": uid, "email": email, "license_key": pin}


def _log_rich_trade(pin, result, profit, ticket, closed_at, risk_usd=100.0,
                     final_r=None, mae_r=-0.3, mfe_r=1.2, setup="A_PLUS",
                     family="NORMAL", account_login="1001", hour=10):
    entry = srv.TradeJournalEntry(
        pin=pin, symbol="XAUUSD", direction="BUY", result=result,
        price=2000.0, profit=profit, lots=0.1, hour=hour, day_of_week=2,
        total_trades=1, wins=1 if result == "WIN" else 0, losses=1 if result == "LOSS" else 0,
        balance=10000.0, signature="sig", setup=setup, regime="TREND",
        ticket=ticket, entry_price=1990.0, opened_at=closed_at - 3600, closed_at=closed_at,
        commission=-2.0, swap=-0.5, original_risk_usd=risk_usd,
        final_r=final_r if final_r is not None else round(profit / risk_usd, 3),
        mae_r=mae_r, mfe_r=mfe_r, campaign_id="7", ea_version="v6.25.3",
        account_login=account_login, exit_reason="R_EXIT_MANAGER | test", exit_owner="EA", family=family,
    )
    return _run(srv.log_trade_journal(entry))


def _log_thin_trade(pin, result, profit):
    """Simulates a pre-v6.25.3 EA install -- only the original fields."""
    entry = srv.TradeJournalEntry(
        pin=pin, symbol="XAUUSD", direction="BUY", result=result,
        price=2000.0, profit=profit, lots=0.1, hour=10, day_of_week=2,
        total_trades=1, wins=1 if result == "WIN" else 0, losses=1 if result == "LOSS" else 0,
        balance=10000.0, signature="sig", setup="LEGACY", regime="TREND",
    )
    return _run(srv.log_trade_journal(entry))


def test_thin_legacy_payload_still_accepted_and_stored():
    result = _log_thin_trade("ASE-LEGACY1", "WIN", 50.0)
    assert result["status"] == "ok"

    async def find():
        return await srv.db.trade_journal.find_one({"pin": "ASE-LEGACY1"})
    doc = _run(find())
    assert doc is not None
    assert doc["has_rich_ledger_data"] is False
    assert doc["ticket"] == 0


def test_rich_payload_marked_has_rich_ledger_data():
    _log_rich_trade("ASE-RICH1", "WIN", 120.0, ticket=555001, closed_at=1_800_000_000)

    async def find():
        return await srv.db.trade_journal.find_one({"pin": "ASE-RICH1"})
    doc = _run(find())
    assert doc is not None
    assert doc["has_rich_ledger_data"] is True
    assert doc["ticket"] == 555001
    assert doc["exit_owner"] == "EA"
    assert doc["family"] == "NORMAL"


def test_analytics_reports_insufficient_data_below_threshold():
    user = _run(_make_user_with_license("ASE-SPARSE1"))
    for i in range(3):  # below MINIMUM_VERIFIED_TRADES_FOR_ANALYTICS (5)
        _log_rich_trade("ASE-SPARSE1", "WIN", 50.0, ticket=600000 + i, closed_at=1_800_000_000 + i)
    result = _run(srv.cloud_performance_analytics(user))
    assert result["sufficient_data"] is False
    assert result["verified_trade_count"] == 3
    assert result["message"] == "NOT ENOUGH VERIFIED DATA"


def test_analytics_excludes_thin_legacy_trades_from_count():
    user = _run(_make_user_with_license("ASE-MIXED1"))
    for i in range(5):
        _log_rich_trade("ASE-MIXED1", "WIN", 50.0, ticket=610000 + i, closed_at=1_800_000_000 + i)
    _log_thin_trade("ASE-MIXED1", "WIN", 999.0)  # must NOT count toward verified analytics
    result = _run(srv.cloud_performance_analytics(user))
    assert result["sufficient_data"] is True
    assert result["verified_trade_count"] == 5  # not 6


def test_analytics_computes_real_win_rate_and_profit_factor():
    user = _run(_make_user_with_license("ASE-STATS1"))
    # 3 wins of $100, 2 losses of $50 -- verifiable by hand.
    for i in range(3):
        _log_rich_trade("ASE-STATS1", "WIN", 100.0, ticket=620000 + i, closed_at=1_800_000_000 + i, risk_usd=50.0)
    for i in range(2):
        _log_rich_trade("ASE-STATS1", "LOSS", -50.0, ticket=630000 + i, closed_at=1_800_000_100 + i, risk_usd=50.0)
    result = _run(srv.cloud_performance_analytics(user))
    assert result["sufficient_data"] is True
    assert result["verified_trade_count"] == 5
    assert result["win_rate"] == 60.0
    # gross_profit=300, gross_loss=100 -> profit_factor=3.0
    assert result["profit_factor"] == 3.0
    assert result["realized_pnl"] == 200.0  # 300 - 100


def test_analytics_equity_curve_is_real_cumulative_not_interpolated():
    user = _run(_make_user_with_license("ASE-CURVE1"))
    profits = [100.0, -30.0, 60.0, -10.0, 80.0]
    for i, p in enumerate(profits):
        _log_rich_trade("ASE-CURVE1", "WIN" if p > 0 else "LOSS", p,
                              ticket=640000 + i, closed_at=1_800_000_000 + i * 3600, risk_usd=50.0)
    result = _run(srv.cloud_performance_analytics(user))
    curve = result["equity_curve"]
    assert len(curve) == 5
    running = 0.0
    for point, p in zip(curve, profits):
        running += p
        assert point["cumulative_profit"] == round(running, 2)
    # Ordered by closed_at ascending, not insertion order or something else.
    assert [c["ticket"] for c in curve] == [640000, 640001, 640002, 640003, 640004]


def test_analytics_avg_r_only_uses_trades_with_positive_risk():
    user = _run(_make_user_with_license("ASE-RVAL1"))
    for i in range(5):
        _log_rich_trade("ASE-RVAL1", "WIN", 100.0, ticket=650000 + i,
                              closed_at=1_800_000_000 + i, risk_usd=50.0, final_r=2.0)
    result = _run(srv.cloud_performance_analytics(user))
    assert result["avg_r"] == 2.0


def test_analytics_setup_and_family_breakdown():
    user = _run(_make_user_with_license("ASE-BREAK1"))
    for i in range(3):
        _log_rich_trade("ASE-BREAK1", "WIN", 50.0, ticket=660000 + i,
                              closed_at=1_800_000_000 + i, setup="A_PLUS", family="NORMAL")
    for i in range(2):
        _log_rich_trade("ASE-BREAK1", "LOSS", -20.0, ticket=670000 + i,
                              closed_at=1_800_000_100 + i, setup="COUNTER", family="COUNTER_EXCURSION")
    result = _run(srv.cloud_performance_analytics(user))
    assert result["setup_breakdown"]["A_PLUS"]["trades"] == 3
    assert result["setup_breakdown"]["COUNTER"]["trades"] == 2
    assert result["family_breakdown"]["NORMAL"]["trades"] == 3
    assert result["family_breakdown"]["COUNTER_EXCURSION"]["trades"] == 2


def test_analytics_requires_active_license():
    uid = str(uuid.uuid4())
    user = {"id": uid, "email": f"{uid}@test.com", "license_key": ""}
    with pytest.raises(HTTPException) as exc:
        _run(srv.cloud_performance_analytics(user))
    assert exc.value.status_code == 404


def test_analytics_is_scoped_to_the_caller_own_license():
    user_a = _run(_make_user_with_license("ASE-SCOPEA"))
    user_b = _run(_make_user_with_license("ASE-SCOPEB"))
    for i in range(5):
        _log_rich_trade("ASE-SCOPEA", "WIN", 100.0, ticket=680000 + i, closed_at=1_800_000_000 + i)
    result_b = _run(srv.cloud_performance_analytics(user_b))
    # user B has zero trades under their own pin -- must not see user A's data.
    assert result_b["sufficient_data"] is False
    assert result_b["verified_trade_count"] == 0


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
