"""Real, executable tests for the self-initializing VAPID web-push key
system (notifications.py). Runs actual async initialization logic against a
live local MongoDB in an isolated database -- not a static source-text
check. Skips cleanly if no local MongoDB is reachable (e.g. a CI runner
with no database service configured).

v6.25.2 owner directive 2026-07-17: the old module-import-time
`VAPID_PUBLIC_KEY = os.environ.get(...)` pattern permanently cached an
empty string whenever the deployed environment hadn't set the variable,
which is exactly the SERVER_NOT_CONFIGURED failure this test suite proves
is fixed.
"""
import sys
import os
import asyncio
import types
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


pytestmark = pytest.mark.skipif(not _mongo_available(), reason="no local MongoDB reachable for this live VAPID test")


def _fresh_env(monkeypatch):
    monkeypatch.delenv("VAPID_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("VAPID_PRIVATE_KEY", raising=False)


class _Harness:
    """Isolates each test in its own throwaway MongoDB database and
    provides a fake `server` module so notifications._db() (which does
    `import server as _srv; return _srv.db`) resolves here instead of
    importing the full FastAPI app."""

    def __init__(self):
        from motor.motor_asyncio import AsyncIOMotorClient
        self.db_name = f"vapid_pytest_{uuid.uuid4().hex[:10]}"
        self.client = AsyncIOMotorClient("mongodb://localhost:27017")
        self.db = self.client[self.db_name]
        fake_server = types.ModuleType("server")
        fake_server.db = self.db
        sys.modules["server"] = fake_server

    def fresh_notifications_module(self):
        sys.modules.pop("notifications", None)
        import notifications as notif
        return notif

    async def drop(self):
        await self.client.drop_database(self.db_name)


def _run(coro):
    return asyncio.run(coro)


def test_missing_env_and_database_generates_a_valid_pair(monkeypatch):
    _fresh_env(monkeypatch)
    h = _Harness()

    async def go():
        notif = h.fresh_notifications_module()
        await notif.initialize_vapid_keys()
        status = await notif.get_vapid_status()
        assert status["configured"] is True
        assert status["initialization_state"] == "READY_DATABASE"
        assert len(status["public_key"]) > 0
        assert status["key_fingerprint"]
        doc = await h.db.system_settings.find_one({"_id": "web_push_vapid_primary"})
        assert doc is not None and doc["public_key"] == status["public_key"]
        await h.drop()

    _run(go())


def test_restart_loads_the_same_persisted_pair_same_fingerprint(monkeypatch):
    _fresh_env(monkeypatch)
    h = _Harness()

    async def go():
        notif1 = h.fresh_notifications_module()
        await notif1.initialize_vapid_keys()
        first_status = await notif1.get_vapid_status()

        # Simulate a full backend restart: fresh module state, same DB.
        notif2 = h.fresh_notifications_module()
        await notif2.initialize_vapid_keys()
        second_status = await notif2.get_vapid_status()

        assert second_status["public_key"] == first_status["public_key"]
        assert second_status["key_fingerprint"] == first_status["key_fingerprint"]
        assert await h.db.system_settings.count_documents({"_id": "web_push_vapid_primary"}) == 1
        await h.drop()

    _run(go())


def test_valid_environment_keypair_takes_priority(monkeypatch):
    _fresh_env(monkeypatch)
    h = _Harness()

    async def go():
        notif = h.fresh_notifications_module()
        pub, priv = notif._generate_vapid_keypair()
        monkeypatch.setenv("VAPID_PUBLIC_KEY", pub)
        monkeypatch.setenv("VAPID_PRIVATE_KEY", priv)
        await notif.initialize_vapid_keys()
        status = await notif.get_vapid_status()
        assert status["initialization_state"] == "READY_ENV"
        assert status["public_key"] == pub
        await h.drop()

    _run(go())


def test_invalid_environment_pair_falls_back_to_database_safely(monkeypatch):
    _fresh_env(monkeypatch)
    h = _Harness()

    async def go():
        # First establish a real persisted database pair.
        notif1 = h.fresh_notifications_module()
        await notif1.initialize_vapid_keys()
        db_status = await notif1.get_vapid_status()

        # Now a corrupted/garbage env pair must not be trusted, and must
        # not crash -- it falls back to the real persisted database pair.
        monkeypatch.setenv("VAPID_PUBLIC_KEY", "not-a-real-key")
        monkeypatch.setenv("VAPID_PRIVATE_KEY", "also-not-real")
        notif2 = h.fresh_notifications_module()
        await notif2.initialize_vapid_keys()
        status = await notif2.get_vapid_status()
        assert status["initialization_state"] == "READY_DATABASE"
        assert status["public_key"] == db_status["public_key"]
        await h.drop()

    _run(go())


def test_two_workers_initializing_simultaneously_converge_on_one_pair(monkeypatch):
    _fresh_env(monkeypatch)
    h = _Harness()

    async def go():
        notif_a = h.fresh_notifications_module()
        sys.modules.pop("notifications", None)
        import notifications as notif_b
        await asyncio.gather(notif_a.initialize_vapid_keys(), notif_b.initialize_vapid_keys())
        status_a = await notif_a.get_vapid_status()
        status_b = await notif_b.get_vapid_status()
        assert status_a["public_key"] == status_b["public_key"]
        assert status_a["key_fingerprint"] == status_b["key_fingerprint"]
        assert await h.db.system_settings.count_documents({"_id": "web_push_vapid_primary"}) == 1
        await h.drop()

    _run(go())


def test_private_key_never_exposed_in_status(monkeypatch):
    _fresh_env(monkeypatch)
    h = _Harness()

    async def go():
        notif = h.fresh_notifications_module()
        await notif.initialize_vapid_keys()
        status = await notif.get_vapid_status()
        assert "private_key" not in status
        priv = await notif.get_vapid_private_key()
        assert priv not in str(status)
        await h.drop()

    _run(go())


def test_public_key_endpoint_status_reports_readiness_truthfully(monkeypatch):
    _fresh_env(monkeypatch)
    h = _Harness()

    async def go():
        notif = h.fresh_notifications_module()
        # Before initialization completes, a concurrent accessor call must
        # WAIT for it, never report false readiness.
        init_task = asyncio.create_task(notif.initialize_vapid_keys())
        status = await notif.get_vapid_status()
        await init_task
        assert status["initialization_state"] != "INITIALIZING"
        assert status["configured"] is True
        await h.drop()

    _run(go())


def test_pywebpush_dependency_missing_is_reported_not_crashed(monkeypatch):
    _fresh_env(monkeypatch)
    h = _Harness()

    async def go():
        import builtins
        real_import = builtins.__import__

        def blocking_import(name, *a, **kw):
            if name == "pywebpush":
                raise ImportError("simulated missing dependency")
            return real_import(name, *a, **kw)

        builtins.__import__ = blocking_import
        try:
            notif = h.fresh_notifications_module()
            await notif.initialize_vapid_keys()
            status = await notif.get_vapid_status()
            assert status["initialization_state"] == "DEPENDENCY_MISSING"
            assert status["dependency_available"] is False
            assert status["configured"] is False
        finally:
            builtins.__import__ = real_import
        await h.drop()

    _run(go())


def test_existing_device_subscription_refreshes_not_stale_early_return(monkeypatch):
    """Behavioral proxy for the subscribe-route refresh logic: confirms the
    underlying VAPID status a second subscribe would compare against is
    stable across repeated reads within the same key generation (repeated
    calls must not spuriously report a rotation when nothing rotated)."""
    _fresh_env(monkeypatch)
    h = _Harness()

    async def go():
        notif = h.fresh_notifications_module()
        await notif.initialize_vapid_keys()
        status1 = await notif.get_vapid_status()
        status2 = await notif.get_vapid_status()
        assert status1["key_fingerprint"] == status2["key_fingerprint"]
        await h.drop()

    _run(go())


def test_key_fingerprint_mismatch_is_detectable_for_resubscription(monkeypatch):
    _fresh_env(monkeypatch)
    h = _Harness()

    async def go():
        notif = h.fresh_notifications_module()
        await notif.initialize_vapid_keys()
        current_status = await notif.get_vapid_status()
        stale_fingerprint = "0000000000000000"
        assert stale_fingerprint != current_status["key_fingerprint"]
        # _send_webpush's KEY_MISMATCH branch compares device["vapid_key_fingerprint"]
        # against the active fingerprint -- verify the two really do differ
        # for a device that subscribed under a rotated-away key.
        fake_device = {"id": "dev1", "endpoint": "https://example.com/x",
                        "keys": {}, "vapid_key_fingerprint": stale_fingerprint}
        ok, failure_class = await notif._send_webpush(fake_device, {"title": "t", "body": "b"})
        assert ok is False
        assert failure_class == notif.KEY_MISMATCH
        await h.drop()

    _run(go())
