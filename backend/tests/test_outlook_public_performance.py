"""Tests for the public marketing-site Market Outlook performance feed
(GET /outlook/public-performance, backed by
market_outlook_routes.build_public_outlook_performance).

Covers: only genuinely completed (WIN/LOSS) advisory signals are included
(never watching/blocked/active/unavailable/excluded), the last-10 newest-
first ordering, stats computed from exactly the displayed set, the
authoritative pip/Gold-move/R conversion, and that automated_trade_result
(the real account outcome) is never read here -- this feed is the advisory
signal's own resolution only.
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

TEST_DB = f"outlook_public_perf_pytest_{uuid.uuid4().hex[:10]}"
os.environ["MONGO_URL"] = "mongodb://localhost:27017"
os.environ["DB_NAME"] = TEST_DB
os.environ.setdefault("JWT_SECRET", "test-secret-outlook-public-perf")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")

import server as srv  # noqa: E402
import market_outlook as mo  # noqa: E402
import market_outlook_routes as routes  # noqa: E402

_LOOP = asyncio.new_event_loop()


def _run(coro):
    return _LOOP.run_until_complete(coro)


_REF = datetime.now(timezone.utc)


def _completed_outlook(**overrides):
    doc = {
        "id": str(uuid.uuid4()),
        "account": "555000111",
        "symbol": "XAUUSD",
        "primary_direction": "SELL",
        "confidence_pct": 70,
        "published_at": _REF.isoformat(),
        "classification_at": _REF.isoformat(),
        "tracking_entry_price": 4061.00,
        "original_sl": 4066.00,
        "tp1_price": 4056.00,
        "analytics_outcome": mo.ANALYTICS_WIN,
        "analytics_r": 0.5,
        "risk_distance": 5.0,
        "setup_type": "M10_ORIGINATED",
        "excluded_from_stats": False,
        "excluded_from_signal_analytics": False,
    }
    doc.update(overrides)
    return doc


async def _clear():
    await srv.db.cloud_market_outlooks.delete_many({})


class TestOnlyCompletedSignalsIncluded:
    def test_watching_signal_excluded(self):
        async def go():
            await _clear()
            await srv.db.cloud_market_outlooks.insert_one(_completed_outlook(analytics_outcome=None, analytics_r=None))
            result = await routes.build_public_outlook_performance(srv.db)
            assert result["signals"] == []
        _run(go())

    def test_blocked_or_non_directional_excluded(self):
        async def go():
            await _clear()
            await srv.db.cloud_market_outlooks.insert_one(_completed_outlook(primary_direction="NEUTRAL"))
            result = await routes.build_public_outlook_performance(srv.db)
            assert result["signals"] == []
        _run(go())

    def test_unavailable_historical_excluded(self):
        async def go():
            await _clear()
            await srv.db.cloud_market_outlooks.insert_one(_completed_outlook(analytics_outcome=mo.ANALYTICS_UNAVAILABLE))
            result = await routes.build_public_outlook_performance(srv.db)
            assert result["signals"] == []
        _run(go())

    def test_excluded_from_stats_flag_respected(self):
        async def go():
            await _clear()
            await srv.db.cloud_market_outlooks.insert_one(_completed_outlook(excluded_from_stats=True))
            result = await routes.build_public_outlook_performance(srv.db)
            assert result["signals"] == []
        _run(go())

    def test_win_and_loss_signals_included(self):
        async def go():
            await _clear()
            await srv.db.cloud_market_outlooks.insert_one(_completed_outlook(id="win-1", analytics_outcome=mo.ANALYTICS_WIN))
            await srv.db.cloud_market_outlooks.insert_one(_completed_outlook(id="loss-1", analytics_outcome=mo.ANALYTICS_LOSS, analytics_r=-1.0))
            result = await routes.build_public_outlook_performance(srv.db)
            assert len(result["signals"]) == 2
            results = {s["id"]: s["result"] for s in result["signals"]}
            assert results == {"win-1": "WIN", "loss-1": "LOSS"}
        _run(go())


class TestOrderingAndLimit:
    def test_newest_first(self):
        async def go():
            await _clear()
            for i in range(3):
                await srv.db.cloud_market_outlooks.insert_one(_completed_outlook(
                    id=f"sig-{i}", classification_at=(_REF + timedelta(hours=i)).isoformat(),
                ))
            result = await routes.build_public_outlook_performance(srv.db)
            assert [s["id"] for s in result["signals"]] == ["sig-2", "sig-1", "sig-0"]
        _run(go())

    def test_limited_to_ten(self):
        async def go():
            await _clear()
            for i in range(15):
                await srv.db.cloud_market_outlooks.insert_one(_completed_outlook(
                    id=f"sig-{i}", classification_at=(_REF + timedelta(hours=i)).isoformat(),
                ))
            result = await routes.build_public_outlook_performance(srv.db)
            assert len(result["signals"]) == 10
            # newest 10 -> sig-14 down to sig-5
            assert result["signals"][0]["id"] == "sig-14"
            assert result["signals"][-1]["id"] == "sig-5"
        _run(go())

    def test_fewer_than_ten_never_fabricated(self):
        async def go():
            await _clear()
            await srv.db.cloud_market_outlooks.insert_one(_completed_outlook())
            result = await routes.build_public_outlook_performance(srv.db)
            assert len(result["signals"]) == 1
            assert result["stats"]["count"] == 1
        _run(go())

    def test_stats_reflect_all_completed_signals_not_just_the_displayed_window(self):
        # Bug fix (owner audit, 2026-08-04): stats used to be computed from
        # only the displayed (most recent 10) signals -- once more than 10
        # completed signals existed, "win rate"/"total R" silently excluded
        # every older one while still being presented as overall
        # performance. 15 wins + 5 losses seeded; only 10 signal cards are
        # returned for display, but stats must count all 20.
        async def go():
            await _clear()
            for i in range(15):
                await srv.db.cloud_market_outlooks.insert_one(_completed_outlook(
                    id=f"win-{i}", classification_at=(_REF + timedelta(hours=i)).isoformat(),
                    analytics_outcome=mo.ANALYTICS_WIN, analytics_r=1.0, risk_distance=10.0,
                ))
            for i in range(5):
                await srv.db.cloud_market_outlooks.insert_one(_completed_outlook(
                    id=f"loss-{i}", classification_at=(_REF + timedelta(hours=15 + i)).isoformat(),
                    analytics_outcome=mo.ANALYTICS_LOSS, analytics_r=-1.0, risk_distance=10.0,
                ))
            result = await routes.build_public_outlook_performance(srv.db)
            assert len(result["signals"]) == 10  # display window unchanged
            stats = result["stats"]
            assert stats["count"] == 20
            assert stats["wins"] == 15
            assert stats["losses"] == 5
            assert stats["win_rate"] == 0.75
            assert stats["total_r"] == 10.0  # 15*(+1) + 5*(-1)
        _run(go())

    def test_limit_query_param_expands_display_window(self):
        async def go():
            await _clear()
            for i in range(15):
                await srv.db.cloud_market_outlooks.insert_one(_completed_outlook(
                    id=f"sig-{i}", classification_at=(_REF + timedelta(hours=i)).isoformat(),
                ))
            result = await routes.build_public_outlook_performance(srv.db, limit=15)
            assert len(result["signals"]) == 15
            # stats are identical regardless of the display-window limit
            assert result["stats"]["count"] == 15
        _run(go())

    def test_no_signals_returns_empty_not_error(self):
        async def go():
            await _clear()
            result = await routes.build_public_outlook_performance(srv.db)
            assert result["signals"] == []
            assert result["stats"]["wins"] == 0
            assert result["stats"]["losses"] == 0
            assert result["stats"]["win_rate"] is None
        _run(go())


class TestConversionAndStats:
    def test_sell_win_matches_spec_example(self):
        async def go():
            await _clear()
            await srv.db.cloud_market_outlooks.insert_one(_completed_outlook(
                primary_direction="SELL", tracking_entry_price=4061.00, tp1_price=4056.00,
                analytics_outcome=mo.ANALYTICS_WIN, analytics_r=0.5, risk_distance=10.0,
            ))
            result = await routes.build_public_outlook_performance(srv.db)
            sig = result["signals"][0]
            assert sig["result_r"] == 0.5
            assert sig["result_gold_moves"] == 5.0
            assert sig["result_pips"] == 50.0
        _run(go())

    def test_stats_computed_from_exactly_displayed_signals(self):
        async def go():
            await _clear()
            await srv.db.cloud_market_outlooks.insert_one(_completed_outlook(
                id="w1", analytics_outcome=mo.ANALYTICS_WIN, analytics_r=1.0, risk_distance=10.0))
            await srv.db.cloud_market_outlooks.insert_one(_completed_outlook(
                id="l1", analytics_outcome=mo.ANALYTICS_LOSS, analytics_r=-1.0, risk_distance=10.0))
            result = await routes.build_public_outlook_performance(srv.db)
            stats = result["stats"]
            assert stats["wins"] == 1
            assert stats["losses"] == 1
            assert stats["win_rate"] == 0.5
            assert stats["total_r"] == 0.0
            assert stats["total_pips"] == 0.0
        _run(go())

    def test_avg_win_avg_loss_best_worst_computed_from_real_data(self):
        async def go():
            await _clear()
            await srv.db.cloud_market_outlooks.insert_one(_completed_outlook(
                id="w1", classification_at=(_REF + timedelta(hours=0)).isoformat(),
                analytics_outcome=mo.ANALYTICS_WIN, analytics_r=0.5, risk_distance=10.0))
            await srv.db.cloud_market_outlooks.insert_one(_completed_outlook(
                id="w2", classification_at=(_REF + timedelta(hours=1)).isoformat(),
                analytics_outcome=mo.ANALYTICS_WIN, analytics_r=1.5, risk_distance=10.0))
            await srv.db.cloud_market_outlooks.insert_one(_completed_outlook(
                id="l1", classification_at=(_REF + timedelta(hours=2)).isoformat(),
                analytics_outcome=mo.ANALYTICS_LOSS, analytics_r=-1.0, risk_distance=10.0))
            result = await routes.build_public_outlook_performance(srv.db)
            stats = result["stats"]
            assert stats["average_win_r"] == 1.0  # (0.5 + 1.5) / 2
            assert stats["average_loss_r"] == -1.0
            assert stats["best_trade_r"] == 1.5
            assert stats["worst_trade_r"] == -1.0
        _run(go())

    def test_cumulative_r_curve_is_chronological_and_matches_total_r(self):
        async def go():
            await _clear()
            await srv.db.cloud_market_outlooks.insert_one(_completed_outlook(
                id="first", classification_at=(_REF + timedelta(hours=0)).isoformat(),
                analytics_outcome=mo.ANALYTICS_WIN, analytics_r=1.0, risk_distance=10.0))
            await srv.db.cloud_market_outlooks.insert_one(_completed_outlook(
                id="second", classification_at=(_REF + timedelta(hours=1)).isoformat(),
                analytics_outcome=mo.ANALYTICS_LOSS, analytics_r=-0.4, risk_distance=10.0))
            await srv.db.cloud_market_outlooks.insert_one(_completed_outlook(
                id="third", classification_at=(_REF + timedelta(hours=2)).isoformat(),
                analytics_outcome=mo.ANALYTICS_WIN, analytics_r=0.5, risk_distance=10.0))
            result = await routes.build_public_outlook_performance(srv.db)
            curve = result["cumulative_r_curve"]
            assert [c["cumulative_r"] for c in curve] == [1.0, 0.6, 1.1]
            assert curve[-1]["cumulative_r"] == result["stats"]["total_r"]
        _run(go())

    def test_never_reads_automated_trade_result(self):
        """The advisory public feed must never surface the real account's
        trade outcome -- that's a separate, owner-directive-distinct
        dataset shown only in the Command Center's own real-trade section."""
        async def go():
            await _clear()
            await srv.db.cloud_market_outlooks.insert_one(_completed_outlook(
                automated_trade_result={"status": "matched", "result": "SL_HIT", "realized_r": -3.0},
                analytics_outcome=mo.ANALYTICS_WIN, analytics_r=0.5, risk_distance=10.0,
            ))
            result = await routes.build_public_outlook_performance(srv.db)
            sig = result["signals"][0]
            assert sig["result"] == "WIN"
            assert sig["result_r"] == 0.5
            assert "automated_trade_result" not in sig
        _run(go())
