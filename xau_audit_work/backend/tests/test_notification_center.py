"""Tests for the Notification Center: category taxonomy on the existing
cloud_notification_log, backend-persisted read/unread state, per-category
mute preferences, and the paginated/grouped feed used by the frontend.

Uses a live local MongoDB in an isolated database (skips cleanly if none is
reachable), following the same pattern as test_onesignal_notifications.py.
No real OneSignal HTTP calls are made -- these tests exercise the log/read/
mute/pagination logic, not delivery itself.
"""
import sys
import os
import uuid
import asyncio
from unittest.mock import patch, AsyncMock

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

TEST_DB = f"notification_center_pytest_{uuid.uuid4().hex[:10]}"
os.environ["MONGO_URL"] = "mongodb://localhost:27017"
os.environ["DB_NAME"] = TEST_DB
os.environ.setdefault("JWT_SECRET", "test-secret-notification-center")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")

import server as srv  # noqa: E402
import notifications as notif  # noqa: E402

_LOOP = asyncio.new_event_loop()


def _run(coro):
    return _LOOP.run_until_complete(coro)


USER_ID = "user-center-1"
ACCOUNT = "555000111"


async def _clear():
    await srv.db.cloud_notification_log.delete_many({})
    await srv.db.cloud_notification_prefs.delete_many({})


async def _seed_log(**overrides):
    entry = {
        "id": str(uuid.uuid4()),
        "idempotency_key": str(uuid.uuid4()),
        "user_id": USER_ID,
        "outlook_id": None,
        "notification_type": "TP1_HIT",
        "category": "SIGNALS",
        "title": "Test notification",
        "body": "Test body",
        "scheduled_time": "2026-08-04T10:00:00+00:00",
        "sent_time": "2026-08-04T10:00:01+00:00",
        "delivery_status": "SENT",
        "read_at": None,
        "device_count": 1,
        "retry_count": 0,
        "failure_reason": None,
    }
    entry.update(overrides)
    await srv.db.cloud_notification_log.insert_one(dict(entry))
    return entry


class TestCategoryTaxonomy:
    def test_known_events_map_to_expected_categories(self):
        assert notif.notification_category("OUTLOOK_PUBLISHED") == "MARKET_OUTLOOK"
        assert notif.notification_category("TRACKING_STARTED") == "MARKET_OUTLOOK"
        assert notif.notification_category("TP1_HIT") == "SIGNALS"
        assert notif.notification_category("SL_HIT") == "SIGNALS"
        assert notif.notification_category("TRADE_OPENED") == "TRADES"
        assert notif.notification_category("TRADE_CLOSED") == "TRADES"
        assert notif.notification_category("AUTOMATED_TRADE_RESULT") == "TRADES"

    def test_unknown_event_falls_back_to_system(self):
        assert notif.notification_category("SOMETHING_NEW") == "SYSTEM"


class TestNotificationCenterFeed:
    def test_paginates_and_orders_newest_first(self):
        async def go():
            await _clear()
            await _seed_log(id="n1", scheduled_time="2026-08-04T10:00:00+00:00")
            await _seed_log(id="n2", scheduled_time="2026-08-04T11:00:00+00:00")
            await _seed_log(id="n3", scheduled_time="2026-08-04T12:00:00+00:00")
            page1 = await notif.get_notification_center_page(USER_ID, page=1, limit=2)
            assert [row["id"] for row in page1["items"]] == ["n3", "n2"]
            assert page1["total"] == 3
            assert page1["has_more"] is True
            page2 = await notif.get_notification_center_page(USER_ID, page=2, limit=2)
            assert [row["id"] for row in page2["items"]] == ["n1"]
            assert page2["has_more"] is False
        _run(go())

    def test_filters_by_category(self):
        async def go():
            await _clear()
            await _seed_log(id="trade1", category="TRADES", notification_type="TRADE_CLOSED")
            await _seed_log(id="signal1", category="SIGNALS", notification_type="TP1_HIT")
            page = await notif.get_notification_center_page(USER_ID, category="TRADES")
            assert [row["id"] for row in page["items"]] == ["trade1"]
        _run(go())

    def test_unread_only_filter(self):
        async def go():
            await _clear()
            await _seed_log(id="read1", read_at="2026-08-04T10:05:00+00:00")
            await _seed_log(id="unread1", read_at=None)
            page = await notif.get_notification_center_page(USER_ID, unread_only=True)
            assert [row["id"] for row in page["items"]] == ["unread1"]
        _run(go())

    def test_category_counts_include_unread_breakdown(self):
        async def go():
            await _clear()
            await _seed_log(id="t1", category="TRADES", read_at=None)
            await _seed_log(id="t2", category="TRADES", read_at="2026-08-04T10:05:00+00:00")
            page = await notif.get_notification_center_page(USER_ID)
            assert page["category_counts"]["TRADES"] == {"total": 2, "unread": 1}
            assert page["category_counts"]["PAYMENTS"] == {"total": 0, "unread": 0}
        _run(go())

    def test_scoped_to_the_requesting_user_only(self):
        async def go():
            await _clear()
            await _seed_log(id="mine", user_id=USER_ID)
            await _seed_log(id="theirs", user_id="someone-else")
            page = await notif.get_notification_center_page(USER_ID)
            assert [row["id"] for row in page["items"]] == ["mine"]
        _run(go())


class TestReadState:
    def test_mark_single_notification_read(self):
        async def go():
            await _clear()
            await _seed_log(id="n1", read_at=None)
            marked = await notif.mark_notification_read(USER_ID, "n1")
            assert marked is True
            row = await srv.db.cloud_notification_log.find_one({"id": "n1"}, {"_id": 0})
            assert row["read_at"] is not None
        _run(go())

    def test_marking_already_read_notification_is_a_noop(self):
        async def go():
            await _clear()
            await _seed_log(id="n1", read_at="2026-08-04T09:00:00+00:00")
            marked = await notif.mark_notification_read(USER_ID, "n1")
            assert marked is False
        _run(go())

    def test_cannot_mark_another_users_notification_read(self):
        async def go():
            await _clear()
            await _seed_log(id="n1", user_id="someone-else", read_at=None)
            marked = await notif.mark_notification_read(USER_ID, "n1")
            assert marked is False
            row = await srv.db.cloud_notification_log.find_one({"id": "n1"}, {"_id": 0})
            assert row["read_at"] is None
        _run(go())

    def test_mark_all_read_scoped_to_category(self):
        async def go():
            await _clear()
            await _seed_log(id="t1", category="TRADES", read_at=None)
            await _seed_log(id="s1", category="SIGNALS", read_at=None)
            count = await notif.mark_all_notifications_read(USER_ID, category="TRADES")
            assert count == 1
            trades_row = await srv.db.cloud_notification_log.find_one({"id": "t1"}, {"_id": 0})
            signals_row = await srv.db.cloud_notification_log.find_one({"id": "s1"}, {"_id": 0})
            assert trades_row["read_at"] is not None
            assert signals_row["read_at"] is None
        _run(go())

    def test_mark_all_read_without_category_covers_everything(self):
        async def go():
            await _clear()
            await _seed_log(id="t1", category="TRADES", read_at=None)
            await _seed_log(id="s1", category="SIGNALS", read_at=None)
            count = await notif.mark_all_notifications_read(USER_ID)
            assert count == 2
        _run(go())


class TestCategoryMutePreference:
    def test_muted_category_suppresses_outlook_dispatch(self):
        async def go():
            await _clear()
            await srv.db.cloud_notification_prefs.update_one(
                {"user_id": USER_ID},
                {"$set": {"user_id": USER_ID, "account": ACCOUNT, "tier": "ALL_UPDATES",
                          "muted_categories": ["MARKET_OUTLOOK"]}},
                upsert=True,
            )
            doc = {
                "id": str(uuid.uuid4()), "account": ACCOUNT, "primary_direction": "BUY",
                "confidence_pct": 70, "published_at": "2026-08-04T10:00:00+00:00",
                "tracking_entry_price": 2650.0, "published_bid": 2649.8, "published_ask": 2650.2,
            }
            with patch("notifications._market_open_and_bot_connected", new=AsyncMock(return_value=(True, ""))):
                await notif.send_outlook_notification(doc, event="TRACKING_STARTED", min_tier="HOURLY_ONLY")
            log_entry = await srv.db.cloud_notification_log.find_one(
                {"outlook_id": doc["id"], "notification_type": "TRACKING_STARTED"})
            assert log_entry is None
        _run(go())

    def test_non_muted_category_still_dispatches(self):
        async def go():
            await _clear()
            await srv.db.cloud_notification_prefs.update_one(
                {"user_id": USER_ID},
                {"$set": {"user_id": USER_ID, "account": ACCOUNT, "tier": "ALL_UPDATES",
                          "muted_categories": ["TRADES"]}},
                upsert=True,
            )
            doc = {
                "id": str(uuid.uuid4()), "account": ACCOUNT, "primary_direction": "BUY",
                "confidence_pct": 70, "published_at": "2026-08-04T10:00:00+00:00",
                "tracking_entry_price": 2650.0, "published_bid": 2649.8, "published_ask": 2650.2,
            }
            with patch("notifications._market_open_and_bot_connected", new=AsyncMock(return_value=(True, ""))):
                await notif.send_outlook_notification(doc, event="TRACKING_STARTED", min_tier="HOURLY_ONLY")
            log_entry = await srv.db.cloud_notification_log.find_one(
                {"outlook_id": doc["id"], "notification_type": "TRACKING_STARTED"})
            assert log_entry is not None
            assert log_entry["category"] == "MARKET_OUTLOOK"
        _run(go())


class TestLogEntrySnapshotFields:
    def test_outlook_dispatch_persists_category_title_body(self):
        async def go():
            await _clear()
            await srv.db.cloud_notification_prefs.update_one(
                {"user_id": USER_ID},
                {"$set": {"user_id": USER_ID, "account": ACCOUNT, "tier": "ALL_UPDATES", "muted_categories": []}},
                upsert=True,
            )
            doc = {
                "id": str(uuid.uuid4()), "account": ACCOUNT, "primary_direction": "BUY",
                "confidence_pct": 70, "published_at": "2026-08-04T10:00:00+00:00",
                "tracking_entry_price": 2650.0, "published_bid": 2649.8, "published_ask": 2650.2,
            }
            with patch("notifications._market_open_and_bot_connected", new=AsyncMock(return_value=(True, ""))):
                await notif.send_outlook_notification(doc, event="TRACKING_STARTED", min_tier="HOURLY_ONLY")
            log_entry = await srv.db.cloud_notification_log.find_one(
                {"outlook_id": doc["id"], "notification_type": "TRACKING_STARTED"}, {"_id": 0})
            assert log_entry["category"] == "MARKET_OUTLOOK"
            assert log_entry["title"]
            assert log_entry["body"]
            assert log_entry["read_at"] is None
        _run(go())
