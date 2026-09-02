"""Tests for the Outlook+Aurum Unified Coordination fix (2026-09-03):
every genuine, fresh, owner-policy-approved Market Outlook signal now
publishes passive OUTLOOK_THESIS context via
outlook_execution.publish_outlook_thesis() (enqueue_if_actionable is kept
as a back-compat alias for existing callers) -- it never enqueues an
OUTLOOK_SIGNAL_OPEN execution command anymore. See outlook_execution.py's
own module docstring for the full root-cause writeup, and
backend_node/src/services/outlookExecution.ts for the matching (and
earlier) Node-side fix this file mirrors.

publish_outlook_thesis()/enqueue_if_actionable() deliberately live in
their own module, never inside market_outlook.py -- see
outlook_execution.py's own docstring and market_outlook.py's STRICT
SEPARATION docstring/tests (test_no_trade_execution_calls_anywhere_in_outlook_module
/ test_outlook_module_only_writes_its_own_collections /
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
    await srv.db.cloud_outlook_thesis.delete_many({})
    try:
        await srv.db.cloud_bot_commands.create_index("dedupe_key", unique=True, sparse=True)
    except Exception:
        pass


def _signal_doc(signal_id="sig-1", direction="BUY", account=ACCOUNT, license_key="LIC-1", **overrides):
    doc = {
        "id": signal_id, "account": account, "license_key": license_key,
        "primary_direction": direction,
        "generated_at": "2026-09-03T10:00:00+00:00",
        "preferred_entry_zone_low": 3610.0,
        "preferred_entry_zone_high": 3612.0,
        "suggested_sl": 3600.0,
        "chase_limit": 3620.0,
        "confidence_pct": 62,
        "market_regime": "TRENDING",
        "setup_type": "CONTINUATION",
    }
    doc.update(overrides)
    return doc


def test_actionable_signal_never_queues_a_cloud_bot_commands_row():
    async def go():
        await _cleanup()
        from unittest.mock import patch
        with patch.object(oe, "_db", return_value=srv.db):
            thesis_id = await oe.publish_outlook_thesis(_signal_doc())
        assert thesis_id
        commands = await srv.db.cloud_bot_commands.find({}, {"_id": 0}).to_list(10)
        assert len(commands) == 0
        await _cleanup()
    _run(go())


def test_actionable_signal_publishes_exactly_one_active_thesis_row():
    async def go():
        await _cleanup()
        from unittest.mock import patch
        with patch.object(oe, "_db", return_value=srv.db):
            await oe.publish_outlook_thesis(_signal_doc())
        rows = await srv.db.cloud_outlook_thesis.find({"outlook_id": "sig-1"}, {"_id": 0}).to_list(10)
        assert len(rows) == 1
        thesis = rows[0]
        assert thesis["direction"] == "BUY"
        assert thesis["status"] == "ACTIVE"
        assert thesis["account"] == ACCOUNT
        assert thesis["reference_price"] == pytest.approx(3611.0, abs=0.01)
        assert thesis["confidence"] == 62
        assert thesis["regime"] == "TRENDING"
        assert thesis["setup_type"] == "CONTINUATION"
        assert thesis["chase_limit"] == 3620.0
        # suggested_sl passed through as computed by market_outlook.py's own
        # owner-policy-approved zone construction, not re-derived here.
        assert thesis["suggested_sl"] == 3600.0
        await _cleanup()
    _run(go())


def test_duplicate_publish_for_the_same_signal_id_is_idempotent():
    async def go():
        await _cleanup()
        from unittest.mock import patch
        with patch.object(oe, "_db", return_value=srv.db):
            first_id = await oe.publish_outlook_thesis(_signal_doc(signal_id="sig-dup"))
            second_id = await oe.publish_outlook_thesis(_signal_doc(signal_id="sig-dup"))
        rows = await srv.db.cloud_outlook_thesis.find({"outlook_id": "sig-dup"}, {"_id": 0}).to_list(10)
        assert len(rows) == 1  # upsert on (account, symbol, outlook_id), never a duplicate row
        assert first_id and second_id
        await _cleanup()
    _run(go())


def test_a_fresh_thesis_supersedes_the_prior_active_one_for_the_same_account():
    async def go():
        await _cleanup()
        from unittest.mock import patch
        with patch.object(oe, "_db", return_value=srv.db):
            await oe.publish_outlook_thesis(_signal_doc(signal_id="sig-first"))
            await oe.publish_outlook_thesis(_signal_doc(signal_id="sig-second", generated_at="2026-09-03T11:00:00+00:00"))
        rows = await srv.db.cloud_outlook_thesis.find({}, {"_id": 0}).to_list(10)
        assert len(rows) == 2
        by_id = {r["outlook_id"]: r for r in rows}
        assert by_id["sig-first"]["status"] == "SUPERSEDED"
        assert by_id["sig-second"]["status"] == "ACTIVE"
        await _cleanup()
    _run(go())


def test_same_signal_id_different_account_publishes_separately():
    async def go():
        await _cleanup()
        from unittest.mock import patch
        with patch.object(oe, "_db", return_value=srv.db):
            id_a = await oe.publish_outlook_thesis(_signal_doc(signal_id="sig-x", account="ACC-A"))
            id_b = await oe.publish_outlook_thesis(_signal_doc(signal_id="sig-x", account="ACC-B"))
        assert id_a != id_b
        rows = await srv.db.cloud_outlook_thesis.find({"outlook_id": "sig-x"}, {"_id": 0}).to_list(10)
        assert len(rows) == 2
        await _cleanup()
    _run(go())


@pytest.mark.parametrize("direction", ["NEUTRAL", "RANGE", "TRANSITION", "BLOCKED", "NO_VALID_OUTLOOK", None])
def test_non_actionable_direction_never_publishes_a_thesis(direction):
    async def go():
        await _cleanup()
        from unittest.mock import patch
        with patch.object(oe, "_db", return_value=srv.db):
            result = await oe.publish_outlook_thesis(_signal_doc(signal_id="sig-na", direction=direction))
        assert result is None
        rows = await srv.db.cloud_outlook_thesis.find({"outlook_id": "sig-na"}, {"_id": 0}).to_list(10)
        assert len(rows) == 0
        await _cleanup()
    _run(go())


def test_missing_account_or_signal_id_never_publishes_a_thesis():
    async def go():
        await _cleanup()
        from unittest.mock import patch
        with patch.object(oe, "_db", return_value=srv.db):
            assert await oe.publish_outlook_thesis(_signal_doc(account="", signal_id="sig-noacct")) is None
            assert await oe.publish_outlook_thesis(_signal_doc(signal_id="")) is None
        rows = await srv.db.cloud_outlook_thesis.find({}, {"_id": 0}).to_list(10)
        assert len(rows) == 0
        await _cleanup()
    _run(go())


def test_no_usable_entry_zone_never_publishes_a_thesis_no_fabrication():
    async def go():
        await _cleanup()
        from unittest.mock import patch
        with patch.object(oe, "_db", return_value=srv.db):
            result = await oe.publish_outlook_thesis(
                _signal_doc(signal_id="sig-nozone", preferred_entry_zone_low=0, preferred_entry_zone_high=0)
            )
        assert result is None
        rows = await srv.db.cloud_outlook_thesis.find({}, {"_id": 0}).to_list(10)
        assert len(rows) == 0
        await _cleanup()
    _run(go())


def test_none_doc_never_publishes_a_thesis():
    async def go():
        await _cleanup()
        from unittest.mock import patch
        with patch.object(oe, "_db", return_value=srv.db):
            assert await oe.publish_outlook_thesis(None) is None
        rows = await srv.db.cloud_outlook_thesis.find({}, {"_id": 0}).to_list(10)
        assert len(rows) == 0
        await _cleanup()
    _run(go())


def test_enqueue_if_actionable_alias_behaves_identically():
    """Back-compat alias used by server.py's existing call sites."""
    async def go():
        await _cleanup()
        from unittest.mock import patch
        with patch.object(oe, "_db", return_value=srv.db):
            thesis_id = await oe.enqueue_if_actionable(_signal_doc(signal_id="sig-alias"))
        assert thesis_id
        commands = await srv.db.cloud_bot_commands.find({}, {"_id": 0}).to_list(10)
        assert len(commands) == 0
        rows = await srv.db.cloud_outlook_thesis.find({"outlook_id": "sig-alias"}, {"_id": 0}).to_list(10)
        assert len(rows) == 1
        await _cleanup()
    _run(go())


def test_retire_stale_outlook_signal_open_commands_retires_a_pending_legacy_command():
    """TEST 9 (owner mission spec): a stale OUTLOOK_SIGNAL_OPEN command left
    over from the OLD code path must not unexpectedly trigger a live order
    after this deploy -- retired to SKIPPED so a still-connected EA never
    receives it."""
    async def go():
        await _cleanup()
        await srv.db.cloud_bot_commands.insert_one({
            "id": "cmd-legacy-1", "action": "OUTLOOK_SIGNAL_OPEN", "status": "PENDING",
            "payload": {"direction": "BUY", "signal_id": "old-signal"},
        })
        from unittest.mock import patch
        with patch.object(oe, "_db", return_value=srv.db):
            retired = await oe.retire_stale_outlook_signal_open_commands()
        assert retired == 1
        row = await srv.db.cloud_bot_commands.find_one({"id": "cmd-legacy-1"}, {"_id": 0})
        assert row["status"] == "SKIPPED"
        assert row["ack_status"] == "SKIPPED"
        assert "no longer an execution command" in row["ack_message"]
        await _cleanup()
    _run(go())


def test_retire_stale_outlook_signal_open_commands_leaves_terminal_states_alone():
    async def go():
        await _cleanup()
        await srv.db.cloud_bot_commands.insert_one({
            "id": "cmd-legacy-2", "action": "OUTLOOK_SIGNAL_OPEN", "status": "EXECUTED",
        })
        from unittest.mock import patch
        with patch.object(oe, "_db", return_value=srv.db):
            retired = await oe.retire_stale_outlook_signal_open_commands()
        assert retired == 0
        row = await srv.db.cloud_bot_commands.find_one({"id": "cmd-legacy-2"}, {"_id": 0})
        assert row["status"] == "EXECUTED"
        await _cleanup()
    _run(go())


def test_server_orchestration_calls_enqueue_after_hourly_generation_tick():
    """hourly_generation_tick returns (published_count, actionable_docs);
    server.py's _outlook_hourly_loop must call
    outlook_execution.enqueue_if_actionable on each returned doc -- this is
    the wiring that makes market_outlook.py's own strict separation (it
    never touches cloud_bot_commands/cloud_outlook_thesis itself) still
    result in genuine thesis publication, via server.py's orchestration
    layer instead."""
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
