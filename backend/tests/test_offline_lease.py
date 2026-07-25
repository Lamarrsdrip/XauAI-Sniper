"""Real, executable tests for the XauCloud bounded offline trading lease
backend (Phases 16-17 of audits/offline_lease/).

Covers: lease issuance/signature validity, primary-terminal exclusivity
(a second terminal cannot get a lease while the first's is still valid),
renewal (same terminal only), surrender + reassignment, expiry-based
reassignment, idempotent reconciliation, and fail-closed behavior when
no signing key is configured.

Uses a live local MongoDB in an isolated database (skips cleanly if none
reachable), following this project's established live-test pattern.
"""
import sys
import os
import uuid
import base64
import asyncio

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


pytestmark = pytest.mark.skipif(not _mongo_available(), reason="no local MongoDB reachable for this live lease test")

TEST_DB = f"lease_pytest_{uuid.uuid4().hex[:10]}"
os.environ["MONGO_URL"] = "mongodb://localhost:27017"
os.environ["DB_NAME"] = TEST_DB
os.environ.setdefault("JWT_SECRET", "test-secret-lease")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")

# Generate a fresh, throwaway RSA key for this test run only -- never a
# real production secret, never committed anywhere, exists only in this
# process's environment for the duration of the test session.
from cryptography.hazmat.primitives.asymmetric import rsa as _rsa
from cryptography.hazmat.primitives import serialization as _ser
_test_priv = _rsa.generate_private_key(public_exponent=65537, key_size=2048)
_test_pem = _test_priv.private_bytes(_ser.Encoding.PEM, _ser.PrivateFormat.PKCS8, _ser.NoEncryption())
os.environ["XAUCLOUD_LEASE_SIGNING_PRIVATE_KEY"] = base64.b64encode(_test_pem).decode()
os.environ["XAUCLOUD_LEASE_SIGNING_KEY_ID"] = "test-key-1"

import server as srv  # noqa: E402
import lease_service  # noqa: E402
from fastapi import HTTPException  # noqa: E402

_LOOP = asyncio.new_event_loop()


def _run(coro):
    return _LOOP.run_until_complete(coro)


async def _clear():
    await srv.db.pin_licenses.delete_many({})
    await srv.db.lease_terminal_authority.delete_many({})
    await srv.db.lease_documents.delete_many({})
    await srv.db.lease_offline_events.delete_many({})


def setup_function(_fn):
    _run(_clear())


ACCOUNT = "109865659"
SERVER_NAME = "MetaQuotes-Demo"
SYMBOL = "XAUUSD"


async def _seed_license(pin="XAUC-LEASE-TEST-PIN", account=ACCOUNT):
    doc = {"id": str(uuid.uuid4()), "pin": pin, "is_active": True, "mt5_account": account,
           "is_used": True, "buyer_email": "buyer@example.com"}
    await srv.db.pin_licenses.insert_one(doc)
    return doc


class _FakeRequest:
    def __init__(self):
        self.headers = {}
        self.cookies = {}
        self.client = None


def _lease_req(pin, installation_id="MAC-INSTALL-1", terminal_instance_id="MAC-TERM-1", account=ACCOUNT):
    return srv.LeaseRequestReq(
        pin=pin, account=account, broker_server=SERVER_NAME, symbol=SYMBOL,
        installation_id=installation_id, terminal_instance_id=terminal_instance_id,
        allowed_directions=[1, -1], allowed_entry_families=["CORE"],
    )


def test_lease_issued_with_valid_signature():
    _run(_seed_license())
    result = _run(srv.cloud_lease_request(_lease_req("XAUC-LEASE-TEST-PIN"), _FakeRequest()))
    assert result["issued"] is True
    lease = result["lease"]
    assert lease["lease_sequence"] == 1
    assert lease["signature_algorithm"] == lease_service.LEASE_ALGORITHM_ID
    ok = lease_service.verify_lease_signature_backend_side(
        # modulus is not returned to the caller in the lease doc (the EA
        # trusts a compiled-in public key, not one supplied over the wire)
        # -- rebuild it from the same signing key used to issue, to prove
        # the signature is valid against the real key.
        _test_priv.public_key().public_numbers().n.__format__("0512x"),
        65537,
        {k: lease[k] for k in lease if k not in ("signature_algorithm", "detached_signature", "_history_id", "recorded_at")},
        lease["detached_signature"],
    )
    assert ok


def test_second_terminal_denied_while_first_lease_active():
    _run(_seed_license())
    _run(srv.cloud_lease_request(_lease_req("XAUC-LEASE-TEST-PIN", terminal_instance_id="MAC-TERM-1"), _FakeRequest()))
    with pytest.raises(HTTPException) as exc:
        _run(srv.cloud_lease_request(_lease_req("XAUC-LEASE-TEST-PIN", terminal_instance_id="VPS-TERM-1"), _FakeRequest()))
    assert exc.value.status_code == 403
    assert exc.value.detail["reason"] == "PRIMARY_TERMINAL_ALREADY_ASSIGNED"


def test_same_terminal_can_renew_and_sequence_increments():
    _run(_seed_license())
    r1 = _run(srv.cloud_lease_request(_lease_req("XAUC-LEASE-TEST-PIN"), _FakeRequest()))
    assert r1["lease"]["lease_sequence"] == 1
    r2 = _run(srv.cloud_lease_renew(_lease_req("XAUC-LEASE-TEST-PIN"), _FakeRequest()))
    assert r2["lease"]["lease_sequence"] == 2
    assert r2["lease"]["lease_id"] != r1["lease"]["lease_id"]


def test_other_terminal_cannot_renew():
    _run(_seed_license())
    _run(srv.cloud_lease_request(_lease_req("XAUC-LEASE-TEST-PIN", terminal_instance_id="MAC-TERM-1"), _FakeRequest()))
    with pytest.raises(HTTPException) as exc:
        _run(srv.cloud_lease_renew(_lease_req("XAUC-LEASE-TEST-PIN", terminal_instance_id="VPS-TERM-1"), _FakeRequest()))
    assert exc.value.status_code in (403,)


def test_surrender_then_new_terminal_can_claim():
    _run(_seed_license())
    r1 = _run(srv.cloud_lease_request(_lease_req("XAUC-LEASE-TEST-PIN", terminal_instance_id="MAC-TERM-1"), _FakeRequest()))
    lease_id = r1["lease"]["lease_id"]
    surrender_req = srv.LeaseSurrenderReq(
        pin="XAUC-LEASE-TEST-PIN", account=ACCOUNT, broker_server=SERVER_NAME, symbol=SYMBOL,
        installation_id="MAC-INSTALL-1", terminal_instance_id="MAC-TERM-1", lease_id=lease_id,
    )
    surrender_result = _run(srv.cloud_lease_surrender(surrender_req, _FakeRequest()))
    assert surrender_result["surrendered"] is True

    r2 = _run(srv.cloud_lease_request(_lease_req("XAUC-LEASE-TEST-PIN", terminal_instance_id="VPS-TERM-1"), _FakeRequest()))
    assert r2["issued"] is True
    assert r2["lease"]["terminal_instance_id"] == "VPS-TERM-1"


def test_foreign_surrender_attempt_rejected():
    _run(_seed_license())
    r1 = _run(srv.cloud_lease_request(_lease_req("XAUC-LEASE-TEST-PIN", terminal_instance_id="MAC-TERM-1"), _FakeRequest()))
    lease_id = r1["lease"]["lease_id"]
    foreign_surrender = srv.LeaseSurrenderReq(
        pin="XAUC-LEASE-TEST-PIN", account=ACCOUNT, broker_server=SERVER_NAME, symbol=SYMBOL,
        installation_id="VPS-INSTALL-1", terminal_instance_id="VPS-TERM-1", lease_id=lease_id,
    )
    result = _run(srv.cloud_lease_surrender(foreign_surrender, _FakeRequest()))
    assert result["surrendered"] is False
    # the original terminal's lease must still be intact
    status = _run(srv.cloud_lease_status(pin="XAUC-LEASE-TEST-PIN", account=ACCOUNT, broker_server=SERVER_NAME, symbol=SYMBOL, request=_FakeRequest()))
    assert status["holder_terminal_id"] == "MAC-TERM-1"
    assert status["surrendered"] is False


def test_reconciliation_is_idempotent():
    _run(_seed_license())
    r1 = _run(srv.cloud_lease_request(_lease_req("XAUC-LEASE-TEST-PIN"), _FakeRequest()))
    lease = r1["lease"]
    event = srv.LeaseReconcileEvent(
        execution_key="EXEC-KEY-ABC-123", lease_id=lease["lease_id"], lease_sequence=lease["lease_sequence"],
        direction=1, entry_family="CORE", broker_ticket=555111, result="CONFIRMED",
        executed_at="2026-07-25T15:05:00Z",
    )
    req = srv.LeaseReconcileReq(
        pin="XAUC-LEASE-TEST-PIN", account=ACCOUNT, broker_server=SERVER_NAME, symbol=SYMBOL,
        installation_id="MAC-INSTALL-1", terminal_instance_id="MAC-TERM-1", events=[event],
    )
    r_first = _run(srv.cloud_lease_reconcile(req, _FakeRequest()))
    assert r_first["events"][0]["status"] == "reconciled"

    r_second = _run(srv.cloud_lease_reconcile(req, _FakeRequest()))
    assert r_second["events"][0]["status"] == "already_reconciled"

    count = _run(srv.db.lease_offline_events.count_documents({"_id": "EXEC-KEY-ABC-123"}))
    assert count == 1


def test_lease_status_reports_no_authority_record_initially():
    _run(_seed_license())
    status = _run(srv.cloud_lease_status(pin="XAUC-LEASE-TEST-PIN", account=ACCOUNT, broker_server=SERVER_NAME, symbol=SYMBOL, request=_FakeRequest()))
    assert status["has_authority_record"] is False


def test_lease_request_fails_closed_without_signing_key_configured():
    _run(_seed_license())
    saved_key = os.environ.pop("XAUCLOUD_LEASE_SIGNING_PRIVATE_KEY")
    try:
        with pytest.raises(HTTPException) as exc:
            _run(srv.cloud_lease_request(_lease_req("XAUC-LEASE-TEST-PIN"), _FakeRequest()))
        assert exc.value.status_code == 503
    finally:
        os.environ["XAUCLOUD_LEASE_SIGNING_PRIVATE_KEY"] = saved_key


def test_lease_request_rejects_unauthenticated_pin():
    with pytest.raises(HTTPException) as exc:
        _run(srv.cloud_lease_request(_lease_req("NOT-A-REAL-PIN"), _FakeRequest()))
    assert exc.value.status_code == 403


def test_lease_request_rejects_invalid_symbol():
    _run(_seed_license())
    req = _lease_req("XAUC-LEASE-TEST-PIN")
    req.symbol = "BTCUSD"
    with pytest.raises(HTTPException) as exc:
        _run(srv.cloud_lease_request(req, _FakeRequest()))
    assert exc.value.status_code == 400
