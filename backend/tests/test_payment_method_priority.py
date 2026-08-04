"""Tests for the payment-method priority/availability system: Manual Bank
Transfer first and default, Paystack second and fully active, Nomba last
and disabled by default until provider approval. Covers the rebuilt
standalone Paystack checkout-initiation flow (deleted during the Nomba
migration, rebuilt here) and failure isolation between providers.
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

TEST_DB = f"payment_priority_pytest_{uuid.uuid4().hex[:10]}"
os.environ["MONGO_URL"] = "mongodb://localhost:27017"
os.environ["DB_NAME"] = TEST_DB
os.environ.setdefault("JWT_SECRET", "test-secret-payment-priority")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")

import server as srv  # noqa: E402
from fastapi import HTTPException  # noqa: E402

_LOOP = asyncio.new_event_loop()


def _run(coro):
    return _LOOP.run_until_complete(coro)


ADMIN = {"email": "admin@test.com", "role": "admin"}


def _fake_request(country="NG"):
    req = MagicMock()
    req.headers = {"cf-ipcountry": country} if country else {}
    req.client = MagicMock(host=f"127.0.0.{uuid.uuid4().int % 250 + 1}")
    return req


async def _clear():
    await srv.db.payment_transactions.delete_many({})
    await srv.db.admin_settings.delete_many({})
    await srv.db.payment_config_audit_log.delete_many({})


async def _enable_bank_transfer():
    await srv.admin_update_bank_transfer_settings(
        srv.AdminBankTransferSettingsUpdate(
            enabled=True, bank_name="Test Bank", account_name="XauCloud Ltd", account_number="0123456789",
        ),
        admin=ADMIN,
    )


class TestDefaultConfiguration:
    def test_default_settings_match_owner_directive(self):
        async def go():
            await _clear()
            settings = await srv._get_payment_methods_settings()
            assert settings["paystack_enabled"] is True
            assert settings["nomba_enabled"] is False
            assert settings["default_payment_method"] == "bank_transfer"
            assert settings["payment_method_order"] == ["bank_transfer", "paystack", "nomba"]
        _run(go())

    def test_list_payment_methods_order_and_labels(self):
        async def go():
            await _clear()
            result = await srv.list_payment_methods(_fake_request("NG"))
            methods = [m["method"] for m in result["methods"]]
            assert methods == ["bank_transfer", "paystack", "nomba"]
            nomba = next(m for m in result["methods"] if m["method"] == "nomba")
            assert "Awaiting approval" in nomba["description"] or "not currently available" in nomba["description"].lower()
        _run(go())

    def test_nomba_unavailable_by_default_even_if_credentials_exist(self):
        async def go():
            await _clear()
            with patch.object(srv, "get_active_nomba_credentials", AsyncMock(return_value=({}, MagicMock()))):
                availability = await srv._payment_method_availability(_fake_request("NG"))
            assert availability["nomba"] is False  # disabled flag wins even with valid creds
        _run(go())


class TestAvailabilityPerVisitor:
    def test_bank_transfer_available_for_nigeria_when_configured(self):
        async def go():
            await _clear()
            await _enable_bank_transfer()
            availability = await srv._payment_method_availability(_fake_request("NG"))
            assert availability["bank_transfer"] is True
        _run(go())

    def test_bank_transfer_unavailable_for_non_nigeria(self):
        async def go():
            await _clear()
            await _enable_bank_transfer()
            availability = await srv._payment_method_availability(_fake_request("US"))
            assert availability["bank_transfer"] is False
        _run(go())

    def test_default_method_falls_back_when_bank_transfer_unavailable(self):
        async def go():
            await _clear()
            # bank transfer never enabled -> default "bank_transfer" isn't available
            result = await srv.list_payment_methods(_fake_request("US"))
            # paystack has no secret key configured in this clean test DB either,
            # so nothing is available -- default_method should be None, never a
            # method the visitor can't actually use.
            assert result["default_method"] in (None, "paystack")
            if result["default_method"]:
                chosen = next(m for m in result["methods"] if m["method"] == result["default_method"])
                assert chosen["available"] is True
        _run(go())

    def test_paystack_available_once_secret_key_configured(self):
        async def go():
            await _clear()
            await srv.db.admin_settings.update_one({"key": "main"}, {"$set": {"paystack_secret_key": "sk_test_fake"}}, upsert=True)
            availability = await srv._payment_method_availability(_fake_request("US"))
            assert availability["paystack"] is True
        _run(go())


class TestFailureIsolation:
    def test_nomba_exception_does_not_break_availability_check(self):
        async def go():
            await _clear()
            await srv.admin_update_payment_methods_settings(
                srv.AdminPaymentMethodsSettingsUpdate(nomba_enabled=True), admin=ADMIN,
            )
            with patch.object(srv, "get_active_nomba_credentials", AsyncMock(side_effect=Exception("nomba is down"))):
                availability = await srv._payment_method_availability(_fake_request("NG"))
            assert availability["nomba"] is False
            # bank_transfer/paystack checks must still have run normally, not been skipped
            assert "bank_transfer" in availability and "paystack" in availability
        _run(go())

    def test_nomba_exception_does_not_break_full_listing_endpoint(self):
        async def go():
            await _clear()
            await _enable_bank_transfer()
            await srv.admin_update_payment_methods_settings(
                srv.AdminPaymentMethodsSettingsUpdate(nomba_enabled=True), admin=ADMIN,
            )
            with patch.object(srv, "get_active_nomba_credentials", AsyncMock(side_effect=Exception("nomba is down"))):
                result = await srv.list_payment_methods(_fake_request("NG"))
            assert len(result["methods"]) == 3
            bank_transfer = next(m for m in result["methods"] if m["method"] == "bank_transfer")
            assert bank_transfer["available"] is True  # unaffected by Nomba's failure
        _run(go())

    def test_disabled_nomba_rejects_direct_initialize_call(self):
        async def go():
            await _clear()
            with pytest.raises(HTTPException) as exc:
                await srv.initialize_purchase(
                    srv.PurchaseInitRequest(buyer_name="Buyer", buyer_email="buyer@example.com", origin_url="https://evil.example"),
                    _fake_request("NG"),
                )
            assert exc.value.status_code == 503
        _run(go())


class TestPaystackInitiate:
    def test_paystack_initialize_rejected_when_disabled(self):
        async def go():
            await _clear()
            await srv.admin_update_payment_methods_settings(
                srv.AdminPaymentMethodsSettingsUpdate(paystack_enabled=False), admin=ADMIN,
            )
            with pytest.raises(HTTPException) as exc:
                await srv.initialize_paystack_purchase(
                    srv.PurchaseInitRequest(buyer_name="Buyer", buyer_email="buyer@example.com", origin_url="https://evil.example"),
                    _fake_request("NG"),
                )
            assert exc.value.status_code == 503
        _run(go())

    def test_paystack_initialize_rejected_when_no_secret_key(self):
        async def go():
            await _clear()
            with pytest.raises(HTTPException) as exc:
                await srv.initialize_paystack_purchase(
                    srv.PurchaseInitRequest(buyer_name="Buyer", buyer_email="buyer@example.com", origin_url="https://evil.example"),
                    _fake_request("NG"),
                )
            assert exc.value.status_code == 503
        _run(go())

    def test_paystack_initialize_ignores_client_supplied_origin(self):
        async def go():
            await _clear()
            await srv.db.admin_settings.update_one({"key": "main"}, {"$set": {"paystack_secret_key": "sk_test_fake"}}, upsert=True)
            mock_resp = MagicMock()
            mock_resp.status_code = 200
            mock_resp.json.return_value = {"status": True, "data": {"authorization_url": "https://paystack.co/pay/abc"}}
            mock_client = AsyncMock()
            mock_client.post = AsyncMock(return_value=mock_resp)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            with patch.object(srv.httpx, "AsyncClient", return_value=mock_client):
                await srv.initialize_paystack_purchase(
                    srv.PurchaseInitRequest(buyer_name="Buyer", buyer_email="buyer@example.com", origin_url="https://evil.example"),
                    _fake_request("NG"),
                )
            call_kwargs = mock_client.post.call_args.kwargs
            assert "evil.example" not in call_kwargs["json"]["callback_url"]
            assert call_kwargs["json"]["callback_url"].startswith(srv.PUBLIC_SITE_URL)
        _run(go())

    def test_paystack_initialize_creates_pending_order_with_correct_provider(self):
        async def go():
            await _clear()
            await srv.db.admin_settings.update_one({"key": "main"}, {"$set": {"paystack_secret_key": "sk_test_fake"}}, upsert=True)
            mock_resp = MagicMock()
            mock_resp.status_code = 200
            mock_resp.json.return_value = {"status": True, "data": {"authorization_url": "https://paystack.co/pay/abc"}}
            mock_client = AsyncMock()
            mock_client.post = AsyncMock(return_value=mock_resp)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            with patch.object(srv.httpx, "AsyncClient", return_value=mock_client):
                result = await srv.initialize_paystack_purchase(
                    srv.PurchaseInitRequest(buyer_name="Buyer", buyer_email="buyer@example.com", origin_url="https://example.com"),
                    _fake_request("NG"),
                )
            tx = await srv.db.payment_transactions.find_one({"reference": result["reference"]})
            assert tx["provider"] == "PAYSTACK"
            assert tx["payment_status"] == "PENDING"
            assert tx["amount_kobo"] == 30000000
        _run(go())

    def test_paystack_initialize_marks_failed_on_provider_error(self):
        async def go():
            await _clear()
            await srv.db.admin_settings.update_one({"key": "main"}, {"$set": {"paystack_secret_key": "sk_test_fake"}}, upsert=True)
            mock_resp = MagicMock()
            mock_resp.status_code = 400
            mock_client = AsyncMock()
            mock_client.post = AsyncMock(return_value=mock_resp)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            with patch.object(srv.httpx, "AsyncClient", return_value=mock_client):
                with pytest.raises(HTTPException) as exc:
                    await srv.initialize_paystack_purchase(
                        srv.PurchaseInitRequest(buyer_name="Buyer", buyer_email="buyer@example.com", origin_url="https://example.com"),
                        _fake_request("NG"),
                    )
            assert exc.value.status_code == 502
        _run(go())


class TestAdminSettingsValidation:
    def test_rejects_unknown_default_method(self):
        async def go():
            await _clear()
            with pytest.raises(HTTPException) as exc:
                await srv.admin_update_payment_methods_settings(
                    srv.AdminPaymentMethodsSettingsUpdate(default_payment_method="bitcoin"), admin=ADMIN,
                )
            assert exc.value.status_code == 400
        _run(go())

    def test_rejects_unknown_method_in_order(self):
        async def go():
            await _clear()
            with pytest.raises(HTTPException) as exc:
                await srv.admin_update_payment_methods_settings(
                    srv.AdminPaymentMethodsSettingsUpdate(payment_method_order=["bank_transfer", "bitcoin"]), admin=ADMIN,
                )
            assert exc.value.status_code == 400
        _run(go())

    def test_settings_round_trip_and_audit_log(self):
        async def go():
            await _clear()
            await srv.admin_update_payment_methods_settings(
                srv.AdminPaymentMethodsSettingsUpdate(nomba_enabled=True, default_payment_method="paystack"), admin=ADMIN,
            )
            settings = await srv._get_payment_methods_settings()
            assert settings["nomba_enabled"] is True
            assert settings["default_payment_method"] == "paystack"
            entry = await srv.db.payment_config_audit_log.find_one({"provider": "PAYMENT_METHODS"})
            assert entry["admin_email"] == "admin@test.com"
            assert "nomba_enabled" in entry["changed_fields"]
        _run(go())
