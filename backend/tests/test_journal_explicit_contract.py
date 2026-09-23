"""Regression proof for additive journal contract fields in legacy server.py."""
import asyncio
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

TEST_DB = f"journal_contract_pytest_{uuid.uuid4().hex[:10]}"
os.environ["MONGO_URL"] = "mongodb://localhost:27017"
os.environ["DB_NAME"] = TEST_DB
os.environ.setdefault("JWT_SECRET", "test-secret-journal-contract")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")
os.environ["ENVIRONMENT"] = "test"

import server as srv  # noqa: E402

_LOOP = asyncio.new_event_loop()


def _run(coro):
    return _LOOP.run_until_complete(coro)


async def _seed():
    await srv.db.trade_journal.delete_many({})
    await srv.db.pin_licenses.delete_many({})
    await srv.db.pin_licenses.insert_one({
        "id": "lic-journal",
        "pin": "ASE-JOURNAL-0001",
        "mt5_account": "1000001",
        "is_active": True,
        "buyer_email": "journal@test.com",
    })


def test_journal_preserves_explicit_newer_ea_pnl_fields():
    async def go():
        await _seed()
        entry = srv.TradeJournalEntry(
            pin="ASE-JOURNAL-0001",
            account_login="1000001",
            symbol="XAUUSD",
            direction="BUY",
            result="WIN",
            profit=125,
            gross_profit=150,
            net_profit=125,
            fees=-5,
            commission=-15,
            swap=-5,
            schema_version="trade-journal-v2",
        )
        result = await srv.log_trade_journal(entry, None)
        assert result["status"] == "ok"
        stored = await srv.db.trade_journal.find_one({"license_id": "lic-journal"}, {"_id": 0})
        assert stored["gross_profit"] == 150
        assert stored["net_profit"] == 125
        assert stored["fees"] == -5
        assert stored["schema_version"] == "trade-journal-v2"
        await srv.db.trade_journal.delete_many({})
        await srv.db.pin_licenses.delete_many({})

    _run(go())


def test_legacy_journal_payload_does_not_invent_explicit_zero_fields():
    async def go():
        await _seed()
        entry = srv.TradeJournalEntry(
            pin="ASE-JOURNAL-0001",
            account_login="1000001",
            symbol="XAUUSD",
            direction="BUY",
            result="WIN",
            profit=125,
        )
        result = await srv.log_trade_journal(entry, None)
        assert result["status"] == "ok"
        stored = await srv.db.trade_journal.find_one({"license_id": "lic-journal"}, {"_id": 0})
        assert "gross_profit" not in stored
        assert "net_profit" not in stored
        assert "fees" not in stored
        assert "schema_version" not in stored
        assert stored["profit"] == 125
        await srv.db.trade_journal.delete_many({})
        await srv.db.pin_licenses.delete_many({})

    _run(go())
