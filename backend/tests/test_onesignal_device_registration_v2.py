"""Focused tests for genuine OneSignal per-device registration."""
import asyncio
import builtins
import os
import sys
import uuid

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


pytestmark = pytest.mark.skipif(not _mongo_available(), reason="no local MongoDB reachable")
TEST_DB = f"onesignal_device_v2_{uuid.uuid4().hex[:10]}"
os.environ["MONGO_URL"] = "mongodb://localhost:27017"
os.environ["DB_NAME"] = TEST_DB
os.environ.setdefault("JWT_SECRET", "test-secret-onesignal-v2")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")

import server as srv  # noqa: E402
import notifications as notif  # noqa: E402

if not hasattr(builtins, "_xau_onesignal_test_loop"):
    builtins._xau_onesignal_test_loop = asyncio.new_event_loop()
_LOOP = builtins._xau_onesignal_test_loop


def _run(coro):
    return _LOOP.run_until_complete(coro)


def _payload(user_id="user-1", subscription_id="sub-1", device_instance_id="device-1"):
    return {
        "onesignal_subscription_id": subscription_id,
        "onesignal_id": f"os-{user_id}",
        "external_id": user_id,
        "device_instance_id": device_instance_id,
        "device_label": "iPhone PWA",
        "platform": "iPhone",
        "browser": "Safari",
        "timezone_offset_minutes": 60,
        "permission_state": "granted",
        "opted_in": True,
        "token_present": True,
        "service_worker_scope": "/",
        "registration_version": notif.REGISTRATION_VERSION,
    }


async def _clear():
    await srv.db.cloud_push_subscriptions.delete_many({})
    await srv.db.cloud_notification_prefs.delete_many({})
    await srv.db.cloud_notification_log.delete_many({})
    await srv.db.admin_settings.delete_many({})


def test_registration_validation_rejects_mismatched_external_id_and_incomplete_device():
    ok, code, _ = notif.validate_device_registration(_payload(user_id="wrong"), "real-user")
    assert ok is False and code == "EXTERNAL_ID_MISMATCH"
    missing = _payload()
    missing["onesignal_subscription_id"] = ""
    ok, code, _ = notif.validate_device_registration(missing, "user-1")
    assert ok is False and code == "SUBSCRIPTION_ID_MISSING"
    missing = _payload()
    missing["token_present"] = False
    ok, code, _ = notif.validate_device_registration(missing, "user-1")
    assert ok is False and code == "PUSH_TOKEN_MISSING"


def test_same_subscription_is_idempotent_and_two_devices_remain_separate():
    async def go():
        await _clear()
        first = await notif.upsert_device_registration("user-1", _payload(), "ua-1")
        again = await notif.upsert_device_registration("user-1", _payload(), "ua-1")
        second = await notif.upsert_device_registration("user-1", _payload(subscription_id="sub-2", device_instance_id="device-2"), "ua-2")
        assert first["ok"] and again["ok"] and second["ok"]
        assert first["device_id"] == again["device_id"]
        assert await notif.count_complete_active_devices("user-1") == 2
        await _clear()
    _run(go())


def test_changed_subscription_id_for_same_browser_deactivates_only_old_row():
    async def go():
        await _clear()
        await notif.upsert_device_registration("user-1", _payload(subscription_id="old-sub"), "ua")
        await notif.upsert_device_registration("user-1", _payload(subscription_id="new-sub"), "ua")
        old = await srv.db.cloud_push_subscriptions.find_one({"onesignal_subscription_id": "old-sub"})
        new = await srv.db.cloud_push_subscriptions.find_one({"onesignal_subscription_id": "new-sub"})
        assert old["active"] is False and old["opted_in"] is False
        assert new["active"] is True and new["opted_in"] is True
        assert await notif.count_complete_active_devices("user-1") == 1
        await _clear()
    _run(go())


def test_status_distinguishes_incomplete_ready_and_verified():
    async def go():
        await _clear()
        await srv.db.admin_settings.insert_one({"key": "main", "onesignal_app_id": "app", "onesignal_api_key": "key"})
        await srv.db.cloud_notification_prefs.insert_one({"user_id": "user-1", "tier": "HOURLY_ONLY"})
        await srv.db.cloud_push_subscriptions.insert_one({"id": "legacy", "user_id": "user-1", "opted_in": True})
        status = await notif.get_notification_status("user-1")
        assert status["final_status"] == "REGISTRATION_INCOMPLETE"

        await srv.db.cloud_push_subscriptions.delete_many({})
        await notif.upsert_device_registration("user-1", _payload(), "ua")
        status = await notif.get_notification_status("user-1")
        assert status["final_status"] == "READY_NOT_TESTED"
        assert status["active_device_count"] == 1

        now = status["most_recent_registration"]
        await srv.db.cloud_notification_log.insert_one({
            "id": "log", "user_id": "user-1", "scheduled_time": now,
            "sent_time": now, "delivery_status": "SENT", "notification_type": "TEST_NOTIFICATION",
        })
        status = await notif.get_notification_status("user-1")
        assert status["final_status"] == "ON_VERIFIED"
        await _clear()
    _run(go())
