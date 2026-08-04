"""Tests that a failed fulfillment email is never silently lost: the order
gets flagged (fulfillment_email_failed), the admin is alerted with the PIN
so they can resend manually, and GET/POST /admin/orders/{ref}/resend-
fulfillment-email lets them retry without regenerating a new license.

Covers all three fulfillment call sites (Paystack-legacy, Nomba,
bank-transfer approve) via the shared _record_fulfillment_email_result()
helper, plus the standalone resend endpoint.
"""
import sys
import os
import uuid
import asyncio
from unittest.mock import MagicMock, AsyncMock, patch

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

TEST_DB = f"fulfillment_email_failure_pytest_{uuid.uuid4().hex[:10]}"
os.environ["MONGO_URL"] = "mongodb://localhost:27017"
os.environ["DB_NAME"] = TEST_DB
os.environ.setdefault("JWT_SECRET", "test-secret-fulfillment-failure")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")

import server as srv  # noqa: E402
from fastapi import HTTPException  # noqa: E402

_LOOP = asyncio.new_event_loop()


def _run(coro):
    return _LOOP.run_until_complete(coro)


ADMIN = {"email": "admin@test.com", "role": "admin"}


def _fake_request(country="NG"):
    req = MagicMock()
    req.headers = {"cf-ipcountry": country}
    req.client = MagicMock(host=f"127.0.0.{uuid.uuid4().int % 250 + 1}")
    return req


async def _clear():
    await srv.db.payment_transactions.delete_many({})
    await srv.db.pin_licenses.delete_many({})
    await srv.db.admin_settings.delete_many({})


class _Recorder:
    def __init__(self):
        self.sent = []

    async def __call__(self, to_email, subject, html):
        self.sent.append({"to": to_email, "subject": subject, "html": html})
        return True


async def _enable_bank_transfer():
    await srv.admin_update_bank_transfer_settings(
        srv.AdminBankTransferSettingsUpdate(
            enabled=True, bank_name="Test Bank", account_name="XauCloud Ltd", account_number="0123456789",
        ),
        admin=ADMIN,
    )


def test_record_fulfillment_email_result_flags_order_on_failure():
    async def go():
        await _clear()
        await srv.db.payment_transactions.insert_one({"reference": "ASE-FAIL-1", "buyer_name": "A", "buyer_email": "a@example.com"})
        recorder = _Recorder()
        with patch.object(srv, "_send_email", recorder):
            await srv._record_fulfillment_email_result("ASE-FAIL-1", "A", "a@example.com", "ASE-PIN-0001", email_sent=False)
        tx = await srv.db.payment_transactions.find_one({"reference": "ASE-FAIL-1"})
        assert tx["fulfillment_email_failed"] is True
        assert "fulfillment_email_failed_at" in tx
        assert len(recorder.sent) == 1
        assert recorder.sent[0]["to"] == srv._ADMIN_NOTIFICATION_EMAIL
        assert "ASE-PIN-0001" in recorder.sent[0]["html"]
    _run(go())


def test_record_fulfillment_email_result_no_op_on_success():
    async def go():
        await _clear()
        await srv.db.payment_transactions.insert_one({"reference": "ASE-OK-1", "buyer_name": "A", "buyer_email": "a@example.com"})
        recorder = _Recorder()
        with patch.object(srv, "_send_email", recorder):
            await srv._record_fulfillment_email_result("ASE-OK-1", "A", "a@example.com", "ASE-PIN-0002", email_sent=True)
        tx = await srv.db.payment_transactions.find_one({"reference": "ASE-OK-1"})
        assert "fulfillment_email_failed" not in tx
        assert len(recorder.sent) == 0
    _run(go())


def test_bank_transfer_approve_flags_order_when_email_fails():
    async def go():
        await _clear()
        await _enable_bank_transfer()
        with patch.object(srv, "_send_email", _Recorder()):
            init = await srv.initiate_bank_transfer(
                srv.BankTransferInitiateRequest(buyer_name="Buyer", buyer_email="buyer@example.com"), _fake_request("NG"))
            await srv.bank_transfer_mark_submitted(init["reference"], _fake_request("NG"))
        with patch.object(srv, "send_pin_email", AsyncMock(return_value=False)):
            await srv.admin_approve_bank_transfer(init["reference"], admin=ADMIN)
        tx = await srv.db.payment_transactions.find_one({"reference": init["reference"]})
        assert tx["payment_status"] == "FULFILLED"  # order/license still valid even though the email failed
        assert tx["fulfillment_email_failed"] is True
    _run(go())


def test_resend_fulfillment_email_succeeds_and_clears_flag():
    async def go():
        await _clear()
        await srv.db.payment_transactions.insert_one({
            "reference": "ASE-RESEND-1", "buyer_name": "A", "buyer_email": "a@example.com",
            "pin_generated": "ASE-PIN-0003", "payment_status": "FULFILLED", "fulfillment_email_failed": True,
        })
        with patch.object(srv, "send_pin_email", AsyncMock(return_value=True)):
            result = await srv.admin_resend_fulfillment_email("ASE-RESEND-1")
        assert result["sent"] is True
        tx = await srv.db.payment_transactions.find_one({"reference": "ASE-RESEND-1"})
        assert "fulfillment_email_failed" not in tx
    _run(go())


def test_resend_fulfillment_email_rejects_order_without_license():
    async def go():
        await _clear()
        await srv.db.payment_transactions.insert_one({"reference": "ASE-NOPIN-1", "buyer_name": "A", "buyer_email": "a@example.com"})
        with pytest.raises(HTTPException) as exc:
            await srv.admin_resend_fulfillment_email("ASE-NOPIN-1")
        assert exc.value.status_code == 409
    _run(go())


def test_resend_fulfillment_email_unknown_reference_404s():
    async def go():
        await _clear()
        with pytest.raises(HTTPException) as exc:
            await srv.admin_resend_fulfillment_email("ASE-DOES-NOT-EXIST")
        assert exc.value.status_code == 404
    _run(go())
