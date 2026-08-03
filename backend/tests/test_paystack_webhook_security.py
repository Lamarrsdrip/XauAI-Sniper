"""
Backend regression tests for the Paystack webhook security hardening
(Phase 0 of the XauCloud commerce upgrade).

Prior behavior audited and fixed:
  - /api/webhook/paystack had no signature verification at all — anyone
    could call /api/purchase/initialize to create a pending transaction,
    then forge a "charge.success" webhook POST for that reference with no
    auth and get a real license PIN emailed to any address, with no actual
    payment. Fixed by verifying X-Paystack-Signature (HMAC-SHA512 over the
    raw body using the Paystack secret key).
  - Neither the webhook nor /purchase/verify validated the charged
    amount/currency against the order before minting a license. Fixed by
    _paystack_amounts_match().
  - Fulfillment (license mint + email) was check-then-act, not atomic, and
    the webhook path skipped the duplicate-PIN collision check that
    /purchase/verify had — a race between the two could mint two PINs and
    send two emails for one payment. Fixed by _claim_transaction_fulfillment()
    (atomic find_one_and_update) shared by both paths.

Run (against a locally running instance):
  MONGO_URL=... DB_NAME=... PAYSTACK_SECRET_KEY=... \\
  BASE_URL=http://127.0.0.1:8811 pytest backend/tests/test_paystack_webhook_security.py -v
"""
import os
import hmac
import hashlib
import json
import uuid

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("BASE_URL", "http://127.0.0.1:8811").rstrip("/")
API = f"{BASE_URL}/api"
PAYSTACK_SECRET_KEY = os.environ.get("PAYSTACK_SECRET_KEY", "")


def _sign(body_bytes: bytes, secret: str) -> str:
    return hmac.new(secret.encode("utf-8"), body_bytes, hashlib.sha512).hexdigest()


@pytest.fixture(scope="module")
def mongo_db():
    mongo = MongoClient(os.environ["MONGO_URL"])
    return mongo[os.environ["DB_NAME"]]


def _create_pending_order(mongo_db):
    """Mirrors POST /purchase/initialize's side effect directly against the
    DB so tests don't depend on live Paystack API access to get a real
    authorization_url."""
    ref = f"ASE-TEST-{uuid.uuid4().hex[:10].upper()}"
    tx = {
        "id": str(uuid.uuid4()),
        "reference": ref,
        "amount_kobo": 30000000,
        "currency": "NGN",
        "buyer_name": "Test Buyer",
        "buyer_email": f"{uuid.uuid4().hex[:8]}@example.com",
        "payment_status": "pending",
        "pin_generated": None,
        "created_at": "2026-01-01T00:00:00+00:00",
    }
    mongo_db.payment_transactions.insert_one(dict(tx))
    return ref, tx


def _charge_success_payload(reference: str, amount_kobo: int = 30000000, currency: str = "NGN") -> bytes:
    return json.dumps({
        "event": "charge.success",
        "data": {"reference": reference, "amount": amount_kobo, "currency": currency, "status": "success"},
    }).encode("utf-8")


class TestWebhookSignatureRejection:
    def test_missing_signature_is_rejected(self, mongo_db):
        ref, _ = _create_pending_order(mongo_db)
        body = _charge_success_payload(ref)
        r = requests.post(f"{API}/webhook/paystack", data=body,
                           headers={"Content-Type": "application/json"}, timeout=20)
        assert r.status_code == 401, f"expected 401, got {r.status_code}: {r.text}"
        assert mongo_db.payment_transactions.find_one({"reference": ref})["pin_generated"] is None

    def test_forged_signature_is_rejected(self, mongo_db):
        ref, _ = _create_pending_order(mongo_db)
        body = _charge_success_payload(ref)
        bad_sig = _sign(body, "not-the-real-secret")
        r = requests.post(f"{API}/webhook/paystack", data=body,
                           headers={"Content-Type": "application/json", "X-Paystack-Signature": bad_sig},
                           timeout=20)
        assert r.status_code == 401, f"expected 401, got {r.status_code}: {r.text}"
        assert mongo_db.payment_transactions.find_one({"reference": ref})["pin_generated"] is None

    def test_attacker_cannot_self_forge_a_license_end_to_end(self, mongo_db):
        """The exact exploit this fix closes: create your own pending order,
        then try to forge the charge.success webhook for it without a valid
        Paystack signature. Must never result in a license."""
        ref, _ = _create_pending_order(mongo_db)
        body = _charge_success_payload(ref)
        r = requests.post(f"{API}/webhook/paystack", data=body,
                           headers={"Content-Type": "application/json", "X-Paystack-Signature": "deadbeef"},
                           timeout=20)
        assert r.status_code == 401
        assert mongo_db.pin_licenses.count_documents({"payment_ref": ref}) == 0


@pytest.mark.skipif(not PAYSTACK_SECRET_KEY, reason="PAYSTACK_SECRET_KEY not set for this test run")
class TestWebhookValidSignature:
    def test_valid_signature_wrong_amount_does_not_fulfill(self, mongo_db):
        ref, tx = _create_pending_order(mongo_db)
        body = _charge_success_payload(ref, amount_kobo=tx["amount_kobo"] - 1)  # underpaid by 1 kobo
        sig = _sign(body, PAYSTACK_SECRET_KEY)
        r = requests.post(f"{API}/webhook/paystack", data=body,
                           headers={"Content-Type": "application/json", "X-Paystack-Signature": sig},
                           timeout=20)
        assert r.status_code == 200
        assert mongo_db.payment_transactions.find_one({"reference": ref})["pin_generated"] is None

    def test_valid_signature_wrong_currency_does_not_fulfill(self, mongo_db):
        ref, tx = _create_pending_order(mongo_db)
        body = _charge_success_payload(ref, amount_kobo=tx["amount_kobo"], currency="USD")
        sig = _sign(body, PAYSTACK_SECRET_KEY)
        r = requests.post(f"{API}/webhook/paystack", data=body,
                           headers={"Content-Type": "application/json", "X-Paystack-Signature": sig},
                           timeout=20)
        assert r.status_code == 200
        assert mongo_db.payment_transactions.find_one({"reference": ref})["pin_generated"] is None

    def test_valid_signature_correct_amount_fulfills_exactly_once(self, mongo_db):
        ref, tx = _create_pending_order(mongo_db)
        body = _charge_success_payload(ref, amount_kobo=tx["amount_kobo"])
        sig = _sign(body, PAYSTACK_SECRET_KEY)
        r = requests.post(f"{API}/webhook/paystack", data=body,
                           headers={"Content-Type": "application/json", "X-Paystack-Signature": sig},
                           timeout=20)
        assert r.status_code == 200
        stored = mongo_db.payment_transactions.find_one({"reference": ref})
        assert stored["pin_generated"], "expected a PIN to be minted after a valid, matching webhook"
        assert stored["payment_status"] == "success"
        assert mongo_db.pin_licenses.count_documents({"payment_ref": ref}) == 1

    def test_duplicate_webhook_delivery_is_a_no_op(self, mongo_db):
        """Paystack retries webhook delivery on anything but a 2xx; a retried
        (or attacker-replayed) delivery of an already-fulfilled event must
        never mint a second license or send a second email."""
        ref, tx = _create_pending_order(mongo_db)
        body = _charge_success_payload(ref, amount_kobo=tx["amount_kobo"])
        sig = _sign(body, PAYSTACK_SECRET_KEY)
        r1 = requests.post(f"{API}/webhook/paystack", data=body,
                            headers={"Content-Type": "application/json", "X-Paystack-Signature": sig},
                            timeout=20)
        r2 = requests.post(f"{API}/webhook/paystack", data=body,
                            headers={"Content-Type": "application/json", "X-Paystack-Signature": sig},
                            timeout=20)
        assert r1.status_code == 200 and r2.status_code == 200
        assert mongo_db.pin_licenses.count_documents({"payment_ref": ref}) == 1, \
            "duplicate webhook delivery must not mint a second license"

    def test_verify_endpoint_and_webhook_race_yield_one_license(self, mongo_db):
        """Simulates the customer's browser polling /purchase/verify at the
        same time Paystack's webhook fires for the same reference — both
        used to be able to independently mint a PIN before this fix."""
        ref, tx = _create_pending_order(mongo_db)
        body = _charge_success_payload(ref, amount_kobo=tx["amount_kobo"])
        sig = _sign(body, PAYSTACK_SECRET_KEY)
        # webhook fulfills first
        requests.post(f"{API}/webhook/paystack", data=body,
                      headers={"Content-Type": "application/json", "X-Paystack-Signature": sig}, timeout=20)
        # verify endpoint is then polled by the customer's browser
        rv = requests.get(f"{API}/purchase/verify/{ref}", timeout=20)
        assert rv.status_code == 200
        assert mongo_db.pin_licenses.count_documents({"payment_ref": ref}) == 1
        assert rv.json()["pin"] == mongo_db.payment_transactions.find_one({"reference": ref})["pin_generated"]
