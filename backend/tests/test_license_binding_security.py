"""Real, executable tests for the v6.25.3 Phase 4 (P0) license-binding fix
(final pre-launch hardening).

Root vulnerability fixed: POST /api/pins/validate bound mt5_account ONLY on
a PIN's very first call (is_used still false), then on every SUBSEQUENT
call for that same PIN returned {"valid": true} with NO account check at
all -- meaning a single purchased license could be validated successfully
on an unlimited number of different MT5 accounts after its first
activation. Fixed by routing /pins/validate through the same canonical,
atomic-first-claim, fail-closed _resolve_monitor_license() every other
EA-facing endpoint already used.

Also covers: concurrent first-binding race produces exactly one winner
(genuine asyncio.gather race, not a mocked one), and the new admin
license-account-reset endpoint requires the current admin password and
records an audit trail.

Uses a live local MongoDB in an isolated database (skips cleanly if none
reachable). Calls the real endpoint/helper functions directly.
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


pytestmark = pytest.mark.skipif(not _mongo_available(), reason="no local MongoDB reachable for this live license-binding test")

TEST_DB = f"license_binding_pytest_{uuid.uuid4().hex[:10]}"
os.environ["MONGO_URL"] = "mongodb://localhost:27017"
os.environ["DB_NAME"] = TEST_DB
os.environ.setdefault("JWT_SECRET", "test-secret-license-binding")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")

import server as srv  # noqa: E402
from fastapi import HTTPException  # noqa: E402

_LOOP = asyncio.new_event_loop()


def _run(coro):
    return _LOOP.run_until_complete(coro)


async def _clear():
    await srv.db.pin_licenses.delete_many({})
    await srv.db.license_reset_audit_log.delete_many({})
    await srv.db.cloud_direction_reservations.delete_many({})


async def _seed_unbound_license(pin="ASE-FRESH1"):
    doc = {"id": str(uuid.uuid4()), "pin": pin, "buyer_email": "buyer@example.com",
           "is_active": True, "is_used": False, "mt5_account": None}
    await srv.db.pin_licenses.insert_one(doc)
    return doc


def test_first_activation_binds_account():
    async def go():
        await _clear()
        await _seed_unbound_license("ASE-BIND1")
        result = await srv.validate_pin(srv.PinValidateRequest(pin="ASE-BIND1", mt5_account="1000001"))
        assert result["valid"] is True
        lic = await srv.db.pin_licenses.find_one({"pin": "ASE-BIND1"})
        assert lic["mt5_account"] == "1000001"
        assert lic["is_used"] is True
        await _clear()
    _run(go())


def test_second_call_same_account_still_valid():
    async def go():
        await _clear()
        await _seed_unbound_license("ASE-SAME1")
        await srv.validate_pin(srv.PinValidateRequest(pin="ASE-SAME1", mt5_account="1000001"))
        result = await srv.validate_pin(srv.PinValidateRequest(pin="ASE-SAME1", mt5_account="1000001"))
        assert result["valid"] is True
        await _clear()
    _run(go())


def test_reuse_on_different_account_after_activation_is_rejected():
    # THE exact vulnerability this fix closes: a PIN validated once on
    # account 1000001 must not validate successfully on a completely
    # different account 9999999 afterward.
    async def go():
        await _clear()
        await _seed_unbound_license("ASE-EXPLOIT1")
        first = await srv.validate_pin(srv.PinValidateRequest(pin="ASE-EXPLOIT1", mt5_account="1000001"))
        assert first["valid"] is True
        second = await srv.validate_pin(srv.PinValidateRequest(pin="ASE-EXPLOIT1", mt5_account="9999999"))
        assert second["valid"] is False
        assert "different mt5 account" in second["reason"].lower() or "bound" in second["reason"].lower()
        lic = await srv.db.pin_licenses.find_one({"pin": "ASE-EXPLOIT1"})
        assert lic["mt5_account"] == "1000001"  # unchanged, not overwritten by the attacker's account
        await _clear()
    _run(go())


def test_revoked_pin_rejected():
    async def go():
        await _clear()
        doc = await _seed_unbound_license("ASE-REVOKED2")
        await srv.db.pin_licenses.update_one({"pin": "ASE-REVOKED2"}, {"$set": {"is_active": False}})
        result = await srv.validate_pin(srv.PinValidateRequest(pin="ASE-REVOKED2", mt5_account="1000001"))
        assert result["valid"] is False
        await _clear()
    _run(go())


def test_unknown_pin_rejected():
    async def go():
        await _clear()
        result = await srv.validate_pin(srv.PinValidateRequest(pin="ASE-DOES-NOT-EXIST", mt5_account="1000001"))
        assert result["valid"] is False
        await _clear()
    _run(go())


def test_concurrent_first_binding_race_produces_exactly_one_winner():
    # Real concurrency proof, not a mock: two different accounts racing to
    # first-claim the same never-used PIN via asyncio.gather. Exactly one
    # must win; the other must see a real, non-corrupted rejection, and the
    # license record must end up bound to exactly one of the two accounts
    # (never a corrupted/partial state from a lost update).
    async def go():
        await _clear()
        await _seed_unbound_license("ASE-RACE1")
        results = await asyncio.gather(
            srv.validate_pin(srv.PinValidateRequest(pin="ASE-RACE1", mt5_account="1000001")),
            srv.validate_pin(srv.PinValidateRequest(pin="ASE-RACE1", mt5_account="2000002")),
            srv.validate_pin(srv.PinValidateRequest(pin="ASE-RACE1", mt5_account="3000003")),
        )
        valid_count = sum(1 for r in results if r["valid"])
        assert valid_count == 1  # exactly one account wins the first claim
        lic = await srv.db.pin_licenses.find_one({"pin": "ASE-RACE1"})
        assert lic["mt5_account"] in ("1000001", "2000002", "3000003")
        await _clear()
    _run(go())


def test_admin_reset_requires_correct_admin_password():
    async def go():
        await _clear()
        await _seed_unbound_license("ASE-RESETPW")
        await srv.validate_pin(srv.PinValidateRequest(pin="ASE-RESETPW", mt5_account="1000001"))
        admin = {"email": srv.ADMIN_EMAIL if hasattr(srv, "ADMIN_EMAIL") else "admin@test.com"}
        req = srv.AdminLicenseResetRequest(admin_password="totally-wrong-password", reason="testing")
        with pytest.raises(HTTPException) as exc:
            await srv.admin_reset_license_account("ASE-RESETPW", req, admin=admin)
        assert exc.value.status_code == 401
        lic = await srv.db.pin_licenses.find_one({"pin": "ASE-RESETPW"})
        assert lic["mt5_account"] == "1000001"  # unchanged
        await _clear()
    _run(go())


def test_admin_reset_requires_a_reason():
    async def go():
        await _clear()
        # Seed a real admin user so password verification can succeed.
        admin_email = "resettest-admin@test.com"
        pw_hash = srv.hash_password("correct-horse-battery-staple") if hasattr(srv, "hash_password") else None
        if pw_hash is None:
            import bcrypt
            pw_hash = bcrypt.hashpw(b"correct-horse-battery-staple", bcrypt.gensalt()).decode()
        await srv.db.users.update_one(
            {"email": admin_email}, {"$set": {"email": admin_email, "password_hash": pw_hash, "role": "admin"}}, upsert=True)
        await _seed_unbound_license("ASE-RESETREASON")
        req = srv.AdminLicenseResetRequest(admin_password="correct-horse-battery-staple", reason="   ")
        with pytest.raises(HTTPException) as exc:
            await srv.admin_reset_license_account("ASE-RESETREASON", req, admin={"email": admin_email})
        assert exc.value.status_code == 400
        await srv.db.users.delete_many({"email": admin_email})
        await _clear()
    _run(go())


def test_admin_reset_succeeds_and_records_audit_trail():
    async def go():
        await _clear()
        admin_email = "resettest-admin2@test.com"
        import bcrypt
        pw_hash = bcrypt.hashpw(b"correct-horse-battery-staple", bcrypt.gensalt()).decode()
        await srv.db.users.update_one(
            {"email": admin_email}, {"$set": {"email": admin_email, "password_hash": pw_hash, "role": "admin"}}, upsert=True)
        await _seed_unbound_license("ASE-RESETOK")
        await srv.validate_pin(srv.PinValidateRequest(pin="ASE-RESETOK", mt5_account="1000001"))

        req = srv.AdminLicenseResetRequest(admin_password="correct-horse-battery-staple", reason="Customer changed broker account")
        result = await srv.admin_reset_license_account("ASE-RESETOK", req, admin={"email": admin_email})
        assert result["reset"] is True
        assert result["previous_account"] == "1000001"

        lic = await srv.db.pin_licenses.find_one({"pin": "ASE-RESETOK"})
        assert not lic.get("mt5_account")  # cleared
        assert lic.get("is_used") is False  # ready to be claimed by a new account

        audit = await srv.db.license_reset_audit_log.find_one({"pin": "ASE-RESETOK"})
        assert audit is not None
        assert audit["previous_account"] == "1000001"
        assert audit["admin_email"] == admin_email
        assert audit["reason"] == "Customer changed broker account"
        assert audit["reset_at"]

        # And the license can now be claimed by a genuinely new account.
        second = await srv.validate_pin(srv.PinValidateRequest(pin="ASE-RESETOK", mt5_account="9999999"))
        assert second["valid"] is True
        lic2 = await srv.db.pin_licenses.find_one({"pin": "ASE-RESETOK"})
        assert lic2["mt5_account"] == "9999999"

        await srv.db.users.delete_many({"email": admin_email})
        await _clear()
    _run(go())


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
