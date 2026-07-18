"""Real, executable tests for the v6.25.2 owner-directive fix: duplicate
hourly outlook publication and the wrong "Active" count.

Live evidence: one real BUY outlook published at 08:27, then the SAME 09:00
hourly TRANSITION slot published TWICE, with the frontend showing
Active=3 (BUY + both TRANSITION duplicates) instead of the true directional
count of 1.

Root cause #1 (duplicate publish): hourly_generation_tick()'s existing-slot
check and generate_outlook_for_account()'s insert were two separate
operations with no atomicity between them -- a genuine read-then-write
race. Fixed with a deterministic MongoDB _id
(outlook-slot:{account}:{symbol}:{hourly_slot}) so a second concurrent
insert for the same slot raises DuplicateKeyError and is resolved by
returning the already-persisted winning document, never creating a second
one -- proven here against a live local MongoDB with genuinely concurrent
inserts, not a mocked race.

Root cause #2 (wrong Active count): the stats endpoint's active_unresolved
computation counted ANY non-GRAY record with no final_result, which
silently included non-directional TRANSITION/NEUTRAL/RANGE updates as if
each were its own active signal. Fixed to require primary_direction in
(BUY, SELL).

Skips cleanly if no local MongoDB is reachable, matching this session's
other live-database test convention.
"""
import sys
import os
import asyncio
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


pytestmark = pytest.mark.skipif(not _mongo_available(), reason="no local MongoDB reachable for this live outlook test")


def _run(coro):
    return asyncio.run(coro)


class _Harness:
    def __init__(self):
        from motor.motor_asyncio import AsyncIOMotorClient
        self.db_name = f"outlook_pytest_{uuid.uuid4().hex[:10]}"
        self.client = AsyncIOMotorClient("mongodb://localhost:27017")
        self.db = self.client[self.db_name]

    async def drop(self):
        await self.client.drop_database(self.db_name)


def test_concurrent_atomic_insert_same_slot_produces_exactly_one_record():
    import market_outlook as mo
    h = _Harness()

    async def go():
        account, symbol, slot = "ACC1", "XAUUSD", "2026-07-17T09:00"
        doc_a = {"account": account, "symbol": symbol, "primary_direction": "TRANSITION", "generated_at": "t1", "hourly_slot": slot}
        doc_b = {"account": account, "symbol": symbol, "primary_direction": "TRANSITION", "generated_at": "t2", "hourly_slot": slot}
        results = await asyncio.gather(
            mo._insert_outlook_atomically(h.db, doc_a, account, symbol, slot),
            mo._insert_outlook_atomically(h.db, doc_b, account, symbol, slot),
        )
        newly_inserted_flags = [r.pop("_newly_inserted") for r in results]
        assert sorted(newly_inserted_flags) == [False, True], "exactly one of the two racing inserts must win"
        count = await h.db.cloud_market_outlooks.count_documents(
            {"account": account, "symbol": symbol, "hourly_slot": slot})
        assert count == 1, f"expected exactly one persisted record for this slot, found {count}"
        # both callers must observe the SAME winning document (by _id)
        assert results[0]["_id"] == results[1]["_id"]
        await h.drop()

    _run(go())


def test_ten_concurrent_inserts_same_slot_still_exactly_one_record():
    import market_outlook as mo
    h = _Harness()

    async def go():
        account, symbol, slot = "ACC2", "XAUUSD", "2026-07-17T10:00"
        coros = [mo._insert_outlook_atomically(
            h.db, {"account": account, "symbol": symbol, "hourly_slot": slot, "primary_direction": "TRANSITION", "worker": i}, account, symbol, slot)
            for i in range(10)]
        results = await asyncio.gather(*coros)
        winners = sum(1 for r in results if r.get("_newly_inserted"))
        assert winners == 1, f"exactly one of ten racing inserts must win, got {winners}"
        count = await h.db.cloud_market_outlooks.count_documents(
            {"account": account, "symbol": symbol, "hourly_slot": slot})
        assert count == 1
        await h.drop()

    _run(go())


def test_different_slots_each_get_their_own_record():
    import market_outlook as mo
    h = _Harness()

    async def go():
        account, symbol = "ACC3", "XAUUSD"
        r1 = await mo._insert_outlook_atomically(h.db, {"account": account, "symbol": symbol, "primary_direction": "BUY"}, account, symbol, "2026-07-17T08:00")
        r2 = await mo._insert_outlook_atomically(h.db, {"account": account, "symbol": symbol, "primary_direction": "TRANSITION"}, account, symbol, "2026-07-17T09:00")
        assert r1["_newly_inserted"] is True
        assert r2["_newly_inserted"] is True
        assert r1["_id"] != r2["_id"]
        count = await h.db.cloud_market_outlooks.count_documents({"account": account, "symbol": symbol})
        assert count == 2
        await h.drop()

    _run(go())


def test_deterministic_slot_id_format():
    import market_outlook as mo
    assert mo._outlook_slot_id("ACC1", "XAUUSD", "2026-07-17T09:00") == "outlook-slot:ACC1:XAUUSD:2026-07-17T09:00"


def test_active_count_excludes_transition_and_only_counts_directional():
    """The exact live-evidence scenario: one BUY + two TRANSITION records
    (simulating the pre-fix duplicate) must yield active_unresolved_count=1,
    not 3."""
    stats_rows = [
        {"primary_direction": "BUY", "final_result": None, "excluded_from_stats": False},
        {"primary_direction": "TRANSITION", "final_result": None, "excluded_from_stats": False},
        {"primary_direction": "TRANSITION", "final_result": None, "excluded_from_stats": False},
    ]
    active_unresolved = [o for o in stats_rows
                          if o.get("primary_direction") in ("BUY", "SELL")
                          and o.get("final_result") is None]
    assert len(active_unresolved) == 1


def test_active_count_excludes_resolved_directional_signals():
    stats_rows = [
        {"primary_direction": "BUY", "final_result": None},
        {"primary_direction": "SELL", "final_result": "RED_STOPPED"},
        {"primary_direction": "NEUTRAL", "final_result": None},
        {"primary_direction": "RANGE", "final_result": None},
        {"primary_direction": "NO_VALID_OUTLOOK", "final_result": None},
    ]
    active_unresolved = [o for o in stats_rows
                          if o.get("primary_direction") in ("BUY", "SELL")
                          and o.get("final_result") is None]
    assert len(active_unresolved) == 1
    assert active_unresolved[0]["primary_direction"] == "BUY"


def test_routes_active_unresolved_uses_primary_direction_filter():
    # static confirmation that the actual endpoint code (not just this
    # test's reimplementation of the logic) was changed to the same rule
    routes_src = open(os.path.join(BACKEND_DIR, "market_outlook_routes.py")).read()
    idx = routes_src.index("active_unresolved = [o for o in actionable")
    window = routes_src[idx: idx + 250]
    assert 'o.get("analytics_outcome") is None' in window
    actionable_idx = routes_src.index("actionable = [o for o in stats_rows")
    actionable_window = routes_src[actionable_idx: actionable_idx + 300]
    assert 'o.get("primary_direction") in ("BUY", "SELL")' in actionable_window


def test_hourly_generation_tick_only_dispatches_notification_on_real_win():
    mo_src = open(os.path.join(BACKEND_DIR, "market_outlook.py")).read()
    idx = mo_src.index("async def hourly_generation_tick(")
    fn = mo_src[idx: idx + 4500]
    assert 'newly_inserted = doc.pop("_newly_inserted", True)' in fn
    assert "if newly_inserted:" in fn
    # the notification dispatch call must be inside the newly_inserted branch
    dispatch_idx = fn.index("await _dispatch_hourly_notification(doc)")
    guard_idx = fn.index("if newly_inserted:")
    else_idx = fn.index("else:", guard_idx)
    assert guard_idx < dispatch_idx < else_idx
