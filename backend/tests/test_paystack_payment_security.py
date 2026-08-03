"""Real, executable tests for the v6.25.3 Phase 2 Paystack payment security
fix (final pre-launch hardening).

Root vulnerability fixed: POST /api/webhook/paystack trusted an unsigned
charge.success JSON body outright -- any caller who knew (or observed) a
real payment reference could forge a webhook and receive a free license,
with no signature verification and no amount/currency cross-check.

Covers exactly the acceptance list from the hardening prompt:
- forged unsigned charge.success rejected
- wrong signature rejected
- correct signature accepted
- wrong amount rejected
- wrong currency rejected
- unknown reference rejected
- duplicate webhook returns existing fulfillment (idempotent)
- webhook and verify race creates exactly one PIN
- client-supplied malicious callback origin ignored
- failed payment never creates PIN

Uses a live local MongoDB in an isolated database (skips cleanly if none
reachable) and mocks the outbound Paystack HTTP calls (transaction/verify) --
no live Paystack account in this environment.
"""
import sys
import os
import hmac
import hashlib
import json
import asyncio
import uuid
from unittest.mock import patch, MagicMock

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


pytestmark = pytest.mark.skipif(not _mongo_available(), reason="no local MongoDB reachable for this live payment-security test")

TEST_DB = f"paystack_pytest_{uuid.uuid4().hex[:10]}"
os.environ["MONGO_URL"] = "mongodb://localhost:27017"
os.environ["DB_NAME"] = TEST_DB
os.environ.setdefault("JWT_SECRET", "test-secret-paystack")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")

import server as srv  # noqa: E402
from fastapi import HTTPException  # noqa: E402

_LOOP = asyncio.new_event_loop()
SECRET = "sk_test_realsecret123"


def _run(coro):
    return _LOOP.run_until_complete(coro)


async def _clear():
    await srv.db.payment_transactions.delete_many({})
    await srv.db.pin_licenses.delete_many({})
    await srv.db.admin_settings.delete_many({})


async def _set_secret():
    await srv.db.admin_settings.update_one(
        {"key": "main"}, {"$set": {"paystack_secret_key": SECRET}}, upsert=True)


async def _seed_tx(reference, amount_kobo=30000000, currency="NGN", status="PENDING"):
    doc = {"id": str(uuid.uuid4()), "reference": reference, "amount_kobo": amount_kobo, "currency": currency,
           "buyer_name": "Test Buyer", "buyer_email": "buyer@example.com", "payment_status": status,
           "pin_generated": None, "created_at": "2026-07-17T00:00:00Z", "state_transitions": {}}
    await srv.db.payment_transactions.insert_one(doc)
    return doc


def _sign(body_bytes: bytes, secret: str = SECRET) -> str:
    return hmac.new(secret.encode(), body_bytes, hashlib.sha512).hexdigest()


class _FakeRequest:
    """Minimal stand-in for FastAPI's Request -- only the methods/attrs the
    webhook handler actually uses."""
    def __init__(self, body_bytes: bytes, signature: str = "", ip: str = "1.2.3.4"):
        self._body = body_bytes
        self.headers = {"x-paystack-signature": signature} if signature else {}
        self.client = MagicMock(host=ip)

    async def body(self):
        return self._body


def _fake_verify_response(status_code=200, paystack_status=True, tx_status="success", amount=30000000, currency="NGN"):
    resp = MagicMock()
    resp.status_code = status_code
    resp.json = MagicMock(return_value={
        "status": paystack_status,
        "data": {"status": tx_status, "amount": amount, "currency": currency},
    })
    return resp


def test_forged_unsigned_webhook_rejected():
    async def go():
        await _clear()
        await _set_secret()
        ref = "ASE-FORGE1"
        await _seed_tx(ref)
        body = json.dumps({"event": "charge.success", "data": {"reference": ref}}).encode()
        req = _FakeRequest(body, signature="")  # no signature at all
        with pytest.raises(HTTPException) as exc:
            await srv.paystack_webhook(req)
        assert exc.value.status_code == 401
        tx = await srv.db.payment_transactions.find_one({"reference": ref})
        assert tx["pin_generated"] is None
        await _clear()
    _run(go())


def test_wrong_signature_rejected():
    async def go():
        await _clear()
        await _set_secret()
        ref = "ASE-WRONGSIG"
        await _seed_tx(ref)
        body = json.dumps({"event": "charge.success", "data": {"reference": ref}}).encode()
        req = _FakeRequest(body, signature=_sign(body, secret="wrong-secret-entirely"))
        with pytest.raises(HTTPException) as exc:
            await srv.paystack_webhook(req)
        assert exc.value.status_code == 401
        tx = await srv.db.payment_transactions.find_one({"reference": ref})
        assert tx["pin_generated"] is None
        await _clear()
    _run(go())


def test_correct_signature_accepted_and_pin_generated():
    async def go():
        await _clear()
        await _set_secret()
        ref = "ASE-GOODSIG"
        await _seed_tx(ref)
        body = json.dumps({"event": "charge.success", "data": {"reference": ref}}).encode()
        req = _FakeRequest(body, signature=_sign(body))
        fake_resp = _fake_verify_response()
        with patch("httpx.AsyncClient") as MockClient:
            instance = MockClient.return_value.__aenter__.return_value
            instance.get = _async_return(fake_resp)
            await srv.paystack_webhook(req)
        tx = await srv.db.payment_transactions.find_one({"reference": ref})
        assert tx["pin_generated"] is not None
        assert tx["payment_status"] == "FULFILLED"
        lic = await srv.db.pin_licenses.find_one({"payment_ref": ref})
        assert lic is not None
        await _clear()
    _run(go())


def _async_return(value):
    async def _inner(*a, **kw):
        return value
    return _inner


def test_wrong_amount_rejected():
    async def go():
        await _clear()
        await _set_secret()
        ref = "ASE-UNDERPAY"
        await _seed_tx(ref, amount_kobo=30000000)
        # Paystack reports success but for a smaller amount than expected
        fake_resp = _fake_verify_response(amount=10000000)
        with patch("httpx.AsyncClient") as MockClient:
            instance = MockClient.return_value.__aenter__.return_value
            instance.get = _async_return(fake_resp)
            result = await srv._fulfill_payment(ref, source="test")
        assert result["status"] == "failed"
        assert result["reason"] == "amount_mismatch"
        tx = await srv.db.payment_transactions.find_one({"reference": ref})
        assert tx["pin_generated"] is None
        assert tx["payment_status"] == "REJECTED_AMOUNT_MISMATCH"
        await _clear()
    _run(go())


def test_wrong_currency_rejected():
    async def go():
        await _clear()
        await _set_secret()
        ref = "ASE-WRONGCCY"
        await _seed_tx(ref, currency="NGN")
        fake_resp = _fake_verify_response(currency="USD")
        with patch("httpx.AsyncClient") as MockClient:
            instance = MockClient.return_value.__aenter__.return_value
            instance.get = _async_return(fake_resp)
            result = await srv._fulfill_payment(ref, source="test")
        assert result["status"] == "failed"
        assert result["reason"] == "amount_mismatch"
        tx = await srv.db.payment_transactions.find_one({"reference": ref})
        assert tx["pin_generated"] is None
        await _clear()
    _run(go())


def test_unknown_reference_rejected():
    async def go():
        await _clear()
        await _set_secret()
        result = await srv._fulfill_payment("ASE-DOES-NOT-EXIST", source="test")
        assert result["status"] == "not_found"
        lic_count = await srv.db.pin_licenses.count_documents({})
        assert lic_count == 0
        await _clear()
    _run(go())


def test_duplicate_webhook_returns_existing_fulfillment_idempotent():
    async def go():
        await _clear()
        await _set_secret()
        ref = "ASE-DUPWEBHOOK"
        await _seed_tx(ref)
        body = json.dumps({"event": "charge.success", "data": {"reference": ref}}).encode()
        req1 = _FakeRequest(body, signature=_sign(body))
        fake_resp = _fake_verify_response()
        with patch("httpx.AsyncClient") as MockClient:
            instance = MockClient.return_value.__aenter__.return_value
            instance.get = _async_return(fake_resp)
            await srv.paystack_webhook(req1)
        tx1 = await srv.db.payment_transactions.find_one({"reference": ref})
        first_pin = tx1["pin_generated"]

        # Second, identical webhook delivery (Paystack retries on any
        # non-fast-2xx, or an attacker replays a captured valid payload)
        req2 = _FakeRequest(body, signature=_sign(body))
        with patch("httpx.AsyncClient") as MockClient:
            instance = MockClient.return_value.__aenter__.return_value
            instance.get = _async_return(fake_resp)
            await srv.paystack_webhook(req2)
        tx2 = await srv.db.payment_transactions.find_one({"reference": ref})
        assert tx2["pin_generated"] == first_pin  # unchanged, not regenerated
        lic_count = await srv.db.pin_licenses.count_documents({"payment_ref": ref})
        assert lic_count == 1  # exactly one license, not two
        await _clear()
    _run(go())


def test_webhook_and_poll_race_creates_exactly_one_pin():
    async def go():
        await _clear()
        await _set_secret()
        ref = "ASE-RACE1"
        await _seed_tx(ref)
        fake_resp = _fake_verify_response()
        with patch("httpx.AsyncClient") as MockClient:
            instance = MockClient.return_value.__aenter__.return_value
            instance.get = _async_return(fake_resp)
            # Simulate the webhook and the browser's polling verify call
            # racing each other for the same reference.
            results = await asyncio.gather(
                srv._fulfill_payment(ref, source="webhook"),
                srv._fulfill_payment(ref, source="poll"),
                srv._fulfill_payment(ref, source="poll"),
            )
        lic_count = await srv.db.pin_licenses.count_documents({"payment_ref": ref})
        assert lic_count == 1
        pins = {r.get("pin") for r in results if r.get("pin")}
        assert len(pins) == 1  # every caller that got a pin got the SAME one
        await _clear()
    _run(go())


# test_client_supplied_malicious_callback_origin_ignored() used to live
# here, asserting that POST /purchase/initialize never used a client-
# supplied origin_url to build the Paystack callback_url. As of the
# Nomba payment migration, /purchase/initialize creates a Nomba order
# exclusively (see server.py's initialize_purchase() and
# audits/nomba_migration/01_paystack_audit.md) -- Paystack is no longer
# reachable through that endpoint at all, so a test that mocks a
# Paystack /transaction/initialize response and expects
# initialize_purchase() to call it no longer exercises anything real.
# The identical security property (callback_url built only from
# PUBLIC_SITE_URL, never req.origin_url) is now covered against the
# live code path in
# backend/tests/test_nomba_payment_security.py::test_initialize_purchase_ignores_client_supplied_origin_for_callback.


def test_failed_payment_never_creates_pin():
    async def go():
        await _clear()
        await _set_secret()
        ref = "ASE-STILLPENDING"
        await _seed_tx(ref)
        fake_resp = _fake_verify_response(tx_status="abandoned")  # not "success"
        with patch("httpx.AsyncClient") as MockClient:
            instance = MockClient.return_value.__aenter__.return_value
            instance.get = _async_return(fake_resp)
            result = await srv._fulfill_payment(ref, source="test")
        assert result["status"] == "pending"
        lic_count = await srv.db.pin_licenses.count_documents({"payment_ref": ref})
        assert lic_count == 0
        await _clear()
    _run(go())


def test_no_secret_key_never_creates_pin():
    async def go():
        await _clear()
        # deliberately do NOT call _set_secret() -- payment system unconfigured
        ref = "ASE-NOSECRET"
        await _seed_tx(ref)
        result = await srv._fulfill_payment(ref, source="test")
        assert result["status"] == "pending"
        lic_count = await srv.db.pin_licenses.count_documents({"payment_ref": ref})
        assert lic_count == 0
        await _clear()
    _run(go())


if __name__ == "__main__":
    import pytest
    sys.exit(pytest.main([__file__, "-v"]))
