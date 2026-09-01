"""Tests for Phase 2 (owner directive, 2026-08-05): every genuine, fresh,
owner-policy-approved Market Outlook signal becomes an EA execution
candidate via the existing cloud_bot_commands remote-command channel --
outlook_execution.enqueue_if_actionable(). No second execution engine, no
second policy engine: this only tests that exactly one command is queued
per signal, with the same account/signal_id-scoped uniqueness guarantee
cloud_bot_commands.dedupe_key already provides for every other remote
command action.

enqueue_if_actionable() deliberately lives in its own module, never inside
market_outlook.py -- see outlook_execution.py's own docstring and
market_outlook.py's STRICT SEPARATION docstring/tests
(test_no_trade_execution_calls_anywhere_in_outlook_module /
test_outlook_module_only_writes_its_own_collections /
test_generate_outlook_never_calls_readiness_engine_mutating_functions in
test_market_outlook.py) for why that boundary is enforced.
"""
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


pytestmark = pytest.mark.skipif(not _mongo_available(), reason="no local MongoDB reachable for this test")

TEST_DB = f"outlook_exec_command_pytest_{uuid.uuid4().hex[:10]}"
os.environ["MONGO_URL"] = "mongodb://localhost:27017"
os.environ["DB_NAME"] = TEST_DB
os.environ.setdefault("JWT_SECRET", "test-secret-outlook-exec-command")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")

import server as srv  # noqa: E402
import outlook_execution as oe  # noqa: E402

_LOOP = asyncio.new_event_loop()


def _run(coro):
    return _LOOP.run_until_complete(coro)


ACCOUNT = "OUTLOOK-EXEC-ACCOUNT"


async def _cleanup():
    await srv.db.cloud_bot_commands.delete_many({})
    try:
        await srv.db.cloud_bot_commands.create_index("dedupe_key", unique=True, sparse=True)
    except Exception:
        pass


def _signal_doc(signal_id="sig-1", direction="BUY", account=ACCOUNT, license_key="LIC-1"):
    return {
        "id": signal_id, "account": account, "license_key": license_key,
        "primary_direction": direction,
    }


def test_actionable_signal_queues_exactly_one_command():
    async def go():
        await _cleanup()
        with __import__("unittest.mock", fromlist=["patch"]).patch.object(oe, "_db", return_value=srv.db):
            command_id = await oe.enqueue_if_actionable(_signal_doc())
        assert command_id
        rows = await srv.db.cloud_bot_commands.find({"outlook_signal_id": "sig-1"}, {"_id": 0}).to_list(10)
        assert len(rows) == 1
        assert rows[0]["action"] == "OUTLOOK_SIGNAL_OPEN"
        assert rows[0]["status"] == "PENDING"
        assert rows[0]["payload"] == {"direction": "BUY", "signal_id": "sig-1"}
        assert rows[0]["mt5_account"] == ACCOUNT
        await _cleanup()
    _run(go())


def test_duplicate_enqueue_for_the_same_signal_id_is_idempotent():
    async def go():
        await _cleanup()
        from unittest.mock import patch
        with patch.object(oe, "_db", return_value=srv.db):
            first_id = await oe.enqueue_if_actionable(_signal_doc(signal_id="sig-dup"))
            second_id = await oe.enqueue_if_actionable(_signal_doc(signal_id="sig-dup"))
        assert first_id == second_id
        rows = await srv.db.cloud_bot_commands.find({"outlook_signal_id": "sig-dup"}, {"_id": 0}).to_list(10)
        assert len(rows) == 1  # never a second command for the same signal
        await _cleanup()
    _run(go())


def test_same_signal_id_different_account_queues_separately():
    """dedupe_key is account-scoped -- the same signal_id (which should
    never collide across accounts in practice, but proves the key shape)
    for a different account is a genuinely different command."""
    async def go():
        await _cleanup()
        from unittest.mock import patch
        with patch.object(oe, "_db", return_value=srv.db):
            id_a = await oe.enqueue_if_actionable(_signal_doc(signal_id="sig-x", account="ACC-A"))
            id_b = await oe.enqueue_if_actionable(_signal_doc(signal_id="sig-x", account="ACC-B"))
        assert id_a != id_b
        rows = await srv.db.cloud_bot_commands.find({"outlook_signal_id": "sig-x"}, {"_id": 0}).to_list(10)
        assert len(rows) == 2
        await _cleanup()
    _run(go())


@pytest.mark.parametrize("direction", ["NEUTRAL", "RANGE", "TRANSITION", "BLOCKED", "NO_VALID_OUTLOOK", None])
def test_non_actionable_direction_never_queues_a_command(direction):
    async def go():
        await _cleanup()
        from unittest.mock import patch
        with patch.object(oe, "_db", return_value=srv.db):
            result = await oe.enqueue_if_actionable(_signal_doc(signal_id="sig-na", direction=direction))
        assert result is None
        rows = await srv.db.cloud_bot_commands.find({"outlook_signal_id": "sig-na"}, {"_id": 0}).to_list(10)
        assert len(rows) == 0
        await _cleanup()
    _run(go())


def test_missing_account_or_signal_id_never_queues_a_command():
    async def go():
        await _cleanup()
        from unittest.mock import patch
        with patch.object(oe, "_db", return_value=srv.db):
            assert await oe.enqueue_if_actionable({"id": "sig-noacct", "account": "", "primary_direction": "BUY"}) is None
            assert await oe.enqueue_if_actionable({"id": "", "account": ACCOUNT, "primary_direction": "BUY"}) is None
        rows = await srv.db.cloud_bot_commands.find({}, {"_id": 0}).to_list(10)
        assert len(rows) == 0
        await _cleanup()
    _run(go())


def test_none_doc_never_queues_a_command():
    async def go():
        await _cleanup()
        from unittest.mock import patch
        with patch.object(oe, "_db", return_value=srv.db):
            assert await oe.enqueue_if_actionable(None) is None
        rows = await srv.db.cloud_bot_commands.find({}, {"_id": 0}).to_list(10)
        assert len(rows) == 0
        await _cleanup()
    _run(go())


def test_server_orchestration_calls_enqueue_after_hourly_generation_tick():
    """hourly_generation_tick returns (published_count, actionable_docs);
    server.py's _outlook_hourly_loop must call
    outlook_execution.enqueue_if_actionable on each returned doc -- this is
    the wiring that makes market_outlook.py's own strict separation (it
    never touches cloud_bot_commands itself) still result in genuine
    execution, via server.py's orchestration layer instead."""
    import inspect
    src = inspect.getsource(srv)
    loop_src = src[src.index("async def _outlook_hourly_loop"):]
    loop_src = loop_src[:loop_src.index("\n    async def", 1) if "\n    async def" in loop_src[1:] else len(loop_src)]
    assert "published, actionable_docs = await _mo.hourly_generation_tick()" in loop_src
    assert "_oe.enqueue_if_actionable(_doc)" in loop_src


def test_server_orchestration_calls_enqueue_after_m10_and_hourly_tick_in_activity_handler():
    import inspect
    src = inspect.getsource(srv)
    activity = src[src.index("async def cloud_monitor_activity"):]
    activity = activity[:activity.index("# v6.25.1 owner directive", 1)]
    assert "m10_doc = await _mo.publish_m10_signal_from_activity(" in activity
    assert "_oe.enqueue_if_actionable(m10_doc)" in activity
    assert '_hourly_published, _hourly_actionable = await _mo.hourly_generation_tick(account=req.account or "")' in activity
    assert "_oe.enqueue_if_actionable(_hdoc)" in activity
