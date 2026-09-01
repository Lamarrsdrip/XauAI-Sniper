"""Real, executable tests for the v6.25.6 owner-directive fix (XAU-027,
Codex handover "NEXT TASK FOR CLAUDE"): tenant-scoped remote-command
idempotency plus an immutable terminal-state machine for acknowledgements.

Calls the real endpoint functions directly (not over HTTP) against a live
local MongoDB in an isolated database, exercising the actual production
code path in server.py -- same convention as
test_reservation_endpoint_authentication.py. Skips cleanly if no local
MongoDB is reachable.
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


pytestmark = pytest.mark.skipif(not _mongo_available(), reason="no local MongoDB reachable for this live command-idempotency test")

TEST_DB = f"command_idempotency_pytest_{uuid.uuid4().hex[:10]}"
os.environ["MONGO_URL"] = "mongodb://localhost:27017"
os.environ["DB_NAME"] = TEST_DB
os.environ.setdefault("JWT_SECRET", "test-secret-command-idempotency")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")

import server as srv  # noqa: E402
from fastapi import HTTPException  # noqa: E402

_LOOP = asyncio.new_event_loop()


def _run(coro):
    return _LOOP.run_until_complete(coro)


async def _cleanup():
    await srv.db.cloud_bot_commands.delete_many({})
    await srv.db.pin_licenses.delete_many({})
    await srv.db.cloud_users.delete_many({})
    try:
        await srv.db.cloud_bot_commands.create_index("dedupe_key", unique=True, sparse=True)
    except Exception:
        pass


async def _seed_user_and_license(email: str, pin: str, account: str = "1000001") -> dict:
    user = {"id": str(uuid.uuid4()), "email": email, "license_key": pin, "command_license_key": pin}
    await srv.db.cloud_users.insert_one(user.copy())
    await srv.db.pin_licenses.insert_one({
        "id": str(uuid.uuid4()), "pin": pin, "mt5_account": account,
        "is_active": True, "is_used": True, "buyer_email": email,
    })
    return user


def test_valid_authenticated_command_creation():
    async def go():
        await _cleanup()
        user = await _seed_user_and_license("owner1@test.com", "ASE-TEST-0001")
        req = srv.CloudCommandReq(action="PAUSE_NEW_TRADES", pin="ASE-TEST-0001", confirm=True,
                                   idempotency_key="dialog-open-1")
        result = await srv.cloud_command_request(req, user)
        assert result["ok"] is True
        assert result["status"] == "PENDING"
        assert result["duplicate"] is False
        stored = await srv.db.cloud_bot_commands.find_one({"id": result["command_id"]})
        assert stored is not None
        assert stored["dedupe_key"] == f"{user['id']}:PAUSE_NEW_TRADES:dialog-open-1"
        await _cleanup()
    _run(go())


def test_same_idempotency_key_submitted_twice_creates_one_command():
    async def go():
        await _cleanup()
        user = await _seed_user_and_license("owner2@test.com", "ASE-TEST-0002")
        req = srv.CloudCommandReq(action="STOP_TRADING", pin="ASE-TEST-0002", confirm=True,
                                   idempotency_key="same-key-retry")
        first = await srv.cloud_command_request(req, user)
        second = await srv.cloud_command_request(req, user)
        assert first["command_id"] == second["command_id"]
        assert first["duplicate"] is False
        assert second["duplicate"] is True
        count = await srv.db.cloud_bot_commands.count_documents({"user_id": user["id"], "action": "STOP_TRADING"})
        assert count == 1
        await _cleanup()
    _run(go())


def test_concurrent_identical_requests_create_one_command():
    async def go():
        await _cleanup()
        user = await _seed_user_and_license("owner3@test.com", "ASE-TEST-0003")
        req = srv.CloudCommandReq(action="RESUME_TRADING", pin="ASE-TEST-0003", confirm=True,
                                   idempotency_key="concurrent-key")
        results = await asyncio.gather(
            srv.cloud_command_request(req, user),
            srv.cloud_command_request(req, user),
            srv.cloud_command_request(req, user),
        )
        command_ids = {r["command_id"] for r in results}
        assert len(command_ids) == 1
        duplicate_flags = sorted(r["duplicate"] for r in results)
        assert duplicate_flags == [False, True, True]
        count = await srv.db.cloud_bot_commands.count_documents({"user_id": user["id"], "action": "RESUME_TRADING"})
        assert count == 1
        await _cleanup()
    _run(go())


def test_different_idempotency_keys_create_separate_commands():
    async def go():
        await _cleanup()
        user = await _seed_user_and_license("owner4@test.com", "ASE-TEST-0004")
        req1 = srv.CloudCommandReq(action="PAUSE_NEW_TRADES", pin="ASE-TEST-0004", confirm=True, idempotency_key="key-a")
        req2 = srv.CloudCommandReq(action="PAUSE_NEW_TRADES", pin="ASE-TEST-0004", confirm=True, idempotency_key="key-b")
        r1 = await srv.cloud_command_request(req1, user)
        r2 = await srv.cloud_command_request(req2, user)
        assert r1["command_id"] != r2["command_id"]
        assert r1["duplicate"] is False and r2["duplicate"] is False
        await _cleanup()
    _run(go())


def test_omitted_idempotency_key_does_not_error_and_still_creates_command():
    async def go():
        await _cleanup()
        user = await _seed_user_and_license("owner5@test.com", "ASE-TEST-0005")
        req = srv.CloudCommandReq(action="PAUSE_NEW_TRADES", pin="ASE-TEST-0005", confirm=True)
        result = await srv.cloud_command_request(req, user)
        assert result["ok"] is True
        assert result["duplicate"] is False
        await _cleanup()
    _run(go())


def test_pending_to_acked_to_executed_valid_chain():
    async def go():
        await _cleanup()
        user = await _seed_user_and_license("owner6@test.com", "ASE-TEST-0006")
        req = srv.CloudCommandReq(action="FORCE_SYNC", pin="ASE-TEST-0006", confirm=True, idempotency_key="chain-1")
        created = await srv.cloud_command_request(req, user)
        cid = created["command_id"]

        acked = await srv.cloud_command_ack(
            srv.CloudCommandAckReq(command_id=cid, status="ACKED", pin="ASE-TEST-0006", account="1000001"), None)
        assert acked["applied"] is True and acked["status"] == "ACKED"

        executed = await srv.cloud_command_ack(
            srv.CloudCommandAckReq(command_id=cid, status="EXECUTED", pin="ASE-TEST-0006", account="1000001"), None)
        assert executed["applied"] is True and executed["status"] == "EXECUTED"

        stored = await srv.db.cloud_bot_commands.find_one({"id": cid})
        assert stored["status"] == "EXECUTED"
        await _cleanup()
    _run(go())


def test_pending_to_acked_to_failed_valid_chain():
    async def go():
        await _cleanup()
        user = await _seed_user_and_license("owner7@test.com", "ASE-TEST-0007")
        req = srv.CloudCommandReq(action="FORCE_SYNC", pin="ASE-TEST-0007", confirm=True, idempotency_key="chain-2")
        created = await srv.cloud_command_request(req, user)
        cid = created["command_id"]
        await srv.cloud_command_ack(srv.CloudCommandAckReq(command_id=cid, status="ACKED", pin="ASE-TEST-0007", account="1000001"), None)
        failed = await srv.cloud_command_ack(srv.CloudCommandAckReq(command_id=cid, status="FAILED", pin="ASE-TEST-0007", account="1000001"), None)
        assert failed["applied"] is True and failed["status"] == "FAILED"
        await _cleanup()
    _run(go())


def test_pending_to_acked_to_skipped_valid_chain():
    async def go():
        await _cleanup()
        user = await _seed_user_and_license("owner8@test.com", "ASE-TEST-0008")
        req = srv.CloudCommandReq(action="FORCE_SYNC", pin="ASE-TEST-0008", confirm=True, idempotency_key="chain-3")
        created = await srv.cloud_command_request(req, user)
        cid = created["command_id"]
        await srv.cloud_command_ack(srv.CloudCommandAckReq(command_id=cid, status="ACKED", pin="ASE-TEST-0008", account="1000001"), None)
        skipped = await srv.cloud_command_ack(srv.CloudCommandAckReq(command_id=cid, status="SKIPPED", pin="ASE-TEST-0008", account="1000001"), None)
        assert skipped["applied"] is True and skipped["status"] == "SKIPPED"
        await _cleanup()
    _run(go())


def test_direct_pending_to_executed_transition_permitted():
    """The EA may legitimately report a terminal result in one request
    (e.g. immediate EXECUTED for a fast synchronous action) without a
    separate ACKED step first -- this is a documented direct transition,
    not a bug."""
    async def go():
        await _cleanup()
        user = await _seed_user_and_license("owner9@test.com", "ASE-TEST-0009")
        req = srv.CloudCommandReq(action="FORCE_SYNC", pin="ASE-TEST-0009", confirm=True, idempotency_key="direct-1")
        created = await srv.cloud_command_request(req, user)
        cid = created["command_id"]
        executed = await srv.cloud_command_ack(
            srv.CloudCommandAckReq(command_id=cid, status="EXECUTED", pin="ASE-TEST-0009", account="1000001"), None)
        assert executed["applied"] is True and executed["status"] == "EXECUTED"
        await _cleanup()
    _run(go())


def test_pending_expiry_occurs_and_expired_command_cannot_later_become_acked():
    async def go():
        from datetime import datetime, timezone, timedelta
        await _cleanup()
        user = await _seed_user_and_license("owner10@test.com", "ASE-TEST-0010")
        req = srv.CloudCommandReq(action="FORCE_SYNC", pin="ASE-TEST-0010", confirm=True,
                                   idempotency_key="expiry-1")
        created = await srv.cloud_command_request(req, user)
        cid = created["command_id"]

        # Force the command to look old enough to expire (FORCE_SYNC
        # expires after 30 minutes per REMOTE_COMMAND_EXPIRY_MINUTES).
        stale = (datetime.now(timezone.utc) - timedelta(minutes=35)).isoformat()
        await srv.db.cloud_bot_commands.update_one({"id": cid}, {"$set": {"requested_at": stale}})

        expired_count = await srv._expire_stale_pending_commands()
        assert expired_count >= 1
        stored = await srv.db.cloud_bot_commands.find_one({"id": cid})
        assert stored["status"] == "EXPIRED"

        # A late ACK must not resurrect an expired command.
        late_ack = await srv.cloud_command_ack(
            srv.CloudCommandAckReq(command_id=cid, status="ACKED", pin="ASE-TEST-0010", account="1000001"), None)
        assert late_ack["applied"] is False
        assert late_ack["status"] == "EXPIRED"
        assert late_ack["reason"] == "TERMINAL_STATE_IMMUTABLE"
        stored_after = await srv.db.cloud_bot_commands.find_one({"id": cid})
        assert stored_after["status"] == "EXPIRED"
        await _cleanup()
    _run(go())


def test_executed_command_cannot_be_overwritten_by_late_acked():
    async def go():
        await _cleanup()
        user = await _seed_user_and_license("owner11@test.com", "ASE-TEST-0011")
        req = srv.CloudCommandReq(action="FORCE_SYNC", pin="ASE-TEST-0011", confirm=True, idempotency_key="overwrite-1")
        created = await srv.cloud_command_request(req, user)
        cid = created["command_id"]
        await srv.cloud_command_ack(srv.CloudCommandAckReq(command_id=cid, status="EXECUTED", pin="ASE-TEST-0011", account="1000001"), None)

        late = await srv.cloud_command_ack(srv.CloudCommandAckReq(command_id=cid, status="ACKED", pin="ASE-TEST-0011", account="1000001"), None)
        assert late["applied"] is False
        assert late["status"] == "EXECUTED"
        assert late["reason"] == "TERMINAL_STATE_IMMUTABLE"
        stored = await srv.db.cloud_bot_commands.find_one({"id": cid})
        assert stored["status"] == "EXECUTED"
        await _cleanup()
    _run(go())


def test_failed_command_cannot_be_overwritten_by_executed():
    async def go():
        await _cleanup()
        user = await _seed_user_and_license("owner12@test.com", "ASE-TEST-0012")
        req = srv.CloudCommandReq(action="FORCE_SYNC", pin="ASE-TEST-0012", confirm=True, idempotency_key="overwrite-2")
        created = await srv.cloud_command_request(req, user)
        cid = created["command_id"]
        await srv.cloud_command_ack(srv.CloudCommandAckReq(command_id=cid, status="FAILED", pin="ASE-TEST-0012", account="1000001"), None)

        late = await srv.cloud_command_ack(srv.CloudCommandAckReq(command_id=cid, status="EXECUTED", pin="ASE-TEST-0012", account="1000001"), None)
        assert late["applied"] is False
        assert late["status"] == "FAILED"
        stored = await srv.db.cloud_bot_commands.find_one({"id": cid})
        assert stored["status"] == "FAILED"
        await _cleanup()
    _run(go())


def test_two_competing_acknowledgements_produce_one_valid_terminal_winner():
    """Two 'terminals' (e.g. Mac + VPS both racing to ack the same
    command) attempt PENDING->EXECUTED concurrently. Exactly one must win;
    the other must see the real post-transition status, never silently
    re-apply its own."""
    async def go():
        await _cleanup()
        user = await _seed_user_and_license("owner13@test.com", "ASE-TEST-0013")
        req = srv.CloudCommandReq(action="FORCE_SYNC", pin="ASE-TEST-0013", confirm=True, idempotency_key="race-1")
        created = await srv.cloud_command_request(req, user)
        cid = created["command_id"]

        results = await asyncio.gather(
            srv.cloud_command_ack(srv.CloudCommandAckReq(command_id=cid, status="EXECUTED", pin="ASE-TEST-0013", account="1000001", message="mac"), None),
            srv.cloud_command_ack(srv.CloudCommandAckReq(command_id=cid, status="FAILED", pin="ASE-TEST-0013", account="1000001", message="vps"), None),
        )
        applied_flags = [r["applied"] for r in results]
        assert applied_flags.count(True) == 1
        assert applied_flags.count(False) == 1
        stored = await srv.db.cloud_bot_commands.find_one({"id": cid})
        assert stored["status"] in {"EXECUTED", "FAILED"}
        # whichever one actually won, the loser's response must report that
        # same real final status, not its own requested status
        loser = results[applied_flags.index(False)]
        assert loser["status"] == stored["status"]
        await _cleanup()
    _run(go())


def test_duplicate_terminal_acknowledgement_is_idempotent():
    async def go():
        await _cleanup()
        user = await _seed_user_and_license("owner14@test.com", "ASE-TEST-0014")
        req = srv.CloudCommandReq(action="FORCE_SYNC", pin="ASE-TEST-0014", confirm=True, idempotency_key="dup-ack-1")
        created = await srv.cloud_command_request(req, user)
        cid = created["command_id"]
        first = await srv.cloud_command_ack(srv.CloudCommandAckReq(command_id=cid, status="EXECUTED", pin="ASE-TEST-0014", account="1000001"), None)
        second = await srv.cloud_command_ack(srv.CloudCommandAckReq(command_id=cid, status="EXECUTED", pin="ASE-TEST-0014", account="1000001"), None)
        assert first["applied"] is True
        assert second["applied"] is False
        assert second["status"] == "EXECUTED"
        await _cleanup()
    _run(go())


def test_cross_license_ack_rejected():
    async def go():
        await _cleanup()
        user = await _seed_user_and_license("owner15@test.com", "ASE-TEST-0015")
        req = srv.CloudCommandReq(action="FORCE_SYNC", pin="ASE-TEST-0015", confirm=True, idempotency_key="cross-1")
        created = await srv.cloud_command_request(req, user)
        cid = created["command_id"]
        # A different, genuinely active license attempting to ack someone
        # else's command.
        await srv.db.pin_licenses.insert_one({
            "id": str(uuid.uuid4()), "pin": "ASE-OTHER-9999", "mt5_account": "2000002",
            "is_active": True, "is_used": True, "buyer_email": "attacker@test.com",
        })
        with pytest.raises(HTTPException) as exc:
            await srv.cloud_command_ack(
                srv.CloudCommandAckReq(command_id=cid, status="EXECUTED", pin="ASE-OTHER-9999", account="2000002"), None)
        assert exc.value.status_code == 403
        stored = await srv.db.cloud_bot_commands.find_one({"id": cid})
        assert stored["status"] == "PENDING"
        await _cleanup()
    _run(go())


def test_recent_history_shows_only_own_commands():
    async def go():
        await _cleanup()
        user_a = await _seed_user_and_license("owner16a@test.com", "ASE-TEST-0016")
        user_b = await _seed_user_and_license("owner16b@test.com", "ASE-TEST-0017", account="2000002")
        await srv.cloud_command_request(
            srv.CloudCommandReq(action="FORCE_SYNC", pin="ASE-TEST-0016", confirm=True, idempotency_key="hist-a"), user_a)
        await srv.cloud_command_request(
            srv.CloudCommandReq(action="FORCE_SYNC", pin="ASE-TEST-0017", confirm=True, idempotency_key="hist-b"), user_b)
        recent_a = await srv.cloud_command_recent(limit=20, user=user_a)
        assert recent_a["count"] == 1
        assert all(c["user_id"] == user_a["id"] for c in recent_a["commands"])
        await _cleanup()
    _run(go())
