"""USD-first checkout. Legacy transactions remain separately readable and reconcilable."""
import re
import secrets
import uuid
from decimal import Decimal, ROUND_HALF_UP, InvalidOperation
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError

NETWORKS = {"USDT": {"ERC20", "TRC20"}, "USDC": {"ERC20"}}
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
EVM_ADDR = re.compile(r"^0x[a-fA-F0-9]{40}$")
TRON_ADDR = re.compile(r"^T[1-9A-HJ-NP-Za-km-z]{33}$")
HASH_EVM = re.compile(r"^0x[a-fA-F0-9]{64}$")
HASH_TRON = re.compile(r"^(?:0x)?[a-fA-F0-9]{64}$")

def now():
    return datetime.now(timezone.utc)

def money(cents):
    return f"USD {Decimal(cents)/100:,.2f}"

def is_wallet(asset, network, addr):
    return network in NETWORKS.get(asset, ()) and bool(
        (EVM_ADDR if network == "ERC20" else TRON_ADDR).fullmatch(addr))

class Quote(BaseModel):
    country: str = Field(min_length=2, max_length=2)
    buyer_name: str = Field(min_length=2, max_length=120)
    buyer_email: str = Field(max_length=254)
    asset: str = ""
    network: str = ""

class Submitted(BaseModel):
    payment_reference: str | None = Field(default=None, max_length=180)
    sender_account_name: str | None = Field(default=None, max_length=80)

def normalize_sender_name(raw: str | None) -> str | None:
    name = re.sub(r"\s+", " ", (raw or "").strip())
    if not 2 <= len(name) <= 80:
        return None
    if sum(ch.isalpha() for ch in name) < 2:
        return None
    if any(not (ch.isalnum() or ch in " .'-") for ch in name):
        return None
    return name

class Config(BaseModel):
    price_usd_cents: int | None = Field(default=None, gt=0, le=100000000)
    usd_ngn_rate: str | None = None
    bank_enabled: bool | None = None
    crypto_enabled: bool | None = None
    crypto_countries: list[str] | None = None
    wallets: list[dict] | None = None

class Review(BaseModel):
    evidence_reference: str = Field(min_length=6, max_length=200)
    verification_notes: str = Field(min_length=12, max_length=1500)

def build_router(*, db, get_settings, admin_dep, user_dep, rate_limit,
                 client_ip, generate_pin, PinLicense, send_pin_email,
                 record_email_result, notify_started, notify_sale, logger, send_instructions=None):
    router = APIRouter()

    async def config():
        s = await get_settings()
        p = s.get("direct_usd_cents")
        return {"price_usd_cents": p if type(p) is int and p > 0 else None,
                "usd_ngn_rate": s.get("direct_usd_ngn_rate"),
                "rate_as_of": s.get("direct_fx_as_of"),
                "bank_enabled": bool(s.get("direct_bank_enabled")),
                "crypto_enabled": bool(s.get("direct_crypto_enabled")),
                "crypto_countries": s.get("direct_crypto_countries") or [],
                "wallets": s.get("direct_wallets") or []}

    async def order_status(tx):
        status = tx["payment_status"]
        if status == "MANUAL_PENDING" and now().isoformat() > tx["expires_at"]:
            update = await db.payment_transactions.update_one(
                {"reference": tx["reference"], "payment_status": "MANUAL_PENDING"},
                {"$set": {"payment_status": "MANUAL_EXPIRED"}})
            return "MANUAL_EXPIRED" if update.modified_count else status
        return status

    @router.get("/purchase/direct/config")
    async def public_config(request: Request):
        rate_limit(f"direct_price:{client_ip(request)}", 60, 60)
        cfg = await config()
        price = cfg["price_usd_cents"]
        options = [{"asset": w["asset"], "network": w["network"]}
                   for w in cfg["wallets"] if is_wallet(str(w.get("asset")),
                                                        str(w.get("network")), str(w.get("address", "")))]
        return {"currency": "USD", "price_usd_cents": price,
                "price_formatted": money(price) if price else None,
                "bank_enabled": cfg["bank_enabled"], "crypto_enabled": cfg["crypto_enabled"],
                "crypto_countries": cfg["crypto_countries"],
                "crypto_options": options if cfg["crypto_enabled"] else [],
                "trial_days": 3}

    @router.post("/purchase/direct/quote")
    async def quote(req: Quote, request: Request):
        rate_limit(f"direct_quote:{client_ip(request)}", 8, 600)
        cfg = await config()
        cents = cfg["price_usd_cents"]
        if not cents:
            raise HTTPException(503, "USD price not configured by administrator.")
        country = req.country.strip().upper()
        if not re.fullmatch(r"[A-Z]{2}", country):
            raise HTTPException(422, "Invalid country.")
        email = req.buyer_email.strip().lower()
        if not EMAIL.fullmatch(email):
            raise HTTPException(422, "Invalid email.")
        stamp = now()
        expiry = (stamp + timedelta(minutes=30)).isoformat()
        method = "BANK" if country == "NG" else "CRYPTO"
        if method == "BANK":
            s = await get_settings()
            if not (cfg["bank_enabled"] and s.get("bank_transfer_enabled") and
                    s.get("bank_transfer_bank_name") and s.get("bank_transfer_account_name") and
                    s.get("bank_transfer_account_number")):
                raise HTTPException(503, "Nigerian bank transfer is unavailable.")
            try:
                fx = Decimal(str(cfg["usd_ngn_rate"]))
                fx_date = datetime.fromisoformat(str(cfg["rate_as_of"]).replace("Z", "+00:00"))
                if not (fx.is_finite() and Decimal("0.01") <= fx <= Decimal("1000000")
                        and fx_date.tzinfo and timedelta(0) <= stamp - fx_date <= timedelta(hours=24)):
                    raise ValueError("FX rate unavailable or stale")
            except (ValueError, TypeError, InvalidOperation):
                raise HTTPException(503, "A current USD/NGN quote is unavailable.")
            # USD cents * NGN/USD gives NGN kobo (integer); no float arithmetic.
            amount_minor = int((Decimal(cents) * fx).quantize(Decimal(1), rounding=ROUND_HALF_UP))
            currency = "NGN"
            details = {"bank_name": s["bank_transfer_bank_name"],
                       "account_name": s["bank_transfer_account_name"],
                       "account_number": s["bank_transfer_account_number"],
                       "fx_rate": str(fx), "rate_as_of": fx_date.isoformat()}
            formatted = f"NGN {Decimal(amount_minor)/100:,.2f}"
        else:
            if not cfg["crypto_enabled"] or country not in cfg["crypto_countries"]:
                raise HTTPException(403, "Crypto checkout not approved for this country.")
            asset, network = req.asset.upper(), req.network.upper()
            wallet = next((w for w in cfg["wallets"] if w.get("asset") == asset and
                           w.get("network") == network and is_wallet(asset, network, str(w.get("address", "")))), None)
            if not wallet:
                raise HTTPException(503, "Selected cryptocurrency network is unavailable.")
            amount_minor = cents
            currency = asset
            details = {"asset": asset, "network": network, "address": wallet["address"],
                       "quote_policy": "Nominal USD peg: 1 stablecoin token = 1 USD; network fees excluded."}
            formatted = f"{Decimal(cents)/100:,.2f} {asset}"
        reference = "XC-" + secrets.token_hex(10).upper()
        tx = {"id": str(uuid.uuid4()), "reference": reference, "provider": "MANUAL_DIRECT",
              "country": country, "method": method, "currency": currency, "amount_minor": amount_minor,
              "price_usd_cents": cents, "buyer_name": req.buyer_name.strip(), "buyer_email": email,
              "quote_details": details, "created_at": stamp.isoformat(), "expires_at": expiry,
              "payment_status": "MANUAL_PENDING", "pin_generated": None, "instructions_resend_count": 0}
        await db.payment_transactions.insert_one(tx)
        instructions_sent = False
        if send_instructions is not None:
            try:
                instructions_sent = bool(await send_instructions(
                    buyer_name=tx["buyer_name"], buyer_email=email, reference=reference,
                    method=method, amount_formatted=formatted,
                    usd_price=money(cents), details=details, expires_at=expiry))
            except Exception:
                logger.exception("Customer manual checkout email failed: %s", reference)
        await db.payment_transactions.update_one(
            {"reference": reference, "provider": "MANUAL_DIRECT"},
            {"$set": {"instructions_email_status": "SENT" if instructions_sent else "FAILED",
                      "instructions_email_attempted_at": now().isoformat()}})
        try:
            await notify_started("Manual " + method, reference, tx["buyer_name"], email, formatted)
        except Exception:
            logger.exception("Manual checkout start notification failed: %s", reference)
        return {"reference": reference, "method": method, "usd_price": money(cents),
                "currency": currency, "amount_minor": amount_minor, "amount_formatted": formatted,
                "details": details, "expires_at": expiry, "status": "MANUAL_PENDING",
                "instructions_email_sent": instructions_sent}

    @router.post("/purchase/direct/{reference}/resend-instructions")
    async def resend_instructions(reference: str, request: Request):
        rate_limit(f"direct_email_retry:{client_ip(request)}", 4, 600)
        tx = await db.payment_transactions.find_one(
            {"reference": reference, "provider": "MANUAL_DIRECT"}, {"_id": 0})
        if not tx:
            raise HTTPException(404, "Unknown order.")
        if await order_status(tx) != "MANUAL_PENDING":
            raise HTTPException(409, "This order is no longer awaiting transfer.")
        claimed = await db.payment_transactions.update_one(
            {"reference": reference, "provider": "MANUAL_DIRECT",
             "payment_status": "MANUAL_PENDING", "instructions_resend_count": {"$lt": 2}},
            {"$inc": {"instructions_resend_count": 1}})
        if not claimed.modified_count:
            raise HTTPException(429, "Email retry limit reached. Copy the payment details shown on screen.")
        sent = False
        if send_instructions is not None:
            try:
                formatted = (f"NGN {Decimal(tx['amount_minor'])/100:,.2f}"
                             if tx["currency"] == "NGN" else
                             f"{Decimal(tx['amount_minor'])/100:,.2f} {tx['currency']}")
                sent = bool(await send_instructions(
                    buyer_name=tx["buyer_name"], buyer_email=tx["buyer_email"],
                    reference=reference, method=tx["method"],
                    amount_formatted=formatted, usd_price=money(tx["price_usd_cents"]),
                    details=tx["quote_details"], expires_at=tx["expires_at"]))
            except Exception:
                logger.exception("Manual checkout resend failed: %s", reference)
        await db.payment_transactions.update_one(
            {"reference": reference, "provider": "MANUAL_DIRECT"},
            {"$set": {"instructions_email_status": "SENT" if sent else "FAILED",
                      "instructions_email_attempted_at": now().isoformat()}})
        return {"sent": sent}

    @router.post("/purchase/direct/{reference}/submit")
    async def submit(reference: str, req: Submitted, request: Request):
        rate_limit(f"direct_submit:{client_ip(request)}", 12, 600)
        tx = await db.payment_transactions.find_one({"reference": reference, "provider": "MANUAL_DIRECT"}, {"_id": 0})
        if not tx:
            raise HTTPException(404, "Unknown order.")
        status = await order_status(tx)
        if status == "MANUAL_SUBMITTED":
            return {"reference": reference, "status": status}
        if status != "MANUAL_PENDING":
            raise HTTPException(409, "Quote expired or already processed. Contact support if already paid.")
        if tx["method"] == "BANK":
            sender = normalize_sender_name(req.sender_account_name)
            if not sender:
                raise HTTPException(422, "Enter the account name the transfer was sent from.")
            result = await db.payment_transactions.update_one(
                {"reference": reference, "payment_status": "MANUAL_PENDING"},
                {"$set": {"payment_status": "MANUAL_SUBMITTED",
                          "sender_account_name": sender, "submitted_at": now().isoformat()}})
            if result.modified_count != 1:
                raise HTTPException(409, "Order status changed; refresh.")
            return {"reference": reference, "status": "MANUAL_SUBMITTED"}
        proof = (req.payment_reference or "").strip()
        valid = (HASH_EVM if tx["quote_details"]["network"] == "ERC20" else HASH_TRON).fullmatch(proof)
        if not valid:
            raise HTTPException(422, "Invalid payment reference for the selected method/network.")
        if await db.payment_transactions.find_one({"provider": "MANUAL_DIRECT",
                "method": tx["method"], "submitted_reference": proof, "reference": {"$ne": reference}}):
            raise HTTPException(409, "This payment reference is already attached to another order.")
        result = await db.payment_transactions.update_one(
            {"reference": reference, "payment_status": "MANUAL_PENDING"},
            {"$set": {"payment_status": "MANUAL_SUBMITTED",
                      "submitted_reference": proof, "submitted_at": now().isoformat()}})
        if result.modified_count != 1:
            raise HTTPException(409, "Order status changed; refresh.")
        return {"reference": reference, "status": "MANUAL_SUBMITTED"}

    @router.get("/purchase/direct/{reference}/status")
    async def status(reference: str, request: Request):
        rate_limit(f"direct_status:{client_ip(request)}", 60, 60)
        tx = await db.payment_transactions.find_one({"reference": reference, "provider": "MANUAL_DIRECT"}, {"_id": 0})
        if not tx:
            raise HTTPException(404, "Unknown order.")
        return {"reference": reference, "status": await order_status(tx), "method": tx["method"],
                "currency": tx["currency"], "amount_minor": tx["amount_minor"],
                "created_at": tx["created_at"], "expires_at": tx["expires_at"]}

    @router.get("/admin/direct-checkout/config")
    async def admin_config(admin: dict = Depends(admin_dep)):
        return await config()

    @router.put("/admin/direct-checkout/config")
    async def update_config(req: Config, admin: dict = Depends(admin_dep)):
        changes = {}
        if req.price_usd_cents is not None:
            changes["direct_usd_cents"] = req.price_usd_cents
        if req.usd_ngn_rate is not None:
            try:
                fx = Decimal(req.usd_ngn_rate)
                if not fx.is_finite() or not Decimal("0.01") <= fx <= Decimal("1000000"):
                    raise ValueError()
            except (ValueError, InvalidOperation):
                raise HTTPException(422, "FX rate must be a valid positive decimal.")
            changes["direct_usd_ngn_rate"] = str(fx)
            changes["direct_fx_as_of"] = now().isoformat()
        if req.bank_enabled is not None:
            changes["direct_bank_enabled"] = req.bank_enabled
        if req.crypto_enabled is not None:
            changes["direct_crypto_enabled"] = req.crypto_enabled
        if req.crypto_countries is not None:
            countries = sorted(set(x.strip().upper() for x in req.crypto_countries))
            if any(not re.fullmatch(r"[A-Z]{2}", x) or x == "NG" for x in countries):
                raise HTTPException(422, "Invalid country allowlist.")
            changes["direct_crypto_countries"] = countries
        if req.wallets is not None:
            normalized = []
            for w in req.wallets:
                asset, network, address = str(w.get("asset", "")).upper(), str(w.get("network", "")).upper(), str(w.get("address", "")).strip()
                if not is_wallet(asset, network, address):
                    raise HTTPException(422, "Unsupported asset, network, or wallet address.")
                if any(x["asset"] == asset and x["network"] == network for x in normalized):
                    raise HTTPException(422, "Duplicate asset/network.")
                normalized.append({"asset": asset, "network": network, "address": address})
            changes["direct_wallets"] = normalized
        if changes:
            await db.admin_settings.update_one({"key": "main"}, {"$set": changes}, upsert=True)
            await db.payment_config_audit_log.insert_one({"id": str(uuid.uuid4()), "provider": "MANUAL_DIRECT",
                                                          "admin_email": admin["email"], "changed_fields": list(changes),
                                                          "at": now().isoformat()})
        return await config()

    @router.get("/admin/direct-checkout/orders")
    async def orders(admin: dict = Depends(admin_dep)):
        entries = await db.payment_transactions.find(
            {"provider": "MANUAL_DIRECT"}, {"_id": 0}).sort("created_at", -1).limit(200).to_list(200)
        for tx in entries:
            tx["payment_status"] = await order_status(tx)
        return {"entries": entries}

    @router.post("/admin/direct-checkout/{reference}/approve")
    async def approve(reference: str, req: Review, admin: dict = Depends(admin_dep)):
        tx = await db.payment_transactions.find_one({"provider": "MANUAL_DIRECT", "reference": reference}, {"_id": 0})
        if not tx:
            raise HTTPException(404, "Unknown order.")
        if tx["payment_status"] == "FULFILLED":
            return {"status": "already_fulfilled"}
        if tx["payment_status"] != "MANUAL_SUBMITTED":
            raise HTTPException(409, "Only submitted orders may be verified.")
        result = await db.payment_transactions.update_one(
            {"reference": reference, "payment_status": "MANUAL_SUBMITTED"},
            {"$set": {"payment_status": "FULFILLING", "verified_external_reference": req.evidence_reference,
                      "verification_notes": req.verification_notes, "approved_by": admin["email"],
                      "approved_at": now().isoformat()}})
        if result.modified_count != 1:
            raise HTTPException(409, "Order is already being reviewed.")
        pin = generate_pin()
        while await db.pin_licenses.find_one({"pin": pin}):
            pin = generate_pin()
        doc = PinLicense(pin=pin, buyer_name=tx["buyer_name"], buyer_email=tx["buyer_email"],
                         notes=f"Manual direct {tx['method']} - {reference}", payment_ref=reference).model_dump()
        doc["provider"] = "MANUAL_DIRECT"
        try:
            await db.pin_licenses.insert_one(doc)
        except DuplicateKeyError:
            existing = await db.pin_licenses.find_one({"payment_ref": reference})
            if not existing:
                raise
            pin = existing["pin"]
        await db.payment_transactions.update_one(
            {"reference": reference, "payment_status": "FULFILLING"},
            {"$set": {"payment_status": "FULFILLED", "pin_generated": pin, "fulfilled_at": now().isoformat()}})
        await db.payment_review_log.insert_one(
            {"id": str(uuid.uuid4()), "reference": reference, "by": admin["email"],
             "action": "APPROVE", "verification_notes": req.verification_notes,
             "evidence_reference": req.evidence_reference, "at": now().isoformat()})
        sent = await send_pin_email(tx["buyer_email"], tx["buyer_name"], pin)
        await record_email_result(reference, tx["buyer_name"], tx["buyer_email"], pin, sent)
        try:
            await notify_sale(reference, tx["buyer_name"], tx["buyer_email"],
                              money(tx["price_usd_cents"]), pin, "Manual " + tx["method"],
                              transaction_id=req.evidence_reference)
        except Exception:
            logger.exception("Manual checkout sale notification failed: %s", reference)
        return {"status": "FULFILLED"}

    @router.post("/admin/direct-checkout/{reference}/reject")
    async def reject(reference: str, req: Review, admin: dict = Depends(admin_dep)):
        result = await db.payment_transactions.update_one(
            {"reference": reference, "provider": "MANUAL_DIRECT",
             "payment_status": {"$in": ["MANUAL_PENDING", "MANUAL_SUBMITTED"]}},
            {"$set": {"payment_status": "MANUAL_REJECTED", "rejected_by": admin["email"],
                      "rejected_at": now().isoformat(), "verification_notes": req.verification_notes}})
        if result.modified_count != 1:
            raise HTTPException(409, "Order is no longer rejectable.")
        await db.payment_review_log.insert_one(
            {"id": str(uuid.uuid4()), "reference": reference, "by": admin["email"],
             "action": "REJECT", "verification_notes": req.verification_notes, "at": now().isoformat()})
        return {"status": "MANUAL_REJECTED"}

    @router.post("/cloud/signals/trial/start")
    async def trial_start(request: Request, user: dict = Depends(user_dep)):
        rate_limit(f"trial:{client_ip(request)}", 10, 600)
        existing = await db.cloud_signal_trials.find_one(
            {"$or": [{"user_id": user["id"]}, {"email": user["email"].lower()}]})
        if existing:
            raise HTTPException(409, "Your account has already used its free trial.")
        stamp = now()
        trial = {"id": str(uuid.uuid4()), "user_id": user["id"], "email": user["email"].lower(),
                 "starts_at": stamp.isoformat(), "expires_at": (stamp + timedelta(days=3)).isoformat()}
        try:
            await db.cloud_signal_trials.insert_one(trial)
        except DuplicateKeyError:
            raise HTTPException(409, "Your account has already used its free trial.")
        return {"status": "active", "expires_at": trial["expires_at"], "auto_renew": False}

    @router.get("/cloud/signals/trial/status")
    async def trial_status(user: dict = Depends(user_dep)):
        trial = await db.cloud_signal_trials.find_one({"user_id": user["id"]}, {"_id": 0})
        if not trial:
            return {"status": "not_started", "auto_renew": False}
        return {"status": "active" if now().isoformat() < trial["expires_at"] else "expired",
                "expires_at": trial["expires_at"], "auto_renew": False}

    return router
