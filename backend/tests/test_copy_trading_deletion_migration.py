"""Real, executable tests for backend/migrations/0001_delete_copy_trading.py
(v6.25.3 Phase 5 P0, final pre-launch hardening).

Runs the actual migration script's run() function against a live, isolated
local MongoDB database (skips cleanly if none reachable) -- not a mock.
Proves: dry-run changes nothing, a real run backs up before deleting,
copy-trading collections are actually gone afterward, cloud_users/
cloud_settings survive with only their copy-trading fields stripped (kept
fields like license_key/monitor_last_heartbeat untouched), and re-running
is idempotent (no error on an already-clean database).
"""
import sys
import os
import json
import uuid
import asyncio
import importlib.util
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
MIGRATION_PATH = BACKEND_DIR / "migrations" / "0001_delete_copy_trading.py"


def _mongo_available() -> bool:
    try:
        from pymongo import MongoClient
        MongoClient("mongodb://localhost:27017", serverSelectionTimeoutMS=800).admin.command("ping")
        return True
    except Exception:
        return False


pytestmark = pytest.mark.skipif(not _mongo_available(), reason="no local MongoDB reachable for this live migration test")

TEST_DB = f"migration_pytest_{uuid.uuid4().hex[:10]}"
os.environ["MONGO_URL"] = "mongodb://localhost:27017"
os.environ["DB_NAME"] = TEST_DB

spec = importlib.util.spec_from_file_location("copy_trading_migration", MIGRATION_PATH)
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

_LOOP = asyncio.new_event_loop()


def _run(coro):
    return _LOOP.run_until_complete(coro)


def _client():
    return AsyncIOMotorClient("mongodb://localhost:27017")[TEST_DB]


async def _seed():
    db = _client()
    await db.cloud_shadow_trades.insert_many([{"x": 1}, {"x": 2}])
    await db.cloud_workers.insert_one({"name": "worker1"})
    await db.cloud_users.insert_one({
        "email": "test@example.com", "mt5_login": "12345",
        "mt5_password_enc": "gAAAAA-fake-encrypted-value", "license_key": "ASE-KEEP1",
    })
    await db.cloud_settings.insert_one({
        "key": "main", "agent_token": "secret-token",
        "monitor_last_heartbeat": "2026-07-17T00:00:00Z",
    })


async def _clear_all():
    db = _client()
    for coll in migration.COPY_TRADING_COLLECTIONS:
        await db[coll].delete_many({})
    await db.cloud_users.delete_many({})
    await db.cloud_settings.delete_many({})


def _clean_backup_dir():
    if migration.BACKUP_DIR.exists():
        for f in migration.BACKUP_DIR.glob("copy_trading_backup_*.json"):
            f.unlink()


def test_dry_run_changes_nothing():
    async def go():
        await _clear_all()
        await _seed()
        await migration.run(confirm=False)
        db = _client()
        assert await db.cloud_shadow_trades.count_documents({}) == 2
        assert await db.cloud_workers.count_documents({}) == 1
        user = await db.cloud_users.find_one({"email": "test@example.com"})
        assert user["mt5_password_enc"] == "gAAAAA-fake-encrypted-value"
        await _clear_all()
        _clean_backup_dir()
    _run(go())


def test_dry_run_still_writes_a_backup_file():
    async def go():
        await _clear_all()
        await _seed()
        _clean_backup_dir()
        await migration.run(confirm=False)
        backups = list(migration.BACKUP_DIR.glob("copy_trading_backup_*.json"))
        assert len(backups) == 1
        data = json.loads(backups[0].read_text())
        assert len(data["collections"]["cloud_shadow_trades"]) == 2
        assert data["cloud_users_fields"][0]["mt5_password_enc"] == "gAAAAA-fake-encrypted-value"
        await _clear_all()
        _clean_backup_dir()
    _run(go())


def test_confirmed_run_backs_up_then_deletes():
    async def go():
        await _clear_all()
        await _seed()
        _clean_backup_dir()
        await migration.run(confirm=True)

        backups = list(migration.BACKUP_DIR.glob("copy_trading_backup_*.json"))
        assert len(backups) == 1
        data = json.loads(backups[0].read_text())
        assert len(data["collections"]["cloud_shadow_trades"]) == 2  # backup captured the real data

        db = _client()
        assert await db.cloud_shadow_trades.count_documents({}) == 0
        assert await db.cloud_workers.count_documents({}) == 0
        await _clear_all()
        _clean_backup_dir()
    _run(go())


def test_cloud_users_survives_with_only_copy_trading_fields_stripped():
    async def go():
        await _clear_all()
        await _seed()
        _clean_backup_dir()
        await migration.run(confirm=True)
        db = _client()
        user = await db.cloud_users.find_one({"email": "test@example.com"})
        assert user is not None  # document itself survives
        assert user["license_key"] == "ASE-KEEP1"  # kept field untouched
        assert "mt5_login" not in user
        assert "mt5_password_enc" not in user
        await _clear_all()
        _clean_backup_dir()
    _run(go())


def test_cloud_settings_survives_with_only_copy_trading_fields_stripped():
    async def go():
        await _clear_all()
        await _seed()
        _clean_backup_dir()
        await migration.run(confirm=True)
        db = _client()
        settings = await db.cloud_settings.find_one({"key": "main"})
        assert settings is not None
        assert settings["monitor_last_heartbeat"] == "2026-07-17T00:00:00Z"  # kept field untouched
        assert "agent_token" not in settings
        await _clear_all()
        _clean_backup_dir()
    _run(go())


def test_rerun_on_already_clean_database_is_idempotent_no_error():
    async def go():
        await _clear_all()
        _clean_backup_dir()
        # No seed data at all -- confirm it doesn't crash on an empty/already-migrated db.
        await migration.run(confirm=True)
        db = _client()
        assert await db.cloud_shadow_trades.count_documents({}) == 0
        await _clear_all()
        _clean_backup_dir()
    _run(go())


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
