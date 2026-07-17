"""Real, executable tests for the v6.25.3 OneSignal push notification
system, which replaced self-hosted Web Push (pywebpush + VAPID) -- that
implementation was permanently blocked by a missing Python package in
production that only a full backend rebuild could fix. OneSignal needs
nothing but a plain HTTPS POST (via httpx, already installed and working).

Uses a live local MongoDB in an isolated database (skips cleanly if none is
reachable) for the real config-read/log-write behavior, and mocks the
actual OneSignal HTTP call (no live OneSignal account in this environment)
to verify the request shape and failure-classification logic.
"""
import sys
import os
import asyncio
import uuid
from unittest.mock import patch, AsyncMock, MagicMock

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


pytestmark = pytest.mark.skipif(not _mongo_available(), reason="no local MongoDB reachable for this live OneSignal test")

TEST_DB = f"onesignal_pytest_{uuid.uuid4().hex[:10]}"
os.environ["MONGO_URL"] = "mongodb://localhost:27017"
os.environ["DB_NAME"] = TEST_DB
os.environ.setdefault("JWT_SECRET", "test-secret-onesignal")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")

import server as srv  # noqa: E402
import notifications as notif  # noqa: E402

_LOOP = asyncio.new_event_loop()


def _run(coro):
    return _LOOP.run_until_complete(coro)


async def _set_config(app_id: str, api_key: str):
    await srv.db.admin_settings.update_one(
        {"key": "main"}, {"$set": {"onesignal_app_id": app_id, "onesignal_api_key": api_key}}, upsert=True)


async def _clear():
    await srv.db.admin_settings.delete_many({})
    await srv.db.cloud_push_subscriptions.delete_many({})
    await srv.db.cloud_notification_prefs.delete_many({})
    await srv.db.cloud_notification_log.delete_many({})


def _fake_response(status_code=200, json_data=None):
    resp = MagicMock()
    resp.status_code = status_code
    resp.text = str(json_data or {})
    resp.json = MagicMock(return_value=json_data or {})
    return resp


class _FakeAsyncClient:
    """Mimics httpx.AsyncClient as an async context manager whose .post()
    returns a pre-built fake response -- lets tests exercise the real
    _send_onesignal() request-shape and failure-classification logic
    without a live OneSignal account."""
    def __init__(self, response=None, raise_exc=None):
        self._response = response
        self._raise_exc = raise_exc
        self.last_call = None

    def __call__(self, *args, **kwargs):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, json=None, headers=None):
        self.last_call = {"url": url, "json": json, "headers": headers}
        if self._raise_exc:
            raise self._raise_exc
        return self._response


def test_status_not_configured_when_settings_empty():
    async def go():
        await _clear()
        status = await notif.get_onesignal_status()
        assert status["configured"] is False
        assert status["app_id"] == ""
        assert status["initialization_state"] == "NOT_CONFIGURED"
        await _clear()
    _run(go())


def test_status_configured_when_both_credentials_present():
    async def go():
        await _clear()
        await _set_config("app-123", "key-abc")
        status = await notif.get_onesignal_status()
        assert status["configured"] is True
        assert status["app_id"] == "app-123"
        assert status["initialization_state"] == "READY"
        await _clear()
    _run(go())


def test_status_never_exposes_api_key():
    async def go():
        await _clear()
        await _set_config("app-123", "super-secret-key")
        status = await notif.get_onesignal_status()
        assert "super-secret-key" not in str(status)
        await _clear()
    _run(go())


def test_config_changes_take_effect_immediately_no_restart_needed():
    # Unlike the retired VAPID system's startup-only initialization, this
    # module reads settings live on every call.
    async def go():
        await _clear()
        status_before = await notif.get_onesignal_status()
        assert status_before["configured"] is False
        await _set_config("app-456", "key-def")
        status_after = await notif.get_onesignal_status()
        assert status_after["configured"] is True
        await _clear()
    _run(go())


def test_send_test_notification_server_not_configured():
    async def go():
        await _clear()
        result = await notif.send_test_notification("user-1")
        assert result["status"] == "SERVER_NOT_CONFIGURED"
        await _clear()
    _run(go())


def test_send_test_notification_no_device():
    async def go():
        await _clear()
        await _set_config("app-123", "key-abc")
        result = await notif.send_test_notification("user-no-device")
        assert result["status"] == "NO_DEVICE"
        await _clear()
    _run(go())


def test_send_test_notification_success_path_hits_onesignal_and_logs_sent():
    async def go():
        await _clear()
        await _set_config("app-123", "key-abc")
        await srv.db.cloud_push_subscriptions.insert_one(
            {"id": "dev-1", "user_id": "user-2", "opted_in": True, "created_at": "2026-07-17T00:00:00Z"})
        fake_client = _FakeAsyncClient(response=_fake_response(200, {"id": "notif-1", "recipients": 1}))
        with patch("notifications.httpx.AsyncClient", fake_client):
            result = await notif.send_test_notification("user-2")
        assert result["status"] == "SENT"
        assert fake_client.last_call["json"]["include_external_user_ids"] == ["user-2"]
        assert fake_client.last_call["json"]["app_id"] == "app-123"
        assert fake_client.last_call["headers"]["Authorization"] == "Basic key-abc"
        log = await srv.db.cloud_notification_log.find_one({"user_id": "user-2"})
        assert log["delivery_status"] == "SENT"
        await _clear()
    _run(go())


def test_send_test_notification_never_reports_sent_on_zero_recipients():
    # OneSignal's own recipients=0 means nothing was actually delivered --
    # must not be reported as SENT just because the HTTP call didn't raise.
    async def go():
        await _clear()
        await _set_config("app-123", "key-abc")
        await srv.db.cloud_push_subscriptions.insert_one(
            {"id": "dev-1", "user_id": "user-3", "opted_in": True, "created_at": "2026-07-17T00:00:00Z"})
        fake_client = _FakeAsyncClient(response=_fake_response(200, {"id": "notif-2", "recipients": 0}))
        with patch("notifications.httpx.AsyncClient", fake_client):
            result = await notif.send_test_notification("user-3")
        assert result["status"] == "NO_DEVICE"
        log = await srv.db.cloud_notification_log.find_one({"user_id": "user-3"})
        assert log["delivery_status"] == "FAILED"
        assert log["failure_reason"] == notif.NO_DEVICE_REGISTERED
        await _clear()
    _run(go())


def test_send_test_notification_classifies_auth_failure():
    async def go():
        await _clear()
        await _set_config("app-123", "wrong-key")
        await srv.db.cloud_push_subscriptions.insert_one(
            {"id": "dev-1", "user_id": "user-4", "opted_in": True, "created_at": "2026-07-17T00:00:00Z"})
        fake_client = _FakeAsyncClient(response=_fake_response(401, {"errors": ["Invalid app_id/key"]}))
        with patch("notifications.httpx.AsyncClient", fake_client):
            result = await notif.send_test_notification("user-4")
        assert result["status"] == "FAILED"
        assert "REST API Key" in result["message"]
        log = await srv.db.cloud_notification_log.find_one({"user_id": "user-4"})
        assert log["failure_reason"] == notif.AUTHENTICATION_FAILED
        await _clear()
    _run(go())


def test_send_test_notification_classifies_network_timeout_as_temporary():
    import httpx
    async def go():
        await _clear()
        await _set_config("app-123", "key-abc")
        await srv.db.cloud_push_subscriptions.insert_one(
            {"id": "dev-1", "user_id": "user-5", "opted_in": True, "created_at": "2026-07-17T00:00:00Z"})
        fake_client = _FakeAsyncClient(raise_exc=httpx.TimeoutException("timed out"))
        with patch("notifications.httpx.AsyncClient", fake_client):
            ok, failure_class = await notif._send_onesignal("user-5", {"title": "t", "body": "b"})
        assert ok is False
        assert failure_class == notif.TEMPORARY_DELIVERY_FAILURE
        await _clear()
    _run(go())


def test_subscription_deleted_by_onesignal_failure_never_happens():
    # v6.25.3 -- OneSignal owns device lifecycle entirely; a failed send
    # must never delete our own opt-in record the way the retired
    # self-hosted code deleted on a confirmed 404/410.
    async def go():
        await _clear()
        await _set_config("app-123", "wrong-key")
        await srv.db.cloud_push_subscriptions.insert_one(
            {"id": "dev-1", "user_id": "user-6", "opted_in": True, "created_at": "2026-07-17T00:00:00Z"})
        fake_client = _FakeAsyncClient(response=_fake_response(401, {}))
        with patch("notifications.httpx.AsyncClient", fake_client):
            await notif.send_test_notification("user-6")
        still_there = await srv.db.cloud_push_subscriptions.find_one({"user_id": "user-6"})
        assert still_there is not None
        assert still_there["opted_in"] is True
        await _clear()
    _run(go())


def test_outlook_notification_respects_tier_gating():
    async def go():
        await _clear()
        await _set_config("app-123", "key-abc")
        await srv.db.cloud_notification_prefs.insert_one(
            {"user_id": "user-7", "account": "acct-1", "tier": "HOURLY_ONLY"})
        # ENTRY_ZONE_REACHED requires ALL_UPDATES -- HOURLY_ONLY must not receive it
        sent = await notif.send_outlook_notification(
            {"id": "outlook-1", "account": "acct-1", "primary_direction": "BUY"},
            event="ENTRY_ZONE_REACHED", min_tier="ALL_UPDATES")
        assert sent == 0
        log = await srv.db.cloud_notification_log.find_one({"user_id": "user-7"})
        assert log is None
        await _clear()
    _run(go())


def test_outlook_notification_idempotent_on_duplicate_event():
    async def go():
        await _clear()
        await _set_config("app-123", "key-abc")
        await srv.db.cloud_notification_prefs.insert_one(
            {"user_id": "user-8", "account": "acct-2", "tier": "HOURLY_ONLY"})
        await srv.db.cloud_push_subscriptions.insert_one(
            {"id": "dev-8", "user_id": "user-8", "opted_in": True, "created_at": "2026-07-17T00:00:00Z"})
        doc = {"id": "outlook-2", "account": "acct-2", "primary_direction": "BUY", "confidence_pct": 70}
        fake_client = _FakeAsyncClient(response=_fake_response(200, {"id": "n1", "recipients": 1}))
        with patch("notifications.httpx.AsyncClient", fake_client):
            first = await notif.send_outlook_notification(doc, event="OUTLOOK_PUBLISHED", min_tier="HOURLY_ONLY")
            second = await notif.send_outlook_notification(doc, event="OUTLOOK_PUBLISHED", min_tier="HOURLY_ONLY")
        assert first == 1
        assert second == 0  # idempotency key already logged, must not double-send
        count = await srv.db.cloud_notification_log.count_documents({"user_id": "user-8"})
        assert count == 1
        await _clear()
    _run(go())


if __name__ == "__main__":
    import sys
    import pytest
    sys.exit(pytest.main([__file__, "-v"]))
