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
    method: str = ""

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
    evidence_reference: str | None = Field(default=None, max_length=200)
    verification_notes: str | None = Field(default=None, max_length=1500)

class RejectionReview(BaseModel):
    verification_notes: str | None = Field(default=None, max_length=1500)

APPROVABLE = ["MANUAL_PENDING", "MANUAL_SUBMITTED", "MANUAL_EXPIRED"]
PIN_PATTERN = re.compile(r"^ASE-[A-Z0-9]{4}-[A-Z0-9]{4}$")

class FulfillmentError(Exception):
    def __init__(self, stage, message):
        super().__init__(message)
        self.stage = stage

def build_router(*, db, get_settings, admin_dep, user_dep, rate_limit,
                 client_ip, generate_pin, PinLicense, send_pin_email,
                 record_email_result, notify_started, notify_sale, logger, send_instructions=None,
                 send_pin_email_detailed=None):
    router = APIRouter()

    async def config():
        s = await get_settings()
        p = s.get("direct_usd_cents")
        return {"price_usd_cents": p if type(p) is int and p > 0 else None,
                "usd_ngn_rate": s.get("direct_usd_ngn_rate"),
                "rate_as_of": s.get("direct_fx_as_of"),
                "bank_enabled": (s["direct_bank_enabled"] if type(s.get("direct_bank_enabled")) is bool
                                 else s.get("bank_transfer_enabled") is True),
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

    async def ensure_indexes():
        # Fail before granting entitlements if duplicate protection cannot be installed.
        await db.payment_transactions.create_index("reference", unique=True)
        await db.pin_licenses.create_index("pin", unique=True)
        await db.pin_licenses.create_index("payment_ref", unique=True,
            partialFilterExpression={"payment_ref": {"$type": "string"}})

    def license_matches(tx, license):
        return bool(license and PIN_PATTERN.fullmatch(str(license.get("pin", "")))
                    and str(license.get("buyer_email", "")).strip().lower() == tx["buyer_email"].strip().lower()
                    and license.get("is_active") is True and license.get("payment_ref") == tx["reference"])

    def valid_order(tx):
        details = tx.get("quote_details")
        if (tx.get("product_id", tx.get("plan_id", "BOT_LIFETIME")) != "BOT_LIFETIME"
                or type(tx.get("amount_minor")) is not int or tx["amount_minor"] <= 0
                or type(tx.get("price_usd_cents")) is not int or tx["price_usd_cents"] <= 0
                or not EMAIL.fullmatch(str(tx.get("buyer_email", ""))) or not isinstance(details, dict)):
            return False
        if tx.get("method") == "BANK":
            try:
                rate = Decimal(str(details.get("fx_rate")))
                quoted = int((Decimal(tx["price_usd_cents"]) * rate).quantize(Decimal(1), rounding=ROUND_HALF_UP))
                return bool(rate.is_finite() and Decimal("0.01") <= rate <= Decimal("1000000")
                            and tx.get("country") == "NG" and tx.get("currency") == "NGN"
                            and all(details.get(k) for k in ("bank_name", "account_name", "account_number"))
                            and quoted == tx["amount_minor"])
            except (ValueError, TypeError, InvalidOperation, OverflowError):
                return False
        return bool(tx.get("method") == "CRYPTO" and tx.get("currency") == details.get("asset")
                    and tx["amount_minor"] == tx["price_usd_cents"]
                    and is_wallet(str(details.get("asset")), str(details.get("network")), str(details.get("address"))))

    async def ensure_license(tx):
        reference = tx["reference"]
        existing = await db.pin_licenses.find_one({"payment_ref": reference})
        if not existing and tx.get("pin_generated"):
            assigned = await db.pin_licenses.find_one({"pin": tx["pin_generated"]})
            if (not assigned or assigned.get("payment_ref") not in (None, "", reference)
                    or str(assigned.get("buyer_email", "")).strip().lower() != tx["buyer_email"].strip().lower()):
                raise FulfillmentError("LICENSE", "Previously assigned license cannot be verified for this order and purchaser.")
            await db.pin_licenses.update_one({"pin": assigned["pin"], "payment_ref": assigned.get("payment_ref")},
                                            {"$set": {"payment_ref": reference}})
            existing = await db.pin_licenses.find_one({"payment_ref": reference})
        if existing:
            if not license_matches(tx, existing):
                raise FulfillmentError("LICENSE", "Existing order license is inactive or belongs to another purchaser. Resolve license validation before retrying.")
            return existing
        pin = generate_pin()
        while await db.pin_licenses.find_one({"pin": pin}):
            pin = generate_pin()
        doc = PinLicense(pin=pin, buyer_name=tx["buyer_name"], buyer_email=tx["buyer_email"].strip().lower(),
                         notes=f"Owner-approved manual {tx['method']} - {reference}", payment_ref=reference).model_dump()
        doc.update(provider="MANUAL_DIRECT", product_id="BOT_LIFETIME", license_activated_at=now().isoformat())
        try:
            await db.pin_licenses.insert_one(doc)
        except DuplicateKeyError:
            pass
        existing = await db.pin_licenses.find_one({"payment_ref": reference})
        if not license_matches(tx, existing):
            raise FulfillmentError("LICENSE", "License issuance could not be verified; no second license was issued.")
        return existing

    async def link_customer(tx, license):
        email = tx["buyer_email"].strip().lower()
        user = await db.cloud_users.find_one({"email": email})
        if not user:
            account_status = "AWAITING_SIGNUP"
        else:
            if user.get("disabled_at"):
                raise FulfillmentError("ACCOUNT", "Customer account is disabled. Resolve the restriction before retrying.")
            current_pin = str(user.get("license_key") or user.get("command_license_key") or "").strip()
            if current_pin and current_pin != license["pin"]:
                previous = await db.pin_licenses.find_one({"pin": current_pin})
                if not previous or str(previous.get("buyer_email", "")).strip().lower() != email:
                    raise FulfillmentError("ACCOUNT", "Customer's existing license link cannot be verified. Resolve account ownership before retrying.")
            linked = await db.cloud_users.update_one(
                {"id": user["id"], "email": email, "license_key": user.get("license_key"),
                 "command_license_key": user.get("command_license_key")},
                {"$set": {"license_key": license["pin"], "command_license_key": license["pin"], "license_linked_at": now().isoformat()},
                 "$addToSet": {"purchased_license_keys": license["pin"]}})
            if linked.matched_count != 1:
                raise FulfillmentError("ACCOUNT", "Customer account changed during activation. Retry fulfillment.")
            account_status = "LINKED"
        await db.payment_transactions.update_one({"provider": "MANUAL_DIRECT", "reference": tx["reference"]},
            {"$set": {"account_link_status": account_status, **({"linked_cloud_user_id": user["id"]} if user else {})}})
        return account_status

    async def deliver_email(tx, license):
        if tx.get("fulfillment_email_status") == "SENT":
            return "SENT"
        email_claim = str(uuid.uuid4())
        claimed = await db.payment_transactions.update_one(
            {"provider": "MANUAL_DIRECT", "reference": tx["reference"], "approved_by": tx["approved_by"], "$or": [
                {"fulfillment_email_status": {"$exists": False}},
                {"fulfillment_email_status": {"$in": ["PENDING", "RETRYABLE"]}}]},
            {"$set": {"fulfillment_email_status": "SENDING", "fulfillment_email_claim_id": email_claim,
                      "fulfillment_email_claimed_at": now().isoformat()}})
        if not claimed.modified_count:
            fresh = await db.payment_transactions.find_one({"reference": tx["reference"], "provider": "MANUAL_DIRECT"})
            if fresh.get("fulfillment_email_status") == "SENT":
                return "SENT"
            raise FulfillmentError("EMAIL", "Official email is sending or delivery is unknown. Check sender logs; duplicate delivery was prevented.")
        try:
            if send_pin_email_detailed:
                result = await send_pin_email_detailed(tx["buyer_email"], tx["buyer_name"], license["pin"], tx["reference"])
            else:
                sent = await send_pin_email(tx["buyer_email"], tx["buyer_name"], license["pin"])
                result = {"ok": bool(sent), "error": None if sent else "Official license email failed. Check email configuration and retry."}
        except Exception:
            # SMTP can accept a message before the connection drops. Do not resend blindly.
            result = {"ok": False, "delivery_unknown": True, "error": "Email sending was interrupted; delivery is unknown. Check sender logs before another send."}
        email_status = "SENT" if result.get("ok") else "DELIVERY_UNKNOWN" if result.get("delivery_unknown") else "RETRYABLE"
        await db.payment_transactions.update_one(
            {"provider": "MANUAL_DIRECT", "reference": tx["reference"], "fulfillment_email_claim_id": email_claim},
            {"$set": {"fulfillment_email_status": email_status, "fulfillment_email_error": result.get("error"),
                      "fulfillment_email_failed": not result.get("ok"), "fulfillment_email_attempted_at": now().isoformat()}})
        if not result.get("ok"):
            raise FulfillmentError("EMAIL", result.get("error") or "Official license email failed. Retry fulfillment.")
        return "SENT"

    async def complete_fulfillment(tx):
        claim = {"provider": "MANUAL_DIRECT", "reference": tx["reference"],
                 "payment_status": "FULFILLING", "fulfillment_claim_id": tx["fulfillment_claim_id"]}
        stage = "AUDIT"
        try:
            await db.payment_review_log.update_one({"id": "APPROVE:" + tx["reference"]},
                {"$setOnInsert": {"id": "APPROVE:" + tx["reference"], "reference": tx["reference"], "action": "APPROVE",
                                  "by": tx["approved_by"], "at": tx["approved_at"]}}, upsert=True)
            if tx.get("fulfillment_retried_at"):
                retry_id = "RETRY:" + tx["fulfillment_claim_id"]
                await db.payment_review_log.update_one({"id": retry_id}, {"$setOnInsert": {
                    "id": retry_id, "reference": tx["reference"], "action": "RETRY_FULFILLMENT",
                    "by": tx["fulfillment_retried_by"], "at": tx["fulfillment_retried_at"]}}, upsert=True)
            stage = "LICENSE"
            license = await ensure_license(tx)
            stage = "ACCOUNT"
            account_status = await link_customer(tx, license)
            recorded = await db.payment_transactions.update_one(claim,
                {"$set": {"pin_generated": license["pin"], "entitlement_fulfilled_at": now().isoformat()}})
            if not recorded.matched_count:
                raise FulfillmentError("ORDER", "Order changed during fulfillment. Refresh its status.")
            stage = "EMAIL"
            fresh = await db.payment_transactions.find_one(claim)
            if not fresh:
                raise FulfillmentError("ORDER", "Order changed during fulfillment. Refresh its status.")
            email_status = await deliver_email(fresh, license)
            finished = await db.payment_transactions.update_one(claim, {"$set": {
                "payment_status": "FULFILLED", "fulfilled_at": now().isoformat(), "fulfillment_error": None, "fulfillment_stage": None}})
            if not finished.modified_count:
                raise FulfillmentError("ORDER", "Order changed while fulfillment completed. Refresh its status.")
            notification = await db.payment_transactions.update_one(
                {"reference": tx["reference"], "provider": "MANUAL_DIRECT", "fulfillment_admin_status": {"$exists": False}},
                {"$set": {"fulfillment_admin_status": "SENDING"}})
            if notification.modified_count:
                try:
                    await notify_sale(tx["reference"], tx["buyer_name"], tx["buyer_email"],
                                      money(tx["price_usd_cents"]), license["pin"], "Manual " + tx["method"])
                    await db.payment_transactions.update_one({"reference": tx["reference"]}, {"$set": {"fulfillment_admin_status": "SENT"}})
                except Exception:
                    logger.exception("Manual checkout sale notification failed: %s", tx["reference"])
            return {"status": "FULFILLED", "license_status": "ISSUED", "account_link_status": account_status, "fulfillment_email_status": email_status}
        except Exception as error:
            failure_stage = error.stage if isinstance(error, FulfillmentError) else stage
            message = str(error) if isinstance(error, FulfillmentError) else f"{failure_stage} failed ({type(error).__name__}). Retry fulfillment."
            logger.exception("Manual fulfillment failed: %s stage=%s", tx["reference"], failure_stage)
            await db.payment_transactions.update_one(claim, {"$set": {"payment_status": "FULFILLMENT_FAILED",
                "fulfillment_failure_at": now().isoformat(), "fulfillment_error": message, "fulfillment_stage": failure_stage}})
            fresh = await db.payment_transactions.find_one({"reference": tx["reference"], "provider": "MANUAL_DIRECT"})
            license = await db.pin_licenses.find_one({"payment_ref": tx["reference"]})
            return {"status": "FULFILLMENT_FAILED", "fulfillment_error": message, "fulfillment_stage": failure_stage,
                    "license_status": "ISSUED" if license_matches(tx, license) else "NOT_ISSUED",
                    "account_link_status": fresh.get("account_link_status", "NOT_LINKED"),
                    "fulfillment_email_status": fresh.get("fulfillment_email_status", "NOT_SENT")}

    @router.get("/purchase/direct/config")
    async def public_config(request: Request):
        rate_limit(f"direct_price:{client_ip(request)}", 60, 60)
        cfg = await config()
        price = cfg["price_usd_cents"]
        options = [{"asset": w["asset"], "network": w["network"]}
                   for w in cfg["wallets"] if is_wallet(str(w.get("asset")),
                                                        str(w.get("network")), str(w.get("address", "")))]
        settings = await get_settings()
        bank_configured = bool(cfg["bank_enabled"] and settings.get("bank_transfer_enabled")
                               and settings.get("bank_transfer_bank_name")
                               and settings.get("bank_transfer_account_name")
                               and settings.get("bank_transfer_account_number"))
        fx_fresh = False
        try:
            fx = Decimal(str(cfg["usd_ngn_rate"]))
            fx_date = datetime.fromisoformat(str(cfg["rate_as_of"]).replace("Z", "+00:00"))
            fx_fresh = bool(fx.is_finite() and Decimal("0.01") <= fx <= Decimal("1000000")
                            and fx_date.tzinfo and timedelta(0) <= now() - fx_date <= timedelta(hours=24))
        except (ValueError, TypeError, InvalidOperation, OverflowError):
            pass
        crypto_ready = bool(price and cfg["crypto_enabled"] and options)
        bank_reason = ("USD_PRICE_MISSING" if not price else "BANK_DISABLED" if not cfg["bank_enabled"] or not settings.get("bank_transfer_enabled")
                       else "BANK_DETAILS_MISSING" if not bank_configured else "FX_RATE_STALE" if not fx_fresh else None)
        return {"currency": "USD", "price_usd_cents": price,
                "price_formatted": money(price) if price else None,
                "bank_enabled": bool(price and bank_configured and fx_fresh),
                "bank_unavailable_reason": bank_reason,
                "crypto_enabled": crypto_ready,
                "crypto_countries": cfg["crypto_countries"],
                "crypto_options": options if crypto_ready else [],
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
        method_req = (req.method or "").strip().upper()
        if country != "NG":
            if method_req == "BANK":
                raise HTTPException(403, "Bank transfer is only available in Nigeria.")
            method = "CRYPTO"
        elif method_req == "CRYPTO":
            method = "CRYPTO"
        else:
            method = "BANK"
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
                       "fx_rate": str(fx), "rate_as_of": fx_date.isoformat(),
                       "instructions": str(s.get("bank_transfer_instructions") or ""),
                       "support_contact": str(s.get("bank_transfer_support_contact") or "")}
            formatted = f"NGN {Decimal(amount_minor)/100:,.2f}"
        else:
            if not cfg["crypto_enabled"]:
                raise HTTPException(403, "Crypto checkout is not available.")
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
              "product_id": "BOT_LIFETIME", "product_name": "One-Time XauCloud MT5 License",
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
                "created_at": tx["created_at"], "expires_at": tx["expires_at"],
                "submitted_at": tx.get("submitted_at"), "payment_approved": bool(tx.get("approved_by")),
                "fulfillment_email_status": tx.get("fulfillment_email_status"),
                "fulfillment_error": "Fulfillment delayed; contact support with your order ID." if tx.get("fulfillment_error") else None}

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
    async def orders(admin: dict = Depends(admin_dep), q: str = "", status: str = "all", limit: int = 100, offset: int = 0):
        if status not in ("all", "pending", "approved", "rejected", "failed") or not 1 <= limit <= 200 or offset < 0 or len(q) > 254:
            raise HTTPException(422, "Invalid payment search or pagination.")
        query = {"provider": "MANUAL_DIRECT"}
        groups = {"pending": APPROVABLE, "approved": ["FULFILLING", "FULFILLED"], "rejected": ["MANUAL_REJECTED"]}
        if status == "failed":
            query["$or"] = [{"payment_status": "FULFILLMENT_FAILED"},
                {"payment_status": "FULFILLING", "fulfillment_error": {"$exists": True, "$ne": None}},
                {"payment_status": "FULFILLED", "fulfillment_email_status": {"$ne": "SENT"}},
                {"payment_status": "FULFILLED", "pin_generated": {"$in": [None, ""]}},
                {"payment_status": "FULFILLED", "fulfillment_email_failed": True}]
        elif status != "all":
            query["payment_status"] = {"$in": groups[status]}
        if q.strip():
            query["$and"] = [{"$or": [{field: {"$regex": re.escape(q.strip()), "$options": "i"}}
                                        for field in ("buyer_name", "buyer_email", "reference")]}]
        total = await db.payment_transactions.count_documents(query)
        entries = await db.payment_transactions.find(query, {"_id": 0, "evidence_image": 0}).sort("created_at", -1).skip(offset).limit(limit).to_list(limit)
        for tx in entries:
            tx.setdefault("product_id", "BOT_LIFETIME")
            tx.setdefault("product_name", "One-Time XauCloud MT5 License")
            license = await db.pin_licenses.find_one({"payment_ref": tx["reference"]})
            tx["license_status"] = "NOT_ISSUED" if not license else "ISSUED" if license_matches(tx, license) else "REQUIRES_REVIEW"
            tx.setdefault("account_link_status", "NOT_LINKED")
        return {"entries": entries, "total": total, "limit": limit, "offset": offset}

    @router.get("/admin/direct-checkout/{reference}")
    async def order_detail(reference: str, admin: dict = Depends(admin_dep)):
        tx = await db.payment_transactions.find_one({"provider": "MANUAL_DIRECT", "reference": reference}, {"_id": 0})
        if not tx:
            raise HTTPException(404, "Unknown order.")
        return {"order": tx}

    @router.post("/admin/direct-checkout/{reference}/approve")
    async def approve(reference: str, req: Review | None = None, admin: dict = Depends(admin_dep)):
        tx = await db.payment_transactions.find_one({"provider": "MANUAL_DIRECT", "reference": reference}, {"_id": 0})
        if not tx:
            raise HTTPException(404, "Unknown order.")
        if tx["payment_status"] == "FULFILLED":
            license = await db.pin_licenses.find_one({"payment_ref": reference})
            if not license_matches(tx, license):
                raise HTTPException(409, "Fulfilled order license validation failed. Use Retry Fulfillment.")
            return {"status": "already_fulfilled", "license_status": "ISSUED", "fulfillment_email_status": tx.get("fulfillment_email_status", "NOT_SENT")}
        if tx["payment_status"] not in APPROVABLE:
            raise HTTPException(409, "Payment is no longer pending. Use Retry Fulfillment for an approved payment.")
        if not valid_order(tx):
            raise HTTPException(409, "Stored order product, purchaser, amount or payment instructions are invalid. Approval blocked.")
        await ensure_indexes()
        stamp = now().isoformat()
        result = await db.payment_transactions.update_one(
            {"reference": reference, "provider": "MANUAL_DIRECT", "payment_status": {"$in": APPROVABLE}},
            {"$set": {"payment_status": "FULFILLING", "payment_approved": True, "approved_by": admin["email"],
                      "approved_at": stamp, "approval_event": {"action": "APPROVE", "by": admin["email"], "at": stamp},
                      "fulfillment_claimed_at": stamp, "fulfillment_claim_id": str(uuid.uuid4())}})
        if result.modified_count != 1:
            raise HTTPException(409, "Order is already being reviewed.")
        approved = await db.payment_transactions.find_one({"provider": "MANUAL_DIRECT", "reference": reference})
        return await complete_fulfillment(approved)

    @router.post("/admin/direct-checkout/{reference}/resend-license")
    @router.post("/admin/direct-checkout/{reference}/retry-fulfillment")
    async def retry_fulfillment(reference: str, admin: dict = Depends(admin_dep)):
        tx = await db.payment_transactions.find_one({"provider": "MANUAL_DIRECT", "reference": reference})
        if not tx:
            raise HTTPException(404, "Unknown order.")
        if not tx.get("approved_by") or not tx.get("approved_at") or not valid_order(tx):
            raise HTTPException(409, "Valid stored order and recorded administrator approval are required.")
        prior = tx["payment_status"]
        if prior not in ("FULFILLING", "FULFILLMENT_FAILED", "FULFILLED"):
            raise HTTPException(409, "Payment has not been approved.")
        if prior == "FULFILLED" and tx.get("fulfillment_email_status") == "SENT":
            license = await db.pin_licenses.find_one({"payment_ref": reference})
            if license_matches(tx, license):
                return {"status": "already_fulfilled", "license_status": "ISSUED", "fulfillment_email_status": "SENT"}
        if tx.get("fulfillment_email_status") in ("SENDING", "DELIVERY_UNKNOWN"):
            raise HTTPException(409, tx.get("fulfillment_email_error") or "Email delivery outcome is unknown. Check sender logs; duplicate delivery was prevented.")
        await ensure_indexes()
        claim = {"provider": "MANUAL_DIRECT", "reference": reference, "payment_status": prior}
        if prior == "FULFILLING":
            if tx.get("fulfillment_error"):
                claim["fulfillment_error"] = tx["fulfillment_error"]
            else:
                claim["$or"] = [{"fulfillment_claimed_at": {"$exists": False}},
                    {"fulfillment_claimed_at": {"$lt": (now() - timedelta(minutes=10)).isoformat()}}]
        recovered = await db.payment_transactions.update_one(claim, {"$set": {
            "payment_status": "FULFILLING", "fulfillment_claim_id": str(uuid.uuid4()), "fulfillment_claimed_at": now().isoformat(),
            "fulfillment_retried_by": admin["email"], "fulfillment_retried_at": now().isoformat(), "fulfillment_error": None, "fulfillment_stage": None}})
        if not recovered.modified_count:
            raise HTTPException(409, "Fulfillment is already in progress. Refresh its status.")
        current = await db.payment_transactions.find_one({"provider": "MANUAL_DIRECT", "reference": reference})
        return await complete_fulfillment(current)

    @router.post("/admin/direct-checkout/{reference}/reject")
    async def reject(reference: str, req: RejectionReview | None = None, admin: dict = Depends(admin_dep)):
        tx = await db.payment_transactions.find_one({"provider": "MANUAL_DIRECT", "reference": reference})
        if not tx:
            raise HTTPException(404, "Unknown order.")
        if tx["payment_status"] == "MANUAL_REJECTED":
            return {"status": "MANUAL_REJECTED"}
        if await db.pin_licenses.find_one({"payment_ref": reference}):
            raise HTTPException(409, "A license already exists for this order. Rejection blocked.")
        stamp = now().isoformat()
        result = await db.payment_transactions.update_one(
            {"reference": reference, "provider": "MANUAL_DIRECT",
             "payment_status": {"$in": APPROVABLE}},
            {"$set": {"payment_status": "MANUAL_REJECTED", "rejected_by": admin["email"],
                      "rejected_at": stamp, "rejection_event": {"action": "REJECT", "by": admin["email"], "at": stamp}}})
        if result.modified_count != 1:
            raise HTTPException(409, "Order is no longer rejectable.")
        await db.payment_review_log.insert_one(
            {"id": str(uuid.uuid4()), "reference": reference, "by": admin["email"],
             "action": "REJECT", "at": stamp})
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
