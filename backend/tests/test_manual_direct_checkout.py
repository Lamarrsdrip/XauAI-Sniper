"""Integration checks for USD-first direct manual checkout with local Mongo.

No external transfers, real wallet ownership claims, or SMTP are invoked.
"""
import asyncio
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_manual_direct")
os.environ.setdefault("JWT_SECRET", "test-only-secret")
os.environ.setdefault("ENVIRONMENT", "test")

import server as srv  # noqa: E402
from manual_direct_checkout import Quote, Submitted, Review  # noqa: E402

def mongo_available():
    try:
        from pymongo import MongoClient
        MongoClient("mongodb://localhost:27017", serverSelectionTimeoutMS=600).admin.command("ping")
        return True
    except Exception:
        return False

pytestmark = pytest.mark.skipif(not mongo_available(), reason="MongoDB needed")

_loop = asyncio.new_event_loop()
def run(coro):
    return _loop.run_until_complete(coro)

def request():
    req = MagicMock()
    req.headers = {}
    req.client = MagicMock(host="127.0.0." + str(uuid.uuid4().int % 240 + 1))
    return req

def handler(path):
    return next(r.endpoint for r in srv.api_router.routes if r.path == path or r.path == '/api' + path)

BASE = {
    "direct_usd_cents": 10000, "direct_bank_enabled": True,
    "direct_crypto_enabled": True, "direct_crypto_countries": ["US"],
    "direct_wallets": [{"asset": "USDT", "network": "ERC20",
                         "address": "0x" + "a" * 40}],
    "direct_usd_ngn_rate": "1500.50",
    "direct_fx_as_of": datetime.now(timezone.utc).isoformat(),
    "bank_transfer_enabled": True, "bank_transfer_bank_name": "Test Bank",
    "bank_transfer_account_name": "XauCloud Test",
    "bank_transfer_account_number": "0000000000",
}

async def reset(overrides=None):
    await srv.db.payment_transactions.delete_many({"provider": "MANUAL_DIRECT"})
    await srv.db.pin_licenses.delete_many({"provider": "MANUAL_DIRECT"})
    await srv.db.cloud_signal_trials.delete_many({"email": "directtrial@example.com"})
    await srv.db.payment_review_log.delete_many({})
    await srv.db.admin_settings.update_one(
        {"key": "main"}, {"$set": {**BASE, **(overrides or {})}}, upsert=True)

async def bank_quote():
    return await handler("/purchase/direct/quote")(
        Quote(country="NG", buyer_name="Test Buyer", buyer_email="buyer@example.com"), request())

async def crypto_quote(**kwargs):
    return await handler("/purchase/direct/quote")(
        Quote(country=kwargs.get("country", "US"), buyer_name="Test Buyer",
              buyer_email="buyer@example.com", asset=kwargs.get("asset", "USDT"),
              network=kwargs.get("network", "ERC20"), method=kwargs.get("method", "")), request())

class TestDirectCheckout:
    def test_usd_source_and_exact_ngn_integer_quote(self):
        async def go():
            await reset()
            info = await handler("/purchase/direct/config")(request())
            assert info["currency"] == "USD"
            assert info["price_formatted"] == "USD 100.00"
            order = await bank_quote()
            assert order["amount_minor"] == 15005000
            assert order["amount_formatted"] == "NGN 150,050.00"
            assert order["details"]["fx_rate"] == "1500.50"
            record = await srv.db.payment_transactions.find_one({"reference": order["reference"]})
            assert record["currency"] == "NGN"
            assert record["price_usd_cents"] == 10000
            assert record["pin_generated"] is None
            assert record["expires_at"] > record["created_at"]
        run(go())

    def test_unconfigured_price_fails_closed(self):
        async def go():
            await reset({"direct_usd_cents": None})
            with pytest.raises(HTTPException) as exc:
                await bank_quote()
            assert exc.value.status_code == 503
            assert await srv.db.payment_transactions.count_documents({"provider": "MANUAL_DIRECT"}) == 0
        run(go())

    def test_stale_fx_fails_closed(self):
        async def go():
            await reset({"direct_fx_as_of": (datetime.now(timezone.utc)-timedelta(days=3)).isoformat()})
            with pytest.raises(HTTPException) as exc:
                await bank_quote()
            assert exc.value.status_code == 503
        run(go())

    def test_missing_bank_fails_closed(self):
        async def go():
            await reset({"bank_transfer_account_number": ""})
            with pytest.raises(HTTPException) as exc:
                await bank_quote()
            assert exc.value.status_code == 503
        run(go())

    def test_crypto_allowlisted_asset_network_and_wallet(self):
        async def go():
            await reset()
            order = await crypto_quote()
            assert order["method"] == "CRYPTO"
            assert order["currency"] == "USDT"
            assert order["amount_formatted"] == "100.00 USDT"
            assert order["details"]["network"] == "ERC20"
            france = await crypto_quote(country="FR")
            assert france["method"] == "CRYPTO"
            nigeria = await crypto_quote(country="NG", method="CRYPTO")
            assert nigeria["method"] == "CRYPTO"
            with pytest.raises(HTTPException) as bank_only:
                await crypto_quote(country="DE", method="BANK")
            assert bank_only.value.status_code == 403
            with pytest.raises(HTTPException) as unsupported:
                await crypto_quote(network="TRC20")
            assert unsupported.value.status_code == 503
        run(go())

    def test_buyer_gets_exact_payment_email_and_retry_is_bounded(self):
        async def go():
            await reset()
            sent = []
            real_mail = srv._send_email
            async def fake_send(address, subject, html):
                sent.append((address, subject, html))
                return True
            srv._send_email = fake_send
            try:
                bank = await bank_quote()
                assert bank["instructions_email_sent"] is True
                assert sent[-1][0] == "buyer@example.com"
                assert bank["amount_formatted"] in sent[-1][2]
                assert bank["details"]["account_number"] in sent[-1][2]
                assert bank["reference"] in sent[-1][2]
                assert "not yet paid or approved" in sent[-1][2]
                crypto = await crypto_quote()
                assert crypto["instructions_email_sent"] is True
                assert crypto["details"]["address"] in sent[-1][2]
                assert crypto["details"]["network"] in sent[-1][2]
                resend = handler("/purchase/direct/{reference}/resend-instructions")
                assert (await resend(bank["reference"], request()))["sent"] is True
                assert (await resend(bank["reference"], request()))["sent"] is True
                with pytest.raises(HTTPException) as limited:
                    await resend(bank["reference"], request())
                assert limited.value.status_code == 429
                assert len(sent) == 4
                assert await srv.db.pin_licenses.count_documents({"payment_ref": bank["reference"]}) == 0
                await srv.db.payment_transactions.update_one(
                    {"reference": crypto["reference"]},
                    {"$set": {"expires_at": (datetime.now(timezone.utc)-timedelta(minutes=1)).isoformat()}})
                with pytest.raises(HTTPException) as expired:
                    await resend(crypto["reference"], request())
                assert expired.value.status_code == 409
            finally:
                srv._send_email = real_mail
        run(go())

    def test_payment_submission_does_not_activate_license(self):
        async def go():
            await reset()
            order = await bank_quote()
            result = await handler("/purchase/direct/{reference}/submit")(
                order["reference"], Submitted(sender_account_name="Adaeze Okonkwo"), request())
            assert result["status"] == "MANUAL_SUBMITTED"
            assert await srv.db.pin_licenses.count_documents({"payment_ref": order["reference"]}) == 0
            record = await srv.db.payment_transactions.find_one({"reference": order["reference"]})
            assert record["pin_generated"] is None
            assert record["payment_status"] == "MANUAL_SUBMITTED"
            assert record["sender_account_name"] == "Adaeze Okonkwo"
        run(go())

    def test_same_sender_name_is_allowed_and_crypto_hash_is_not(self):
        async def go():
            await reset()
            a, b = await bank_quote(), await bank_quote()
            submit = handler("/purchase/direct/{reference}/submit")
            await submit(a["reference"], Submitted(sender_account_name="Adaeze Okonkwo"), request())
            again = await submit(b["reference"], Submitted(sender_account_name="Adaeze Okonkwo"), request())
            assert again["status"] == "MANUAL_SUBMITTED"
            first, second = await crypto_quote(), await crypto_quote()
            tx = "0x" + "ab" * 32
            await submit(first["reference"], Submitted(payment_reference=tx), request())
            with pytest.raises(HTTPException) as exc:
                await submit(second["reference"], Submitted(payment_reference=tx), request())
            assert exc.value.status_code == 409
        run(go())

    def test_expired_quote_cannot_be_submitted(self):
        async def go():
            await reset()
            order = await bank_quote()
            await srv.db.payment_transactions.update_one(
                {"reference": order["reference"]}, {"$set": {"expires_at": (datetime.now(timezone.utc)-timedelta(hours=1)).isoformat()}})
            with pytest.raises(HTTPException) as exc:
                await handler("/purchase/direct/{reference}/submit")(
                    order["reference"], Submitted(sender_account_name="Chinedu Okafor"), request())
            assert exc.value.status_code == 409
            record = await srv.db.payment_transactions.find_one({"reference": order["reference"]})
            assert record["payment_status"] == "MANUAL_EXPIRED"
        run(go())

    def test_admin_approval_exactly_once(self):
        async def go():
            await reset()
            order = await bank_quote()
            await handler("/purchase/direct/{reference}/submit")(
                order["reference"], Submitted(sender_account_name="Test Buyer"), request())
            approve = handler("/admin/direct-checkout/{reference}/approve")
            review = Review(evidence_reference="VERIFIED-BANK-TXN-1",
                            verification_notes="Verified exact amount, beneficiary and transfer in official bank statement.")
            result = await approve(order["reference"], review, admin={"email": "admin@test.com"})
            assert result["status"] == "FULFILLED"
            assert await srv.db.pin_licenses.count_documents({"payment_ref": order["reference"]}) == 1
            again = await approve(order["reference"], review, admin={"email": "admin@test.com"})
            assert again["status"] == "already_fulfilled"
            assert await srv.db.pin_licenses.count_documents({"payment_ref": order["reference"]}) == 1
        run(go())

    def test_trial_once_with_server_expiry(self):
        async def go():
            await reset()
            user = {"id": "directtrial-test-user", "email": "directtrial@example.com"}
            start = handler("/cloud/signals/trial/start")
            outcome = await start(request(), user=user)
            assert outcome["status"] == "active"
            assert outcome["auto_renew"] is False
            with pytest.raises(HTTPException) as exc:
                await start(request(), user=user)
            assert exc.value.status_code == 409
            await srv.db.cloud_signal_trials.update_one(
                {"user_id": user["id"]},
                {"$set": {"expires_at": (datetime.now(timezone.utc)-timedelta(hours=1)).isoformat()}})
            status = await handler("/cloud/signals/trial/status")(user=user)
            assert status["status"] == "expired"
        run(go())
