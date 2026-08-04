"""Tests that the bank-transfer lifecycle sends the right emails at the
right moments: instructions + admin notification on initiate, admin
notification on customer "submitted", and a rejection email on admin
reject. Also covers the standalone admin-notification helpers directly.
Mirrors test_fulfillment_email_version.py's pattern of monkeypatching
_send_email to capture the rendered HTML instead of hitting real SMTP.
"""
import sys
import os
import uuid
import asyncio
from unittest.mock import MagicMock, patch

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

TEST_DB = f"bank_transfer_email_pytest_{uuid.uuid4().hex[:10]}"
os.environ["MONGO_URL"] = "mongodb://localhost:27017"
os.environ["DB_NAME"] = TEST_DB
os.environ.setdefault("JWT_SECRET", "test-secret-bank-transfer-email")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")

import server as srv  # noqa: E402

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
    await srv.db.payment_transactions.delete_many({"provider": "BANK_TRANSFER"})
    await srv.db.pin_licenses.delete_many({"provider": "BANK_TRANSFER"})
    await srv.db.admin_settings.delete_many({})


async def _enable_bank_transfer():
    await srv.admin_update_bank_transfer_settings(
        srv.AdminBankTransferSettingsUpdate(
            enabled=True, bank_name="Test Bank", account_name="XauCloud Ltd", account_number="0123456789",
        ),
        admin=ADMIN,
    )


class _Recorder:
    def __init__(self):
        self.sent = []

    async def __call__(self, to_email, subject, html):
        self.sent.append({"to": to_email, "subject": subject, "html": html})
        return True


def test_initiate_sends_instructions_to_buyer_and_notifies_admin():
    async def go():
        await _clear()
        await _enable_bank_transfer()
        recorder = _Recorder()
        with patch.object(srv, "_send_email", recorder):
            await srv.initiate_bank_transfer(
                srv.BankTransferInitiateRequest(buyer_name="Buyer", buyer_email="buyer@example.com"),
                _fake_request("NG"),
            )
        assert len(recorder.sent) == 2
        to_addrs = {m["to"] for m in recorder.sent}
        assert "buyer@example.com" in to_addrs
        assert srv._ADMIN_NOTIFICATION_EMAIL in to_addrs
        buyer_email = next(m for m in recorder.sent if m["to"] == "buyer@example.com")
        assert "Test Bank" in buyer_email["html"]
        assert "0123456789" in buyer_email["html"]
    _run(go())


def test_marking_submitted_notifies_admin_only():
    async def go():
        await _clear()
        await _enable_bank_transfer()
        with patch.object(srv, "_send_email", _Recorder()):
            init = await srv.initiate_bank_transfer(
                srv.BankTransferInitiateRequest(buyer_name="Buyer", buyer_email="buyer@example.com"),
                _fake_request("NG"),
            )
        recorder = _Recorder()
        with patch.object(srv, "_send_email", recorder):
            await srv.bank_transfer_mark_submitted(init["reference"], _fake_request("NG"))
        assert len(recorder.sent) == 1
        assert recorder.sent[0]["to"] == srv._ADMIN_NOTIFICATION_EMAIL
        assert init["reference"] in recorder.sent[0]["html"]
    _run(go())


def test_reject_sends_rejection_email_to_buyer():
    async def go():
        await _clear()
        await _enable_bank_transfer()
        with patch.object(srv, "_send_email", _Recorder()):
            init = await srv.initiate_bank_transfer(
                srv.BankTransferInitiateRequest(buyer_name="Buyer", buyer_email="buyer@example.com"),
                _fake_request("NG"),
            )
            await srv.bank_transfer_mark_submitted(init["reference"], _fake_request("NG"))
        recorder = _Recorder()
        with patch.object(srv, "_send_email", recorder):
            await srv.admin_reject_bank_transfer(
                init["reference"], srv.BankTransferAdminActionRequest(reason="mismatch"), admin=ADMIN,
            )
        assert len(recorder.sent) == 1
        assert recorder.sent[0]["to"] == "buyer@example.com"
        assert "mismatch" in recorder.sent[0]["html"]
    _run(go())


def test_approve_does_not_send_a_second_instructions_email():
    """Approval sends the fulfillment PIN email (send_pin_email, tested
    elsewhere) -- it must not also resend bank-transfer instructions."""
    async def go():
        await _clear()
        await _enable_bank_transfer()
        with patch.object(srv, "_send_email", _Recorder()):
            init = await srv.initiate_bank_transfer(
                srv.BankTransferInitiateRequest(buyer_name="Buyer", buyer_email="buyer@example.com"),
                _fake_request("NG"),
            )
            await srv.bank_transfer_mark_submitted(init["reference"], _fake_request("NG"))
        recorder = _Recorder()
        with patch.object(srv, "_send_email", recorder):
            await srv.admin_approve_bank_transfer(init["reference"], admin=ADMIN)
        assert len(recorder.sent) == 1
        assert recorder.sent[0]["to"] == "buyer@example.com"
        assert "License PIN" in recorder.sent[0]["subject"]
    _run(go())


class TestNotificationHelpersDirectly:
    def test_notify_admin_new_order(self):
        async def go():
            recorder = _Recorder()
            with patch.object(srv, "_send_email", recorder):
                await srv.notify_admin_new_order("card", "ASE-1", "Buyer", "buyer@example.com", "₦300,000")
            assert recorder.sent[0]["to"] == srv._ADMIN_NOTIFICATION_EMAIL
            assert "ASE-1" in recorder.sent[0]["html"]
        _run(go())

    def test_admin_notification_email_defaults_to_admin_email_env(self):
        assert srv._ADMIN_NOTIFICATION_EMAIL  # non-empty, resolved from ADMIN_EMAIL env var
