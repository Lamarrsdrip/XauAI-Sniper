"""Database-backed proof for persisted Outlook monitoring and repair.

These tests use an isolated local MongoDB database when one is available.
They verify the state survives a fresh monitor invocation and that the
legacy-history migration reconstructs only records supported by broker
Bid/Ask history.
"""

import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import uuid
from unittest.mock import AsyncMock, patch

import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))


def _mongo_available():
    try:
        from pymongo import MongoClient
        MongoClient("mongodb://localhost:27017", serverSelectionTimeoutMS=800).admin.command("ping")
        return True
    except Exception:
        return False


pytestmark = pytest.mark.skipif(not _mongo_available(), reason="no local MongoDB reachable")

import market_outlook as mo  # noqa: E402


class Harness:
    def __init__(self):
        from motor.motor_asyncio import AsyncIOMotorClient
        self.client = AsyncIOMotorClient("mongodb://localhost:27017")
        self.db = self.client[f"signal_lifecycle_pytest_{uuid.uuid4().hex[:10]}"]

    async def drop(self):
        await self.client.drop_database(self.db.name)


def _run(coro):
    return asyncio.run(coro)


def _active_doc(signal_id, account, published):
    return {
        "id": signal_id, "account": account, "primary_direction": "BUY",
        "published_at": published.isoformat(), "tracking_entry_price": 100.1,
        "published_bid": 100.0, "published_ask": 100.1, "original_sl": 99.1,
        "suggested_sl": 99.1, "risk_distance": 1.0,
        "evaluation_deadline": (published + timedelta(minutes=60)).isoformat(),
        "expiry_at": (published + timedelta(hours=4)).isoformat(),
        "tp1_price": 101.1, "tp2_price": 102.1, "tp3_price": 103.1,
        "tp1_r": 1.0, "signal_state": mo.SIGNAL_TRACKING,
        "analytics_outcome": None, "current_r": 0.0, "mfe_r": 0.0, "mae_r": 0.0,
        "highest_tracked_price": 100.1, "lowest_tracked_price": 100.1,
        "milestones_hit": [], "notification_flags": {"TRACKING_STARTED": "sent"},
        "latest_path_event": "TRACKING_STARTED", "monitoring_closed": False,
        "signal_tracking_version": 2,
    }


def test_restart_monitor_reads_and_updates_persisted_mfe_mae_and_outcome():
    h = Harness()

    async def go():
        published = datetime.now(timezone.utc) - timedelta(minutes=20)
        doc = _active_doc("persisted-restart", "PERSIST-1", published)
        doc.update({"mfe_r": 0.31, "mae_r": -0.22, "mfe": 0.31, "mae": -0.22})
        await h.db.cloud_market_outlooks.insert_one(doc)
        with patch.object(mo, "_db", return_value=h.db), \
             patch.object(mo, "_dispatch_signal_event", new=AsyncMock()):
            updated = await mo.track_outlook_lifecycle_tick(
                account="PERSIST-1", bid=100.6, ask=100.7,
                quote_at=(published + timedelta(minutes=17)).isoformat(),
                now=published + timedelta(minutes=17),
            )
        saved = await h.db.cloud_market_outlooks.find_one({"id": "persisted-restart"}, {"_id": 0})
        outcome = await h.db.cloud_market_outlook_outcomes.find_one({"outlook_id": "persisted-restart"}, {"_id": 0})
        assert updated == 1
        assert saved["analytics_outcome"] == mo.ANALYTICS_WIN
        assert saved["signal_state"] == mo.SIGNAL_WIN_HALF_R
        assert saved["mfe_r"] == 0.5
        assert saved["mae_r"] == -0.22
        assert outcome["analytics_outcome"] == mo.ANALYTICS_WIN
        await h.drop()

    _run(go())


def test_restart_replays_intermediate_persisted_quote_and_does_not_miss_tp_reversal():
    h = Harness()

    async def go():
        published = datetime.now(timezone.utc) - timedelta(minutes=20)
        doc = _active_doc("persisted-journey", "PERSIST-2", published)
        doc["published_quote_at"] = published.isoformat()
        doc["last_monitored_at"] = published.isoformat()
        await h.db.cloud_market_outlooks.insert_one(doc)
        await h.db.cloud_bot_activity.insert_many([
            _activity("PERSIST-2", published + timedelta(minutes=5), 101.1, 101.2),
            _activity("PERSIST-2", published + timedelta(minutes=6), 100.0, 100.1),
        ])
        dispatcher = AsyncMock()
        with patch.object(mo, "_db", return_value=h.db), \
             patch.object(mo, "_dispatch_signal_event", new=dispatcher):
            await mo.track_outlook_lifecycle_tick(now=published + timedelta(minutes=10))
        saved = await h.db.cloud_market_outlooks.find_one({"id": doc["id"]}, {"_id": 0})
        assert saved["analytics_outcome"] == mo.ANALYTICS_WIN
        assert saved["signal_state"] == mo.SIGNAL_WIN_TP1
        assert saved["tp1_hit_at"] == (published + timedelta(minutes=5)).isoformat()
        assert saved["mfe_r"] == 1.0
        assert saved["current_r"] == -0.1
        assert {call.args[1] for call in dispatcher.await_args_list} >= {"HALF_R_REACHED", "TP1_HIT"}
        await h.drop()

    _run(go())


def test_concurrent_price_events_cannot_regress_last_persisted_checkpoint():
    h = Harness()

    async def go():
        published = datetime.now(timezone.utc) - timedelta(minutes=20)
        doc = _active_doc("persisted-cas", "PERSIST-3", published)
        await h.db.cloud_market_outlooks.insert_one(doc)
        dispatcher = AsyncMock()
        with patch.object(mo, "_db", return_value=h.db), \
             patch.object(mo, "_dispatch_signal_event", new=dispatcher):
            await asyncio.gather(
                mo.track_outlook_lifecycle_tick(
                    account="PERSIST-3", bid=100.3, ask=100.4,
                    quote_at=(published + timedelta(minutes=5)).isoformat(),
                    now=published + timedelta(minutes=5),
                ),
                mo.track_outlook_lifecycle_tick(
                    account="PERSIST-3", bid=100.6, ask=100.7,
                    quote_at=(published + timedelta(minutes=6)).isoformat(),
                    now=published + timedelta(minutes=6),
                ),
            )
        saved = await h.db.cloud_market_outlooks.find_one({"id": doc["id"]}, {"_id": 0})
        assert saved["last_monitored_at"] == (published + timedelta(minutes=6)).isoformat()
        assert saved["current_r"] == 0.5
        assert saved["mfe_r"] == 0.5
        assert saved["analytics_outcome"] == mo.ANALYTICS_WIN
        await h.drop()

    _run(go())


def _legacy_doc(index, account, published, direction="BUY"):
    return {
        "id": f"legacy-{index}", "account": account, "primary_direction": direction,
        "generated_at": published.isoformat(), "published_at": published.isoformat(),
        "suggested_sl": 99.1 if direction == "BUY" else 101.0,
        "tp1_price": 101.1 if direction == "BUY" else 99.0,
        "tp2_price": 102.1 if direction == "BUY" else 98.0,
        "tp3_price": 103.1 if direction == "BUY" else 97.0,
        "tp1_r": 1.0, "final_result": "GRAY_EXPIRED_NO_ENTRY",
        "status": "MISSED_WITHOUT_ENTRY", "signal_tracking_version": 1,
    }


def _activity(account, at, bid, ask):
    return {
        "account": account, "ts": at.isoformat(),
        "details": {"market_thesis": {"live_bid": bid, "live_ask": ask}},
    }


def test_eight_legacy_records_reconstruct_four_and_exclude_four_without_data():
    h = Harness()

    async def go():
        published = datetime.now(timezone.utc) - timedelta(hours=3)
        legacy = [_legacy_doc(i, f"BACKFILL-{i}", published, "SELL" if i == 1 else "BUY") for i in range(8)]
        await h.db.cloud_market_outlooks.insert_many(legacy)

        activity = []
        for i in range(4):
            direction = legacy[i]["primary_direction"]
            for minute in range(61):
                bid, ask = 100.0, 100.1
                if i == 0 and minute >= 17:       # BUY +0.50R
                    bid, ask = 100.6, 100.7
                elif i == 1 and minute >= 17:     # SELL +0.50R, checked on Ask
                    bid, ask = 99.4, 99.5
                elif i == 2 and minute >= 12:     # BUY SL before qualifying
                    bid, ask = 99.1, 99.2
                elif i == 3:                      # full coverage, no target => timeout
                    bid, ask = 100.2, 100.3
                activity.append(_activity(f"BACKFILL-{i}", published + timedelta(minutes=minute), bid, ask))
        await h.db.cloud_bot_activity.insert_many(activity)

        with patch.object(mo, "_db", return_value=h.db):
            report = await mo.backfill_signal_outlook_history(limit=20)

        rows = await h.db.cloud_market_outlooks.find({}, {"_id": 0}).sort("id", 1).to_list(20)
        reconstructed = [row for row in rows if row.get("historical_repair_status") == "RECONSTRUCTED"]
        unavailable = [row for row in rows if row.get("historical_repair_status") == mo.ANALYTICS_UNAVAILABLE]
        assert report == {"examined": 8, "reconstructed": 4, "wins": 2, "losses": 2, "active": 0, "unavailable": 4}
        assert len(reconstructed) == 4
        assert len(unavailable) == 4
        assert {row["analytics_outcome"] for row in reconstructed} == {mo.ANALYTICS_WIN, mo.ANALYTICS_LOSS}
        assert all(row["excluded_from_signal_analytics"] for row in unavailable)
        assert all(row["final_result"] != "GRAY_EXPIRED_NO_ENTRY" for row in rows)
        assert all(row.get("tracking_entry_price") for row in reconstructed)
        audit = await h.db.cloud_market_outlook_repair_runs.find_one({"tracking_version": 2}, {"_id": 0})
        assert audit["report"] == report
        await h.drop()

    _run(go())
