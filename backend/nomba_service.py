"""Nomba Checkout payment provider integration.

Reference: audits/nomba_migration/02_nomba_api_reference.md -- every
endpoint, field name, and the webhook signature formula below was
confirmed directly against developer.nomba.com (live-fetched during this
migration), not assumed from memory or third-party tutorials.

This module is intentionally provider-config-agnostic about *where*
credentials come from -- callers pass a fully-resolved NombaCredentials
object (already decrypted). It never reads the database or the
encryption master key itself, keeping this module testable with plain
in-memory fixtures and keeping payment_crypto.py as the only place that
touches PAYMENT_CONFIG_ENCRYPTION_KEY.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import time
from dataclasses import dataclass
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

PRODUCTION_BASE_URL = "https://api.nomba.com"
SANDBOX_BASE_URL = "https://sandbox.nomba.com"
PRODUCTION_CHECKOUT_PREFIX = "/v1/checkout/"
SANDBOX_CHECKOUT_PREFIX = "/sandbox/checkout/"

_REQUEST_TIMEOUT_SECONDS = 15.0
_TOKEN_EXPIRY_SAFETY_MARGIN_SECONDS = 60


def _redact(value: Optional[str], keep: int = 4) -> str:
    """For structured log lines only -- never logs a usable secret."""
    if not value:
        return "<empty>"
    if len(value) <= keep:
        return "*" * len(value)
    return f"{'*' * (len(value) - keep)}{value[-keep:]}"


@dataclass
class NombaCredentials:
    """Already-decrypted credentials for one environment. Never logged,
    never serialized back to a client -- constructed fresh from
    payment_crypto.decrypt_secret() results by the caller for the
    duration of a single request/operation."""
    client_id: str
    client_secret: str
    account_id: str
    webhook_signature_key: str
    environment: str  # "sandbox" | "production"

    def __post_init__(self):
        if self.environment not in ("sandbox", "production"):
            raise ValueError(f"Invalid Nomba environment: {self.environment!r}")

    @property
    def base_url(self) -> str:
        return SANDBOX_BASE_URL if self.environment == "sandbox" else PRODUCTION_BASE_URL

    @property
    def checkout_prefix(self) -> str:
        return SANDBOX_CHECKOUT_PREFIX if self.environment == "sandbox" else PRODUCTION_CHECKOUT_PREFIX


class NombaError(RuntimeError):
    """Raised for any Nomba API failure (network, non-200, malformed
    response). Callers must treat this as 'verification unavailable, stay
    pending' -- never as 'payment failed' -- matching the existing
    Paystack _fulfill_payment() fail-safe pattern (see server.py)."""


# ---------------------------------------------------------------------
# In-process token cache. Keyed by (environment, account_id) so sandbox
# and production credentials (and any future multi-account setup) never
# share a cached token. A single dict is fine here -- this backend is a
# single FastAPI process, same assumption the existing _gold_cache
# pattern in server.py already makes.
# ---------------------------------------------------------------------
_token_cache: dict[str, dict] = {}


async def get_access_token(creds: NombaCredentials, force_refresh: bool = False) -> str:
    """Returns a cached token if not near expiry, otherwise issues a new
    one via client-credentials grant. Never returns a token past its
    documented expiresAt minus a safety margin."""
    cache_key = f"{creds.environment}:{creds.account_id}"
    cached = _token_cache.get(cache_key)
    now = time.time()
    if not force_refresh and cached and cached["expires_at_epoch"] - _TOKEN_EXPIRY_SAFETY_MARGIN_SECONDS > now:
        return cached["access_token"]

    url = f"{creds.base_url}/v1/auth/token/issue"
    body = {
        "grant_type": "client_credentials",
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
    }
    headers = {"Content-Type": "application/json", "accountId": creds.account_id}
    try:
        async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_SECONDS) as http:
            resp = await http.post(url, headers=headers, json=body)
    except httpx.TimeoutException as exc:
        logger.error(f"NOMBA_TOKEN_TIMEOUT env={creds.environment} accountId={_redact(creds.account_id)}")
        raise NombaError("Timed out requesting Nomba access token") from exc
    except httpx.HTTPError as exc:
        logger.error(f"NOMBA_TOKEN_NETWORK_ERROR env={creds.environment}: {exc}")
        raise NombaError(f"Network error requesting Nomba access token: {exc}") from exc

    if resp.status_code != 200:
        logger.error(
            f"NOMBA_TOKEN_NON_200 env={creds.environment} status={resp.status_code} "
            f"accountId={_redact(creds.account_id)}"
        )
        raise NombaError(f"Nomba token issuance returned HTTP {resp.status_code}")

    try:
        payload = resp.json()
        data = payload["data"]
        access_token = data["access_token"]
        expires_at_iso = data["expiresAt"]
    except (ValueError, KeyError) as exc:
        logger.error(f"NOMBA_TOKEN_MALFORMED_RESPONSE env={creds.environment}: {exc}")
        raise NombaError("Malformed response from Nomba token endpoint") from exc

    expires_at_epoch = _parse_iso8601_to_epoch(expires_at_iso)
    _token_cache[cache_key] = {"access_token": access_token, "expires_at_epoch": expires_at_epoch}
    logger.info(f"NOMBA_TOKEN_ISSUED env={creds.environment} accountId={_redact(creds.account_id)} expiresAt={expires_at_iso}")
    return access_token


def _parse_iso8601_to_epoch(iso_str: str) -> float:
    from datetime import datetime
    s = iso_str.replace("Z", "+00:00")
    return datetime.fromisoformat(s).timestamp()


async def create_checkout_order(
    creds: NombaCredentials,
    *,
    order_reference: str,
    amount: float,
    currency: str,
    callback_url: str,
    customer_email: str,
    allowed_payment_methods: Optional[list] = None,
    idempotency_key: Optional[str] = None,
) -> dict:
    """Creates a Nomba-hosted checkout order. Returns
    {"checkout_link": str, "order_reference": str}.

    amount is passed as a Python float/Decimal by the caller and
    formatted here as the "10000.00" string format the API requires --
    callers should pass the exact expected charge amount, computed
    server-side from admin-configured pricing, never from client input
    (mirrors the existing PAYSTACK_AMOUNT_MISMATCH discipline in
    server.py's initialize_purchase())."""
    token = await get_access_token(creds)
    url = f"{creds.base_url}{creds.checkout_prefix}order"
    order_body = {
        "orderReference": order_reference,
        "amount": f"{amount:.2f}",
        "currency": currency,
        "callbackUrl": callback_url,
        "customerEmail": customer_email,
    }
    if allowed_payment_methods:
        order_body["allowedPaymentMethods"] = allowed_payment_methods
    body = {"order": order_body}
    headers = {
        "Authorization": f"Bearer {token}",
        "accountId": creds.account_id,
        "Content-Type": "application/json",
    }
    if idempotency_key:
        headers["X-Idempotent-key"] = idempotency_key

    try:
        async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_SECONDS) as http:
            resp = await http.post(url, headers=headers, json=body)
    except httpx.TimeoutException as exc:
        logger.error(f"NOMBA_CHECKOUT_CREATE_TIMEOUT ref={order_reference}")
        raise NombaError("Timed out creating Nomba checkout order") from exc
    except httpx.HTTPError as exc:
        logger.error(f"NOMBA_CHECKOUT_CREATE_NETWORK_ERROR ref={order_reference}: {exc}")
        raise NombaError(f"Network error creating Nomba checkout order: {exc}") from exc

    if resp.status_code != 200:
        logger.error(f"NOMBA_CHECKOUT_CREATE_NON_200 ref={order_reference} status={resp.status_code}")
        raise NombaError(f"Nomba checkout order creation returned HTTP {resp.status_code}")

    try:
        payload = resp.json()
        data = payload["data"]
        checkout_link = data["checkoutLink"]
        returned_reference = data["orderReference"]
    except (ValueError, KeyError) as exc:
        logger.error(f"NOMBA_CHECKOUT_CREATE_MALFORMED_RESPONSE ref={order_reference}: {exc}")
        raise NombaError("Malformed response from Nomba checkout order endpoint") from exc

    logger.info(f"NOMBA_CHECKOUT_CREATED ref={returned_reference} env={creds.environment}")
    return {"checkout_link": checkout_link, "order_reference": returned_reference}


@dataclass
class NombaVerificationResult:
    """Normalized result of an independent transaction-verification
    call -- callers must never activate a purchase on webhook/signature
    alone, only on this."""
    status: str  # "SUCCESS" | "PENDING" | "FAILED" | "NOT_FOUND" | "ERROR"
    amount: Optional[float]
    currency: Optional[str]
    order_reference: Optional[str]
    nomba_transaction_id: Optional[str]
    raw: dict


async def verify_transaction(creds: NombaCredentials, *, order_reference: str) -> NombaVerificationResult:
    """Independently confirms a transaction's real status directly with
    Nomba -- this is the authoritative check. A valid webhook signature
    alone is never sufficient (per the owner's spec and Nomba's own
    documented guidance: "Never rely solely on the webhook without
    server-side verification")."""
    token = await get_access_token(creds)
    id_type = "orderReference" if creds.environment == "sandbox" else "orderReference"
    url = f"{creds.base_url}{creds.checkout_prefix}transaction"
    headers = {"Authorization": f"Bearer {token}", "accountId": creds.account_id}
    params = {"idType": id_type, "id": order_reference}

    try:
        async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_SECONDS) as http:
            resp = await http.get(url, headers=headers, params=params)
    except httpx.TimeoutException as exc:
        logger.error(f"NOMBA_VERIFY_TIMEOUT ref={order_reference}")
        raise NombaError("Timed out verifying Nomba transaction") from exc
    except httpx.HTTPError as exc:
        logger.error(f"NOMBA_VERIFY_NETWORK_ERROR ref={order_reference}: {exc}")
        raise NombaError(f"Network error verifying Nomba transaction: {exc}") from exc

    if resp.status_code == 404:
        logger.warning(f"NOMBA_VERIFY_NOT_FOUND ref={order_reference}")
        return NombaVerificationResult(
            status="NOT_FOUND", amount=None, currency=None,
            order_reference=order_reference, nomba_transaction_id=None, raw={},
        )
    if resp.status_code != 200:
        logger.error(f"NOMBA_VERIFY_NON_200 ref={order_reference} status={resp.status_code}")
        raise NombaError(f"Nomba transaction verification returned HTTP {resp.status_code}")

    try:
        payload = resp.json()
    except ValueError as exc:
        logger.error(f"NOMBA_VERIFY_MALFORMED_RESPONSE ref={order_reference}: {exc}")
        raise NombaError("Malformed response from Nomba transaction verification") from exc

    data = payload.get("data", {}) or {}
    order = data.get("order", {}) or {}
    txn_details = data.get("transactionDetails", {}) or {}
    success = bool(data.get("success"))
    status_code = str(txn_details.get("statusCode", "")).upper()

    if success or "SUCCESSFUL" in status_code:
        status = "SUCCESS"
    elif status_code in ("", "PENDING"):
        status = "PENDING"
    else:
        status = "FAILED"

    amount_raw = order.get("amount")
    try:
        amount = float(amount_raw) if amount_raw is not None else None
    except (TypeError, ValueError):
        amount = None

    result = NombaVerificationResult(
        status=status,
        amount=amount,
        currency=order.get("currency"),
        order_reference=order.get("orderReference", order_reference),
        nomba_transaction_id=txn_details.get("paymentReference"),
        raw=payload,
    )
    logger.info(f"NOMBA_VERIFY_RESULT ref={order_reference} status={result.status} amount={result.amount}")
    return result


# ---------------------------------------------------------------------
# Webhook signature verification
# ---------------------------------------------------------------------

def verify_webhook_signature(
    *,
    signature_header: str,
    timestamp_header: str,
    webhook_signature_key: str,
    event_type: str,
    request_id: str,
    merchant_user_id: str,
    merchant_wallet_id: str = "",
    transaction_id: str,
    transaction_type: str,
    transaction_time: str,
    transaction_response_code: str = "",
) -> bool:
    """Recomputes Nomba's HMAC-SHA256 webhook signature and compares it
    (constant-time) against the nomba-signature header.

    Formula confirmed against Nomba's own official Go code sample (see
    audits/nomba_migration/02_nomba_api_reference.md): a 9-field
    colon-separated string, HMAC-SHA256'd with the webhook signature
    key, base64-encoded. Missing fields (merchant.walletId and
    transaction.responseCode are both absent on checkout-order webhook
    payloads specifically) become empty strings in the hash input --
    NOT omitted segments -- confirmed by the official sample's own
    `if responseCode == "null": responseCode = ""` normalization.
    Getting this wrong means every real checkout webhook silently fails
    verification, so every field defaults to "" rather than raising on
    a missing key, matching Nomba's own documented behavior exactly."""
    if not signature_header or not webhook_signature_key:
        return False
    hashing_payload = ":".join([
        event_type or "",
        request_id or "",
        merchant_user_id or "",
        merchant_wallet_id or "",
        transaction_id or "",
        transaction_type or "",
        transaction_time or "",
        transaction_response_code or "",
        timestamp_header or "",
    ])
    computed = base64.b64encode(
        hmac.new(webhook_signature_key.encode("utf-8"), hashing_payload.encode("utf-8"), hashlib.sha256).digest()
    ).decode("ascii")
    return hmac.compare_digest(computed, signature_header)


def extract_webhook_signature_fields(payload: dict) -> dict:
    """Pulls the fields verify_webhook_signature() needs out of a parsed
    webhook JSON body, defaulting every optional field to "" rather than
    raising on a KeyError -- a checkout payment_success payload legitimately
    omits merchant.walletId and transaction.responseCode (see module
    docstring); a malformed/forged payload should fail signature
    comparison naturally, not raise before we even get to compare."""
    data = payload.get("data", {}) or {}
    merchant = data.get("merchant", {}) or {}
    transaction = data.get("transaction", {}) or {}
    return {
        "event_type": payload.get("event_type", ""),
        "request_id": payload.get("requestId", ""),
        "merchant_user_id": merchant.get("userId", ""),
        "merchant_wallet_id": merchant.get("walletId", ""),
        "transaction_id": transaction.get("transactionId", ""),
        "transaction_type": transaction.get("type", ""),
        "transaction_time": transaction.get("time", ""),
        "transaction_response_code": transaction.get("responseCode") or "",
    }


def extract_order_reference(payload: dict) -> Optional[str]:
    """The correlation key back to our own payment_transactions.reference."""
    data = payload.get("data", {}) or {}
    order = data.get("order", {}) or {}
    return order.get("orderReference")
