"""Regression proof for tenant/account heartbeat isolation in the legacy API."""
import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone, timedelta

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

TEST_DB = f"monitor_binding_pytest_{uuid.uuid4().hex[:10]}"
os.environ["MONGO_URL"] = "mongodb://localhost:27017"
os.environ["DB_NAME"] = TEST_DB
os.environ.setdefault("JWT_SECRET", "test-secret-monitor-binding")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")
os.environ["ENVIRONMENT"] = "test"

import server as srv  # noqa: E402

_LOOP = asyncio.new_event_loop()


def _run(coro):
    return _LOOP.run_until_complete(coro)


def test_monitor_status_never_uses_other_license_heartbeat_via_shared_account():
    async def go():
        await srv.db.pin_licenses.delete_many({})
        await srv.db.cloud_bot_heartbeats.delete_many({})
        await srv.db.cloud_bot_activity.delete_many({})

        now = datetime.now(timezone.utc)
        await srv.db.pin_licenses.insert_one({
            "id": "lic-owner",
            "pin": "ASE-OWNER-0001",
            "mt5_account": "1000001",
            "is_active": True,
            "buyer_email": "owner@test.com",
        })
        # Correct tenant heartbeat is slightly older.
        await srv.db.cloud_bot_heartbeats.insert_one({
            "id": "hb-owner",
            "license_id": "lic-owner",
            "license_key": "ASE-OWNER-0001",
            "pin": "ASE-OWNER-0001",
            "account_number": "1000001",
            "bot_state": "OWNER_ONLINE",
            "ts": (now - timedelta(seconds=20)).isoformat(),
        })
        # Different license, same account_number, fresher. The old
        # license-OR-account query incorrectly selected this row.
        await srv.db.cloud_bot_heartbeats.insert_one({
            "id": "hb-other",
            "license_id": "lic-other",
            "license_key": "ASE-OTHER-0002",
            "pin": "ASE-OTHER-0002",
            "account_number": "1000001",
            "bot_state": "OTHER_LICENSE",
            "ts": (now - timedelta(seconds=1)).isoformat(),
        })

        result = await srv.cloud_monitor_status({
            "id": "user-owner",
            "email": "owner@test.com",
            "license_key": "ASE-OWNER-0001",
        })

        assert result["heartbeat"]["id"] == "hb-owner"
        assert result["heartbeat"]["license_id"] == "lic-owner"
        assert result["status"] == "OWNER_ONLINE"

        await srv.db.pin_licenses.delete_many({})
        await srv.db.cloud_bot_heartbeats.delete_many({})
        await srv.db.cloud_bot_activity.delete_many({})

    _run(go())
