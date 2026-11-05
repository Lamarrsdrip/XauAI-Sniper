"""Real FastAPI routes with isolated storage; never contacts production or SMTP."""
import asyncio
import copy
import logging
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from pymongo.errors import DuplicateKeyError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from manual_direct_checkout import build_router


def matches(doc, query):
    for field, expected in query.items():
        if field == "$or":
            if not any(matches(doc, clause) for clause in expected):
                return False
        elif field == "$and":
            if not all(matches(doc, clause) for clause in expected):
                return False
        elif isinstance(expected, dict):
            actual = doc.get(field)
            for op, value in expected.items():
                if op == "$exists" and (field in doc) != value:
                    return False
                if op == "$in" and actual not in value:
                    return False
                if op == "$ne" and actual == value:
                    return False
                if op == "$lt" and (actual is None or actual >= value):
                    return False
                if op == "$regex" and not re.search(value, str(actual or ""), re.I if expected.get("$options") == "i" else 0):
                    return False
        elif doc.get(field) != expected:
            return False
    return True


class Cursor:
    def __init__(self, docs): self.docs = copy.deepcopy(docs)
    def sort(self, field, direction): self.docs.sort(key=lambda x: x.get(field, ""), reverse=direction < 0); return self
    def skip(self, count): self.docs = self.docs[count:]; return self
    def limit(self, count): self.docs = self.docs[:count]; return self
    async def to_list(self, count): return self.docs[:count]


class Collection:
    def __init__(self): self.docs = []; self.unique = []; self.fail_insert = False
    async def create_index(self, key, **options):
        if options.get("unique") and isinstance(key, str) and key not in self.unique: self.unique.append(key)
    async def find_one(self, query, projection=None):
        return next((copy.deepcopy(d) for d in self.docs if matches(d, query)), None)
    def find(self, query, projection=None):
        return Cursor([d for d in self.docs if matches(d, query)])
    async def count_documents(self, query): return sum(matches(d, query) for d in self.docs)
    async def insert_one(self, doc):
        if self.fail_insert: self.fail_insert = False; raise RuntimeError("injected write failure")
        for key in self.unique:
            if doc.get(key) is not None and any(d.get(key) == doc[key] for d in self.docs): raise DuplicateKeyError("duplicate")
        self.docs.append(copy.deepcopy(doc))
    async def update_one(self, query, update, upsert=False):
        doc = next((d for d in self.docs if matches(d, query)), None)
        if doc is None:
            if not upsert: return SimpleNamespace(modified_count=0, matched_count=0)
            doc = copy.deepcopy(query); doc.update(copy.deepcopy(update.get("$setOnInsert", {}))); self.docs.append(doc)
        for key, value in update.get("$set", {}).items(): doc[key] = copy.deepcopy(value)
        for key, value in update.get("$addToSet", {}).items():
            if value not in doc.setdefault(key, []): doc[key].append(value)
        return SimpleNamespace(modified_count=1, matched_count=1)


class License(BaseModel):
    pin: str
    buyer_name: str
    buyer_email: str
    notes: str
    payment_ref: str
    is_active: bool = True
    is_used: bool = False


def system(authorized=True):
    db = SimpleNamespace(**{key: Collection() for key in (
        "payment_transactions", "pin_licenses", "payment_review_log", "cloud_users", "admin_settings", "payment_config_audit_log")})
    delivery = SimpleNamespace(result={"ok": True}, sends=0)
    async def admin():
        if not authorized: raise HTTPException(403, "Administrator required")
        return {"email": "owner@example.com"}
    async def send(*args):
        delivery.sends += 1
        await asyncio.sleep(0)
        return delivery.result
    app = FastAPI()
    app.include_router(build_router(
        db=db, get_settings=AsyncMock(return_value={}), admin_dep=admin, user_dep=admin,
        rate_limit=lambda *args: None, client_ip=lambda request: "127.0.0.1",
        generate_pin=lambda: "ASE-ABCD-EFGH", PinLicense=License, send_pin_email=AsyncMock(return_value=True),
        record_email_result=AsyncMock(), notify_started=AsyncMock(), notify_sale=AsyncMock(),
        logger=logging.getLogger(__name__), send_pin_email_detailed=send))
    return db, delivery, httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


async def seed(db, **overrides):
    order = {"reference": "XC-TESTEXISTING2500001", "provider": "MANUAL_DIRECT", "country": "US", "method": "CRYPTO",
             "buyer_name": "Test Buyer", "buyer_email": "testbuyer@example.com", "price_usd_cents": 25000,
             "currency": "USDT", "amount_minor": 25000, "payment_status": "MANUAL_SUBMITTED",
             "quote_details": {"asset": "USDT", "network": "ERC20", "address": "0x" + "a" * 40},
             "created_at": datetime.now(timezone.utc).isoformat(), **overrides}
    await db.payment_transactions.insert_one(order)
    await db.cloud_users.insert_one({"id": "customer", "email": "testbuyer@example.com"})
    return "/admin/direct-checkout/" + order["reference"]


def test_no_fields_approval_activates_and_links_one_official_license():
    async def scenario():
        db, delivery, client = system()
        url = await seed(db)
        async with client:
            response = await client.post(url + "/approve")
            assert response.status_code == 200, response.text
            assert response.json() == {"status": "FULFILLED", "license_status": "ISSUED", "account_link_status": "LINKED", "fulfillment_email_status": "SENT"}
            user = await db.cloud_users.find_one({"id": "customer"})
            assert user["license_key"] == "ASE-ABCD-EFGH" == user["command_license_key"]
            assert db.pin_licenses.docs[0]["is_active"] is True
            assert db.payment_transactions.docs[0]["approved_by"] == "owner@example.com"
            assert db.payment_transactions.docs[0]["approved_at"]
            assert db.payment_review_log.docs[0]["action"] == "APPROVE"
            assert delivery.sends == 1
    asyncio.run(scenario())


def test_duplicate_clicks_and_retry_do_not_duplicate_license_or_email():
    async def scenario():
        db, delivery, client = system(); url = await seed(db)
        async with client:
            responses = await asyncio.gather(client.post(url + "/approve"), client.post(url + "/approve"))
            assert any(r.status_code == 200 for r in responses)
            assert (await client.post(url + "/retry-fulfillment")).json()["status"] == "already_fulfilled"
            assert len(db.pin_licenses.docs) == delivery.sends == 1
    asyncio.run(scenario())


def test_known_email_failure_retries_without_minting_or_resending_after_success():
    async def scenario():
        db, delivery, client = system(); url = await seed(db)
        delivery.result = {"ok": False, "error": "SMTP credentials missing"}
        async with client:
            response = await client.post(url + "/approve", json={})
            assert response.json()["status"] == "FULFILLMENT_FAILED"
            assert response.json()["fulfillment_error"] == "SMTP credentials missing"
            assert len(db.pin_licenses.docs) == 1
            delivery.result = {"ok": True}
            assert (await client.post(url + "/retry-fulfillment")).json()["status"] == "FULFILLED"
            assert (await client.post(url + "/retry-fulfillment")).json()["status"] == "already_fulfilled"
            assert len(db.pin_licenses.docs) == 1 and delivery.sends == 2
    asyncio.run(scenario())


def test_unknown_email_outcome_prevents_duplicate_delivery():
    async def scenario():
        db, delivery, client = system(); url = await seed(db)
        delivery.result = {"ok": False, "delivery_unknown": True, "error": "SMTP delivery unknown"}
        async with client:
            assert (await client.post(url + "/approve")).json()["status"] == "FULFILLMENT_FAILED"
            assert (await client.post(url + "/retry-fulfillment")).status_code == 409
            assert delivery.sends == 1
    asyncio.run(scenario())


def test_license_write_failure_is_retryable_and_audit_precedes_issuance():
    async def scenario():
        db, delivery, client = system(); url = await seed(db); db.pin_licenses.fail_insert = True
        async with client:
            failed = (await client.post(url + "/approve")).json()
            assert failed["status"] == "FULFILLMENT_FAILED" and failed["fulfillment_stage"] == "LICENSE"
            assert db.payment_review_log.docs[0]["action"] == "APPROVE"
            assert delivery.sends == 0
            assert (await client.post(url + "/retry-fulfillment")).json()["status"] == "FULFILLED"
            assert len(db.pin_licenses.docs) == delivery.sends == 1
    asyncio.run(scenario())


def test_existing_license_is_reused_and_expired_payment_remains_reviewable():
    async def scenario():
        db, delivery, client = system(); url = await seed(db, payment_status="MANUAL_EXPIRED")
        await db.pin_licenses.insert_one({"pin": "ASE-TEST-FULL", "buyer_email": "testbuyer@example.com", "is_active": True,
                                          "payment_ref": "XC-TESTEXISTING2500001"})
        async with client:
            assert (await client.post(url + "/approve")).json()["status"] == "FULFILLED"
            assert len(db.pin_licenses.docs) == 1
            assert db.cloud_users.docs[0]["license_key"] == "ASE-TEST-FULL"
    asyncio.run(scenario())


def test_reject_without_reason_blocks_later_approval_and_license():
    async def scenario():
        db, delivery, client = system(); url = await seed(db)
        async with client:
            assert (await client.post(url + "/reject")).json()["status"] == "MANUAL_REJECTED"
            assert (await client.post(url + "/approve")).status_code == 409
            assert not db.pin_licenses.docs and delivery.sends == 0
            assert db.payment_review_log.docs[0]["action"] == "REJECT"
    asyncio.run(scenario())


def test_pending_search_and_pagination_include_product_and_buyer():
    async def scenario():
        db, delivery, client = system(); await seed(db)
        async with client:
            response = await client.get("/admin/direct-checkout/orders", params={"status": "pending", "q": "testbuyer@example.com", "limit": 50})
            assert response.status_code == 200, response.text
            assert response.json()["total"] == 1
            assert response.json()["entries"][0]["product_name"] == "One-Time XauCloud MT5 License"
            assert (await client.get("/admin/direct-checkout/orders", params={"status": "pending", "q": "[.*"})).json()["total"] == 0
    asyncio.run(scenario())


def test_unauthorized_admin_calls_do_not_mutate_payment():
    async def scenario():
        db, delivery, client = system(authorized=False); url = await seed(db)
        async with client:
            for action in ("approve", "reject", "retry-fulfillment"):
                assert (await client.post(url + "/" + action)).status_code == 403
            assert db.payment_transactions.docs[0]["payment_status"] == "MANUAL_SUBMITTED"
            assert not db.pin_licenses.docs and delivery.sends == 0
    asyncio.run(scenario())
