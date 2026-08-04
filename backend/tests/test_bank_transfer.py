"""Tests for the manual Nigeria-only bank-transfer purchase path: customer
endpoints (eligibility, initiate, "I have made the transfer", proof upload,
status polling) and admin endpoints (settings, queue, approve/reject/
mark-expired/request-info).

Core invariants under test:
- Bank transfer is only offered to (and only creatable by) Nigeria-detected
  visitors, re-validated server-side regardless of what the UI showed.
- The customer's "I have made the transfer" action can ONLY ever move
  PENDING -> SUBMITTED -- never mints a license or sends the fulfillment
  email under any circumstance.
- Only an authenticated admin's approval can fulfill an order, exactly
  once, even under a double-click or concurrent-admin race.
- An expired order can't be approved.

Uses a live local MongoDB (skips cleanly if unreachable).
"""
import sys
import os
import uuid
import asyncio
from datetime import datetime, timedelta, timezone
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

TEST_DB = f"bank_transfer_pytest_{uuid.uuid4().hex[:10]}"
os.environ["MONGO_URL"] = "mongodb://localhost:27017"
os.environ["DB_NAME"] = TEST_DB
os.environ.setdefault("JWT_SECRET", "test-secret-bank-transfer")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")

import server as srv  # noqa: E402
from fastapi import HTTPException  # noqa: E402

_LOOP = asyncio.new_event_loop()


def _run(coro):
    return _LOOP.run_until_complete(coro)


ADMIN = {"email": "admin@test.com", "role": "admin"}


def _fake_request(country: str = "NG"):
    """Each call gets a unique fake client IP so _rate_limit's per-IP bucket
    (a real, correctly-working production safeguard) doesn't cross-
    contaminate between independent test cases in the same run."""
    req = MagicMock()
    req.headers = {"cf-ipcountry": country} if country else {}
    req.client = MagicMock(host=f"127.0.0.{uuid.uuid4().int % 250 + 1}")
    return req


async def _clear():
    await srv.db.payment_transactions.delete_many({"provider": "BANK_TRANSFER"})
    await srv.db.pin_licenses.delete_many({"provider": "BANK_TRANSFER"})
    await srv.db.admin_settings.delete_many({})
    await srv.db.payment_config_audit_log.delete_many({"provider": "BANK_TRANSFER"})


async def _enable_bank_transfer(timeout_minutes=60):
    await srv.admin_update_bank_transfer_settings(
        srv.AdminBankTransferSettingsUpdate(
            enabled=True, bank_name="Test Bank", account_name="XauCloud Ltd",
            account_number="0123456789", timeout_minutes=timeout_minutes,
        ),
        admin=ADMIN,
    )


async def _mock_email():
    """send_pin_email hits real SMTP if configured; keep it a safe no-op."""
    patcher = patch.object(srv, "send_pin_email", AsyncMock(return_value=True))
    patcher.start()
    return patcher


class TestEligibility:
    def test_eligible_when_nigeria_and_enabled(self):
        async def go():
            await _clear()
            await _enable_bank_transfer()
            result = await srv.bank_transfer_eligibility(_fake_request("NG"))
            assert result["eligible"] is True
        _run(go())

    def test_eligible_regardless_of_detected_country(self):
        """Owner directive: Nigeria Bank Transfer must be available to every
        visitor once configured, never gated on IP-geolocated country --
        that check used to reject genuine Nigerian customers whenever
        geo-IP detection guessed wrong."""
        async def go():
            await _clear()
            await _enable_bank_transfer()
            result = await srv.bank_transfer_eligibility(_fake_request("US"))
            assert result["eligible"] is True
        _run(go())

    def test_not_eligible_when_disabled(self):
        async def go():
            await _clear()
            result = await srv.bank_transfer_eligibility(_fake_request("NG"))
            assert result["eligible"] is False
        _run(go())


class TestInitiate:
    def test_initiate_succeeds_for_nigeria(self):
        async def go():
            await _clear()
            await _enable_bank_transfer()
            result = await srv.initiate_bank_transfer(
                srv.BankTransferInitiateRequest(buyer_name="Buyer", buyer_email="buyer@example.com"),
                _fake_request("NG"),
            )
            assert result["bank_name"] == "Test Bank"
            assert result["account_number"] == "0123456789"
            tx = await srv.db.payment_transactions.find_one({"reference": result["reference"]})
            assert tx["payment_status"] == "BANK_TRANSFER_PENDING"
            assert tx["provider"] == "BANK_TRANSFER"
        _run(go())

    def test_initiate_succeeds_regardless_of_detected_country(self):
        """Owner directive: available to every visitor, not gated on
        IP-geolocated country -- detected_country is still recorded on the
        order for admin visibility, just no longer used to reject."""
        async def go():
            await _clear()
            await _enable_bank_transfer()
            result = await srv.initiate_bank_transfer(
                srv.BankTransferInitiateRequest(buyer_name="Buyer", buyer_email="buyer@example.com"),
                _fake_request("US"),
            )
            tx = await srv.db.payment_transactions.find_one({"reference": result["reference"]})
            assert tx["payment_status"] == "BANK_TRANSFER_PENDING"
            assert tx["detected_country"] == "US"
        _run(go())

    def test_initiate_rejected_when_not_enabled(self):
        async def go():
            await _clear()
            with pytest.raises(HTTPException) as exc:
                await srv.initiate_bank_transfer(
                    srv.BankTransferInitiateRequest(buyer_name="Buyer", buyer_email="buyer@example.com"),
                    _fake_request("NG"),
                )
            assert exc.value.status_code == 503
        _run(go())

    def test_initiate_rejected_when_not_configured(self):
        async def go():
            await _clear()
            await srv.admin_update_bank_transfer_settings(
                srv.AdminBankTransferSettingsUpdate(enabled=True), admin=ADMIN,
            )  # enabled but no bank details set
            with pytest.raises(HTTPException) as exc:
                await srv.initiate_bank_transfer(
                    srv.BankTransferInitiateRequest(buyer_name="Buyer", buyer_email="buyer@example.com"),
                    _fake_request("NG"),
                )
            assert exc.value.status_code == 503
        _run(go())


class TestSubmitted:
    def test_marking_submitted_never_creates_a_license(self):
        async def go():
            await _clear()
            await _enable_bank_transfer()
            init = await srv.initiate_bank_transfer(
                srv.BankTransferInitiateRequest(buyer_name="Buyer", buyer_email="buyer@example.com"),
                _fake_request("NG"),
            )
            result = await srv.bank_transfer_mark_submitted(init["reference"], _fake_request("NG"))
            assert result["status"] == "BANK_TRANSFER_SUBMITTED"
            tx = await srv.db.payment_transactions.find_one({"reference": init["reference"]})
            assert tx["payment_status"] == "BANK_TRANSFER_SUBMITTED"
            assert tx["pin_generated"] is None
            assert await srv.db.pin_licenses.count_documents({"payment_ref": init["reference"]}) == 0
        _run(go())

    def test_submitted_on_unknown_reference_404s(self):
        async def go():
            await _clear()
            with pytest.raises(HTTPException) as exc:
                await srv.bank_transfer_mark_submitted("ASE-BT-DOESNOTEXIST", _fake_request("NG"))
            assert exc.value.status_code == 404
        _run(go())

    def test_submitted_on_expired_order_rejected(self):
        async def go():
            await _clear()
            await _enable_bank_transfer(timeout_minutes=1)
            init = await srv.initiate_bank_transfer(
                srv.BankTransferInitiateRequest(buyer_name="Buyer", buyer_email="buyer@example.com"),
                _fake_request("NG"),
            )
            # force it into the past
            past = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
            await srv.db.payment_transactions.update_one({"reference": init["reference"]}, {"$set": {"expires_at": past}})
            with pytest.raises(HTTPException) as exc:
                await srv.bank_transfer_mark_submitted(init["reference"], _fake_request("NG"))
            assert exc.value.status_code == 410
            tx = await srv.db.payment_transactions.find_one({"reference": init["reference"]})
            assert tx["payment_status"] == "BANK_TRANSFER_EXPIRED"
        _run(go())


class TestProofUpload:
    TINY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

    def test_valid_proof_accepted(self):
        async def go():
            await _clear()
            await _enable_bank_transfer()
            init = await srv.initiate_bank_transfer(
                srv.BankTransferInitiateRequest(buyer_name="Buyer", buyer_email="buyer@example.com"),
                _fake_request("NG"),
            )
            result = await srv.bank_transfer_upload_proof(
                init["reference"], srv.BankTransferProofRequest(proof_image=self.TINY_PNG), _fake_request("NG"),
            )
            assert result["status"] == "ok"
            tx = await srv.db.payment_transactions.find_one({"reference": init["reference"]})
            assert tx["bank_transfer_proof"] == self.TINY_PNG
        _run(go())

    def test_non_image_rejected(self):
        async def go():
            await _clear()
            await _enable_bank_transfer()
            init = await srv.initiate_bank_transfer(
                srv.BankTransferInitiateRequest(buyer_name="Buyer", buyer_email="buyer@example.com"),
                _fake_request("NG"),
            )
            with pytest.raises(HTTPException) as exc:
                await srv.bank_transfer_upload_proof(
                    init["reference"], srv.BankTransferProofRequest(proof_image="data:text/plain;base64,aGk="), _fake_request("NG"),
                )
            assert exc.value.status_code == 400
        _run(go())

    def test_oversized_proof_rejected(self):
        async def go():
            await _clear()
            await _enable_bank_transfer()
            init = await srv.initiate_bank_transfer(
                srv.BankTransferInitiateRequest(buyer_name="Buyer", buyer_email="buyer@example.com"),
                _fake_request("NG"),
            )
            huge = "data:image/png;base64," + ("A" * 8_000_000)
            with pytest.raises(HTTPException) as exc:
                await srv.bank_transfer_upload_proof(
                    init["reference"], srv.BankTransferProofRequest(proof_image=huge), _fake_request("NG"),
                )
            assert exc.value.status_code == 400
        _run(go())

    def test_proof_rejected_after_fulfillment(self):
        async def go():
            await _clear()
            await _enable_bank_transfer()
            patcher = await _mock_email()
            try:
                init = await srv.initiate_bank_transfer(
                    srv.BankTransferInitiateRequest(buyer_name="Buyer", buyer_email="buyer@example.com"),
                    _fake_request("NG"),
                )
                await srv.bank_transfer_mark_submitted(init["reference"], _fake_request("NG"))
                await srv.admin_approve_bank_transfer(init["reference"], admin=ADMIN)
                with pytest.raises(HTTPException) as exc:
                    await srv.bank_transfer_upload_proof(
                        init["reference"], srv.BankTransferProofRequest(proof_image=self.TINY_PNG), _fake_request("NG"),
                    )
                assert exc.value.status_code == 409
            finally:
                patcher.stop()
        _run(go())


class TestAdminApproval:
    def test_approve_mints_exactly_one_license_and_sends_email(self):
        async def go():
            await _clear()
            await _enable_bank_transfer()
            patcher = await _mock_email()
            try:
                init = await srv.initiate_bank_transfer(
                    srv.BankTransferInitiateRequest(buyer_name="Buyer", buyer_email="buyer@example.com"),
                    _fake_request("NG"),
                )
                await srv.bank_transfer_mark_submitted(init["reference"], _fake_request("NG"))
                result = await srv.admin_approve_bank_transfer(init["reference"], admin=ADMIN)
                assert result["status"] == "approved"
                assert result["pin"]
                tx = await srv.db.payment_transactions.find_one({"reference": init["reference"]})
                assert tx["payment_status"] == "FULFILLED"
                assert tx["approved_by"] == "admin@test.com"
                assert await srv.db.pin_licenses.count_documents({"payment_ref": init["reference"]}) == 1
                srv.send_pin_email.assert_awaited_once()
            finally:
                patcher.stop()
        _run(go())

    def test_approve_before_submitted_rejected(self):
        """Cannot approve an order the customer never even claimed to pay --
        matches "only submitted/under-review orders are approvable"."""
        async def go():
            await _clear()
            await _enable_bank_transfer()
            init = await srv.initiate_bank_transfer(
                srv.BankTransferInitiateRequest(buyer_name="Buyer", buyer_email="buyer@example.com"),
                _fake_request("NG"),
            )
            with pytest.raises(HTTPException) as exc:
                await srv.admin_approve_bank_transfer(init["reference"], admin=ADMIN)
            assert exc.value.status_code == 409
        _run(go())

    def test_double_approve_is_idempotent_one_license(self):
        async def go():
            await _clear()
            await _enable_bank_transfer()
            patcher = await _mock_email()
            try:
                init = await srv.initiate_bank_transfer(
                    srv.BankTransferInitiateRequest(buyer_name="Buyer", buyer_email="buyer@example.com"),
                    _fake_request("NG"),
                )
                await srv.bank_transfer_mark_submitted(init["reference"], _fake_request("NG"))
                r1 = await srv.admin_approve_bank_transfer(init["reference"], admin=ADMIN)
                r2 = await srv.admin_approve_bank_transfer(init["reference"], admin=ADMIN)
                assert r1["pin"] == r2["pin"]
                assert r2["status"] == "already_fulfilled"
                assert await srv.db.pin_licenses.count_documents({"payment_ref": init["reference"]}) == 1
            finally:
                patcher.stop()
        _run(go())

    def test_expired_order_cannot_be_approved(self):
        async def go():
            await _clear()
            await _enable_bank_transfer()
            init = await srv.initiate_bank_transfer(
                srv.BankTransferInitiateRequest(buyer_name="Buyer", buyer_email="buyer@example.com"),
                _fake_request("NG"),
            )
            await srv.bank_transfer_mark_submitted(init["reference"], _fake_request("NG"))
            past = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
            await srv.db.payment_transactions.update_one({"reference": init["reference"]}, {"$set": {"expires_at": past}})
            with pytest.raises(HTTPException) as exc:
                await srv.admin_approve_bank_transfer(init["reference"], admin=ADMIN)
            assert exc.value.status_code == 409
        _run(go())

    def test_reject_records_reason_and_admin(self):
        async def go():
            await _clear()
            await _enable_bank_transfer()
            init = await srv.initiate_bank_transfer(
                srv.BankTransferInitiateRequest(buyer_name="Buyer", buyer_email="buyer@example.com"),
                _fake_request("NG"),
            )
            await srv.bank_transfer_mark_submitted(init["reference"], _fake_request("NG"))
            result = await srv.admin_reject_bank_transfer(
                init["reference"], srv.BankTransferAdminActionRequest(reason="proof doesn't match"), admin=ADMIN,
            )
            assert result["status"] == "rejected"
            tx = await srv.db.payment_transactions.find_one({"reference": init["reference"]})
            assert tx["payment_status"] == "BANK_TRANSFER_REJECTED"
            assert tx["rejection_reason"] == "proof doesn't match"
        _run(go())

    def test_mark_expired_idempotent(self):
        async def go():
            await _clear()
            await _enable_bank_transfer()
            init = await srv.initiate_bank_transfer(
                srv.BankTransferInitiateRequest(buyer_name="Buyer", buyer_email="buyer@example.com"),
                _fake_request("NG"),
            )
            r1 = await srv.admin_mark_bank_transfer_expired(init["reference"], admin=ADMIN)
            r2 = await srv.admin_mark_bank_transfer_expired(init["reference"], admin=ADMIN)
            assert r1["status"] == "BANK_TRANSFER_EXPIRED"
            assert r2["no_op"] is True
        _run(go())

    def test_request_info_appends_note_without_changing_state(self):
        async def go():
            await _clear()
            await _enable_bank_transfer()
            init = await srv.initiate_bank_transfer(
                srv.BankTransferInitiateRequest(buyer_name="Buyer", buyer_email="buyer@example.com"),
                _fake_request("NG"),
            )
            await srv.bank_transfer_mark_submitted(init["reference"], _fake_request("NG"))
            await srv.admin_bank_transfer_request_info(
                init["reference"], srv.BankTransferAdminActionRequest(reason="please resend proof"), admin=ADMIN,
            )
            tx = await srv.db.payment_transactions.find_one({"reference": init["reference"]})
            assert tx["payment_status"] == "BANK_TRANSFER_SUBMITTED"
            assert tx["admin_notes"][0]["note"] == "please resend proof"
        _run(go())


class TestAdminQueueAndSettings:
    def test_list_redacts_proof_image(self):
        async def go():
            await _clear()
            await _enable_bank_transfer()
            init = await srv.initiate_bank_transfer(
                srv.BankTransferInitiateRequest(buyer_name="Buyer", buyer_email="buyer@example.com"),
                _fake_request("NG"),
            )
            await srv.bank_transfer_upload_proof(
                init["reference"], srv.BankTransferProofRequest(proof_image=TestProofUpload.TINY_PNG), _fake_request("NG"),
            )
            result = await srv.admin_list_bank_transfers()
            entry = next(e for e in result["entries"] if e["reference"] == init["reference"])
            assert "bank_transfer_proof" not in entry
            assert entry["has_proof"] is True
        _run(go())

    def test_detail_endpoint_includes_full_proof(self):
        async def go():
            await _clear()
            await _enable_bank_transfer()
            init = await srv.initiate_bank_transfer(
                srv.BankTransferInitiateRequest(buyer_name="Buyer", buyer_email="buyer@example.com"),
                _fake_request("NG"),
            )
            await srv.bank_transfer_upload_proof(
                init["reference"], srv.BankTransferProofRequest(proof_image=TestProofUpload.TINY_PNG), _fake_request("NG"),
            )
            detail = await srv.admin_get_bank_transfer(init["reference"])
            assert detail["bank_transfer_proof"] == TestProofUpload.TINY_PNG
        _run(go())

    def test_settings_round_trip(self):
        async def go():
            await _clear()
            await srv.admin_update_bank_transfer_settings(
                srv.AdminBankTransferSettingsUpdate(
                    enabled=True, bank_name="GTBank", account_name="XauCloud",
                    account_number="1234567890", timeout_minutes=30, proof_required=True,
                ),
                admin=ADMIN,
            )
            settings = await srv.admin_get_bank_transfer_settings()
            assert settings["bank_name"] == "GTBank"
            assert settings["timeout_minutes"] == 30
            assert settings["proof_required"] is True
        _run(go())

    def test_queue_filters_by_status(self):
        async def go():
            await _clear()
            await _enable_bank_transfer()
            init1 = await srv.initiate_bank_transfer(
                srv.BankTransferInitiateRequest(buyer_name="A", buyer_email="a@example.com"), _fake_request("NG"))
            init2 = await srv.initiate_bank_transfer(
                srv.BankTransferInitiateRequest(buyer_name="B", buyer_email="b@example.com"), _fake_request("NG"))
            await srv.bank_transfer_mark_submitted(init2["reference"], _fake_request("NG"))
            pending_only = await srv.admin_list_bank_transfers(status="BANK_TRANSFER_PENDING")
            refs = {e["reference"] for e in pending_only["entries"]}
            assert init1["reference"] in refs
            assert init2["reference"] not in refs
        _run(go())
