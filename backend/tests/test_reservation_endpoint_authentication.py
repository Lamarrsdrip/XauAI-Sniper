"""Real, executable tests for the v6.25.2 owner-directive security fix:
/api/cloud/reservation/claim and /release now require a valid, active,
correctly account-bound license PIN via the existing canonical
_resolve_monitor_license() helper, instead of accepting any caller who
merely knew a real broker_server+account+symbol (not secret -- it appears
in Command Center URLs and log lines).

Calls the real endpoint functions directly (not over HTTP) against a live
local MongoDB in an isolated database, exercising the actual production
code path in server.py. Skips cleanly if no local MongoDB is reachable.
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


pytestmark = pytest.mark.skipif(not _mongo_available(), reason="no local MongoDB reachable for this live reservation-auth test")

TEST_DB = f"reservation_auth_pytest_{uuid.uuid4().hex[:10]}"
os.environ["MONGO_URL"] = "mongodb://localhost:27017"
os.environ["DB_NAME"] = TEST_DB
os.environ.setdefault("JWT_SECRET", "test-secret-reservation-auth")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")

import server as srv  # noqa: E402
from fastapi import HTTPException  # noqa: E402


_LOOP = asyncio.new_event_loop()


def _run(coro):
    # motor's AsyncIOMotorClient (srv.client, created once at module import)
    # binds its connection pool to whichever event loop is running the
    # first time it's used. asyncio.run() creates and CLOSES a fresh loop
    # every call, which breaks that pool on the second test ("Event loop is
    # closed"). Reuse one shared loop for every test in this module instead.
    return _LOOP.run_until_complete(coro)


async def _seed_license(pin: str, account: str, active: bool = True) -> dict:
    doc = {"id": str(uuid.uuid4()), "pin": pin, "mt5_account": account, "is_active": active,
           "is_used": True, "buyer_email": "test@example.com"}
    await srv.db.pin_licenses.insert_one(doc)
    return doc


async def _cleanup():
    await srv.db.cloud_direction_reservations.delete_many({})
    await srv.db.pin_licenses.delete_many({})


def test_valid_license_and_account_can_claim():
    async def go():
        await _cleanup()
        await _seed_license("VALID-PIN-1", "1000001")
        req = srv.DirectionReservationClaimReq(
            pin="VALID-PIN-1", broker_server="Exness-MT5Trial9", account="1000001",
            symbol="XAUUSD", direction=1, requesting_family="NORMAL", terminal_identity="mac")
        result = await srv.cloud_reservation_claim(req, None)
        assert result["claimed"] is True
        assert result["reservationId"]
        await _cleanup()
    _run(go())


def test_invalid_pin_rejected():
    async def go():
        await _cleanup()
        req = srv.DirectionReservationClaimReq(
            pin="NO-SUCH-PIN", broker_server="Exness-MT5Trial9", account="1000001",
            symbol="XAUUSD", direction=1, requesting_family="NORMAL", terminal_identity="mac")
        with pytest.raises(HTTPException) as exc:
            await srv.cloud_reservation_claim(req, None)
        assert exc.value.status_code == 403
        assert exc.value.detail["reason"] == "INVALID_OR_INACTIVE_LICENSE_PIN"
        await _cleanup()
    _run(go())


def test_inactive_license_rejected():
    async def go():
        await _cleanup()
        await _seed_license("INACTIVE-PIN", "1000001", active=False)
        req = srv.DirectionReservationClaimReq(
            pin="INACTIVE-PIN", broker_server="Exness-MT5Trial9", account="1000001",
            symbol="XAUUSD", direction=1, requesting_family="NORMAL", terminal_identity="mac")
        with pytest.raises(HTTPException) as exc:
            await srv.cloud_reservation_claim(req, None)
        assert exc.value.status_code == 403
        assert exc.value.detail["reason"] == "INVALID_OR_INACTIVE_LICENSE_PIN"
        await _cleanup()
    _run(go())


def test_account_mismatch_rejected():
    async def go():
        await _cleanup()
        await _seed_license("BOUND-PIN", "1000001")
        req = srv.DirectionReservationClaimReq(
            pin="BOUND-PIN", broker_server="Exness-MT5Trial9", account="9999999",
            symbol="XAUUSD", direction=1, requesting_family="NORMAL", terminal_identity="mac")
        with pytest.raises(HTTPException) as exc:
            await srv.cloud_reservation_claim(req, None)
        assert exc.value.status_code == 403
        assert exc.value.detail["reason"] == "LICENSE_BOUND_TO_DIFFERENT_MT5_ACCOUNT"
        await _cleanup()
    _run(go())


def test_missing_credentials_rejected():
    async def go():
        await _cleanup()
        req = srv.DirectionReservationClaimReq(
            pin="", broker_server="Exness-MT5Trial9", account="1000001",
            symbol="XAUUSD", direction=1, requesting_family="NORMAL", terminal_identity="mac")
        with pytest.raises(HTTPException) as exc:
            await srv.cloud_reservation_claim(req, None)
        assert exc.value.status_code == 403
        await _cleanup()
    _run(go())


def test_invalid_symbol_rejected():
    async def go():
        await _cleanup()
        await _seed_license("VALID-PIN-SYM", "1000001")
        req = srv.DirectionReservationClaimReq(
            pin="VALID-PIN-SYM", broker_server="Exness-MT5Trial9", account="1000001",
            symbol="NOTGOLD", direction=1, requesting_family="NORMAL", terminal_identity="mac")
        with pytest.raises(HTTPException) as exc:
            await srv.cloud_reservation_claim(req, None)
        assert exc.value.status_code == 400
        await _cleanup()
    _run(go())


def test_owner_can_release_own_reservation():
    async def go():
        await _cleanup()
        await _seed_license("OWNER-PIN", "1000002")
        claim_req = srv.DirectionReservationClaimReq(
            pin="OWNER-PIN", broker_server="Exness-MT5Trial9", account="1000002",
            symbol="XAUUSD", direction=1, requesting_family="NORMAL", terminal_identity="mac")
        claimed = await srv.cloud_reservation_claim(claim_req, None)
        assert claimed["claimed"] is True
        release_req = srv.DirectionReservationReleaseReq(
            pin="OWNER-PIN", broker_server="Exness-MT5Trial9", account="1000002",
            symbol="XAUUSD", reservation_id=claimed["reservationId"])
        released = await srv.cloud_reservation_release(release_req, None)
        assert released["released"] is True
        await _cleanup()
    _run(go())


def test_foreign_license_cannot_release_another_licenses_reservation():
    """The exact vulnerability this fix closes: knowing a real reservationId
    (not secret) must not be enough to release someone else's reservation."""
    async def go():
        await _cleanup()
        await _seed_license("OWNER-PIN-2", "1000003")
        await _seed_license("ATTACKER-PIN", "1000004")
        claim_req = srv.DirectionReservationClaimReq(
            pin="OWNER-PIN-2", broker_server="Exness-MT5Trial9", account="1000003",
            symbol="XAUUSD", direction=1, requesting_family="NORMAL", terminal_identity="mac")
        claimed = await srv.cloud_reservation_claim(claim_req, None)
        assert claimed["claimed"] is True

        # Attacker has a VALID, active, correctly-bound license of their OWN
        # (account 1000004) but tries to release the victim's reservation
        # (account 1000003's key) using the observed reservationId.
        attacker_release_req = srv.DirectionReservationReleaseReq(
            pin="ATTACKER-PIN", broker_server="Exness-MT5Trial9", account="1000003",
            symbol="XAUUSD", reservation_id=claimed["reservationId"])
        # The attacker's PIN is bound to account 1000004, not 1000003 --
        # _resolve_monitor_license itself rejects this account mismatch.
        with pytest.raises(HTTPException) as exc:
            await srv.cloud_reservation_release(attacker_release_req, None)
        assert exc.value.status_code == 403

        # Reservation must still be intact -- released by nobody.
        still_there = await srv.db.cloud_direction_reservations.find_one(
            {"reservationId": claimed["reservationId"]})
        assert still_there is not None
        await _cleanup()
    _run(go())


def test_foreign_license_with_own_matching_account_still_cannot_release_someone_elses_key():
    """A subtler case: an attacker with a valid license bound to the SAME
    account string (e.g. a shared/guessed account number) but a DIFFERENT
    license identity must not be able to release a reservation claimed by
    a different license -- ownership is tracked by licenseId, not just
    account string match."""
    async def go():
        await _cleanup()
        await _seed_license("OWNER-PIN-3", "1000005")
        claim_req = srv.DirectionReservationClaimReq(
            pin="OWNER-PIN-3", broker_server="Exness-MT5Trial9", account="1000005",
            symbol="XAUUSD", direction=1, requesting_family="NORMAL", terminal_identity="mac")
        claimed = await srv.cloud_reservation_claim(claim_req, None)
        assert claimed["claimed"] is True

        # A second, DIFFERENT license also happens to bind to the same
        # account number (e.g. re-issued/duplicate license scenario).
        await _seed_license("OTHER-PIN-SAME-ACCOUNT", "1000005")
        other_release_req = srv.DirectionReservationReleaseReq(
            pin="OTHER-PIN-SAME-ACCOUNT", broker_server="Exness-MT5Trial9", account="1000005",
            symbol="XAUUSD", reservation_id=claimed["reservationId"])
        result = await srv.cloud_reservation_release(other_release_req, None)
        # Passes auth (same account), but must NOT release -- licenseId differs.
        assert result["released"] is False

        still_there = await srv.db.cloud_direction_reservations.find_one(
            {"reservationId": claimed["reservationId"]})
        assert still_there is not None
        await _cleanup()
    _run(go())


def test_expired_reservation_can_be_reclaimed_by_a_different_valid_license():
    async def go():
        await _cleanup()
        await srv.db.cloud_direction_reservations.insert_one({
            "_id": srv._reservation_key("Exness-MT5Trial9", "1000006", "XAUUSD"),
            "direction": 1, "requestingFamily": "NORMAL", "reservationId": "old-expired-id",
            "createdAt": "2020-01-01T00:00:00+00:00", "expiresAt": "2020-01-01T00:00:30+00:00",
            "terminalIdentity": "old", "brokerServer": "Exness-MT5Trial9", "account": "1000006",
            "symbol": "XAUUSD", "licenseId": "old-license",
        })
        await _seed_license("NEW-PIN", "1000006")
        claim_req = srv.DirectionReservationClaimReq(
            pin="NEW-PIN", broker_server="Exness-MT5Trial9", account="1000006",
            symbol="XAUUSD", direction=-1, requesting_family="NORMAL", terminal_identity="vps")
        result = await srv.cloud_reservation_claim(claim_req, None)
        assert result["claimed"] is True
        await _cleanup()
    _run(go())
