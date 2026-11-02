"""Regression tests for retired legacy payment initiation in the Python service.

Old Paystack/Nomba/bank records must remain reconcilable, but no
new NGN-first orders or old payment-method configuration is accepted.
"""
import sys
import os
import uuid
import asyncio
from unittest.mock import MagicMock

import pytest

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

def _mongo_available():
    try:
        from pymongo import MongoClient
        MongoClient("mongodb://localhost:27017", serverSelectionTimeoutMS=800).admin.command("ping")
        return True
    except Exception:
        return False

pytestmark = pytest.mark.skipif(not _mongo_available(), reason="local MongoDB unavailable")
TEST_DB = "payment_retirement_pytest_" + uuid.uuid4().hex[:10]
os.environ["MONGO_URL"] = "mongodb://localhost:27017"
os.environ["DB_NAME"] = TEST_DB
os.environ.setdefault("JWT_SECRET", "test-secret-payment-retirement")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")

import server as srv  # noqa: E402
from fastapi import HTTPException  # noqa: E402

_LOOP = asyncio.new_event_loop()
def _run(coroutine):
    return _LOOP.run_until_complete(coroutine)

def request(country="NG"):
    req = MagicMock()
    req.headers = {"cf-ipcountry": country}
    req.client = MagicMock(host=f"127.0.0.{uuid.uuid4().int % 250 + 1}")
    return req

async def reset():
    await srv.db.admin_settings.delete_many({})
    await srv.db.payment_transactions.delete_many({})

def test_legacy_public_payment_methods_no_longer_offer_providers():
    async def go():
        await reset()
        out = await srv.list_payment_methods(request())
        assert out["methods"] == []
        assert out["default_method"] is None
        assert out["retired"] is True
    _run(go())

def test_unconfigured_usd_price_fails_closed():
    async def go():
        await reset()
        out = await srv.get_pin_price(request("US"))
        assert out["currency"] == "USD"
        assert out["price_usd_cents"] is None
        assert out["payment_method"] == "unavailable"
    _run(go())

def test_admin_usd_price_remains_authoritative_over_old_naira():
    async def go():
        await reset()
        await srv.db.admin_settings.insert_one({
            "key": "main", "direct_usd_cents": 12999, "pin_price_kobo": 30000000,
            "paystack_secret_key": "historical-token-do-not-use-for-new-orders",
        })
        price = await srv.get_pin_price(request("US"))
        assert price["currency"] == "USD"
        assert price["price_usd_cents"] == 12999
        assert price["formatted"] == "USD 129.99"
        assert price["payment_method"] == "manual_direct"
        assert await srv.db.payment_transactions.count_documents({}) == 0
    _run(go())

@pytest.mark.parametrize("endpoint", [
    "initialize_purchase",
    "initialize_paystack_purchase",
])
def test_legacy_provider_init_returns_410_without_new_transaction(endpoint):
    async def go():
        await reset()
        req = srv.PurchaseInitRequest(buyer_name="Buyer", buyer_email="buyer@example.com", origin_url="https://attacker.example")
        with pytest.raises(HTTPException) as exc:
            await getattr(srv, endpoint)(req, request())
        assert exc.value.status_code == 410
        assert await srv.db.payment_transactions.count_documents({}) == 0
    _run(go())

def test_legacy_bank_init_refused_even_when_enabled():
    async def go():
        await reset()
        await srv.db.admin_settings.insert_one({
            "key": "main", "bank_transfer_enabled": True, "bank_transfer_bank_name": "TEST",
            "bank_transfer_account_name": "XauCloud", "bank_transfer_account_number": "0000000000",
        })
        with pytest.raises(HTTPException) as exc:
            await srv.initiate_bank_transfer(
                srv.BankTransferInitiateRequest(buyer_name="Buyer", buyer_email="buyer@example.com"), request())
        assert exc.value.status_code == 410
        assert await srv.db.payment_transactions.count_documents({}) == 0
    _run(go())

def test_retired_provider_switch_cannot_be_reenabled_by_admin():
    async def go():
        await reset()
        with pytest.raises(HTTPException) as exc:
            await srv.admin_update_payment_methods_settings(
                srv.AdminPaymentMethodsSettingsUpdate(nomba_enabled=True, paystack_enabled=True),
                admin={"email": "admin@test.com"})
        assert exc.value.status_code == 410
    _run(go())
