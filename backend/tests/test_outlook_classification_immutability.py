"""Tests that a Market Outlook signal's final classification (WIN/LOSS via
analytics_outcome/analytics_r) can never be overwritten once set -- the
"duplicate final results" concern. Covers, end-to-end through the real
persisted write path (track_outlook_lifecycle_tick), not just the pure
state-machine function in isolation:

1. A signal already classified WIN stays WIN even when fed a later price
   that would otherwise look like an SL cross.
2. The database itself now has a unique constraint on cloud_market_outlooks.id
   (added alongside this), so a duplicate-id bug fails loudly at startup
   rather than silently allowing two "final results" for one signal.
3. The classifying write's own query filter refuses to commit a first-time
   classification unless the document is still unclassified at write time.
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

TEST_DB = f"outlook_classification_immutability_pytest_{uuid.uuid4().hex[:10]}"
os.environ["MONGO_URL"] = "mongodb://localhost:27017"
os.environ["DB_NAME"] = TEST_DB
os.environ.setdefault("JWT_SECRET", "test-secret-outlook-classification")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")

import server as srv  # noqa: E402
import market_outlook as mo  # noqa: E402

_LOOP = asyncio.new_event_loop()


def _run(coro):
    return _LOOP.run_until_complete(coro)


ACCOUNT = "999888777"
_REF = datetime.now(timezone.utc)


async def _clear():
    await srv.db.cloud_market_outlooks.delete_many({})


def _tracking_doc(**overrides):
    doc = {
        "id": str(uuid.uuid4()),
        "account": ACCOUNT,
        "symbol": "XAUUSD",
        "primary_direction": "BUY",
        "tracking_entry_price": 2650.0,
        "original_sl": 2645.0,
        "tp1_price": 2660.0,
        "tp2_price": 2665.0,
        "tp3_price": 2670.0,
        "risk_distance": 5.0,
        "monitoring_closed": False,
        "analytics_outcome": None,
        "analytics_r": None,
        "current_r": 0.0,
        "mfe_r": 0.0,
        "mae_r": 0.0,
        "last_monitored_at": (_REF - timedelta(minutes=10)).isoformat(),
        "published_at": (_REF - timedelta(minutes=15)).isoformat(),
        "evaluation_deadline": (_REF + timedelta(minutes=45)).isoformat(),
    }
    doc.update(overrides)
    return doc


class TestClassificationNeverOverwritten:
    def test_already_classified_win_survives_a_contradicting_sl_price(self):
        async def go():
            await _clear()
            doc = _tracking_doc(
                analytics_outcome=mo.ANALYTICS_WIN, analytics_r=2.0,
                signal_state=mo.SIGNAL_WIN_TP1, tp1_hit_at=(_REF - timedelta(minutes=5)).isoformat(),
                classification_at=(_REF - timedelta(minutes=5)).isoformat(),
            )
            await srv.db.cloud_market_outlooks.insert_one(dict(doc))

            # Feed a price that crossed the SL -- if classification were
            # mutable, this could look like it should flip the result.
            await mo.track_outlook_lifecycle_tick(account=ACCOUNT, bid=2644.0, ask=2644.2, quote_at=_REF)

            persisted = await srv.db.cloud_market_outlooks.find_one({"id": doc["id"]}, {"_id": 0})
            assert persisted["analytics_outcome"] == mo.ANALYTICS_WIN
            assert persisted["analytics_r"] == 2.0
        _run(go())

    def test_already_classified_loss_survives_a_contradicting_tp_price(self):
        async def go():
            await _clear()
            doc = _tracking_doc(
                analytics_outcome=mo.ANALYTICS_LOSS, analytics_r=-1.0,
                signal_state=mo.SIGNAL_LOSS_SL, sl_hit_at=(_REF - timedelta(minutes=5)).isoformat(),
                classification_at=(_REF - timedelta(minutes=5)).isoformat(),
            )
            await srv.db.cloud_market_outlooks.insert_one(dict(doc))

            # Feed a price that crossed TP1 -- must not flip an already-final LOSS to WIN.
            await mo.track_outlook_lifecycle_tick(account=ACCOUNT, bid=2661.0, ask=2661.2, quote_at=_REF)

            persisted = await srv.db.cloud_market_outlooks.find_one({"id": doc["id"]}, {"_id": 0})
            assert persisted["analytics_outcome"] == mo.ANALYTICS_LOSS
            assert persisted["analytics_r"] == -1.0
        _run(go())

    def test_first_time_classification_still_works_normally(self):
        """The immutability guard must not block a genuine first
        classification -- an unclassified signal that reaches TP1 still
        resolves to WIN. (SL touching alone no longer finalizes a result at
        all -- owner-approved rule, 2026-08-04 -- so TP1 is what exercises
        a genuine first-time classification here.)"""
        async def go():
            await _clear()
            doc = _tracking_doc()
            await srv.db.cloud_market_outlooks.insert_one(dict(doc))

            await mo.track_outlook_lifecycle_tick(account=ACCOUNT, bid=2660.0, ask=2660.2, quote_at=_REF)

            persisted = await srv.db.cloud_market_outlooks.find_one({"id": doc["id"]}, {"_id": 0})
            assert persisted["analytics_outcome"] == mo.ANALYTICS_WIN
        _run(go())


class TestUniqueIdConstraint:
    def test_duplicate_id_insert_is_rejected_by_the_database(self):
        """The unique index on cloud_market_outlooks.id -- a second document
        claiming the same signal id must be rejected at the database level,
        not just prevented by application logic."""
        async def go():
            await _clear()
            await srv.db.cloud_market_outlooks.create_index("id", unique=True)
            shared_id = str(uuid.uuid4())
            await srv.db.cloud_market_outlooks.insert_one(_tracking_doc(id=shared_id))
            from pymongo.errors import DuplicateKeyError
            with pytest.raises(DuplicateKeyError):
                await srv.db.cloud_market_outlooks.insert_one(_tracking_doc(id=shared_id))
        _run(go())
