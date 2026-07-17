"""Web Push notification dispatch for the AI Market Outlook feature.

Uses standard Web Push (RFC 8030) with VAPID keys -- no external account, no
Firebase/APNs project, no service-account key. v6.25.2 owner directive
2026-07-17: the keypair is now self-initializing and self-healing, not a
manual one-time `npx web-push generate-vapid-keys` + environment-variable
step that silently breaks every deployment that forgot to set it. See
initialize_vapid_keys() below for the canonical load-or-create flow.

STRICT SEPARATION: this module only reads cloud_notification_prefs and
cloud_push_subscriptions (both owned by this feature) and writes to
cloud_notification_log. It never touches any EA/trade collection and never
calls any trading-control endpoint.
"""

from __future__ import annotations

import os
import json
import uuid
import hashlib
import asyncio
import logging
from datetime import datetime, timezone
from typing import Dict, Optional

from pymongo.errors import DuplicateKeyError

logger = logging.getLogger("notifications")

VAPID_CLAIMS_SUB = os.environ.get("VAPID_CONTACT_EMAIL", "mailto:support@xauaisniper.com")


def _db():
    import server as _srv
    return _srv.db


# ---------------------------------------------------------------------------
# v6.25.2 owner directive 2026-07-17 -- canonical, self-initializing,
# restart-safe VAPID key state. Never cache an empty environment value at
# import time (the bug that produced the permanent SERVER_NOT_CONFIGURED
# failure this fixes) -- everything below is a runtime accessor over
# _VAPID_STATE, populated once by initialize_vapid_keys() at backend
# startup, before any notification route may report readiness.
# ---------------------------------------------------------------------------
VAPID_STATE_INITIALIZING = "INITIALIZING"
VAPID_STATE_READY_ENV = "READY_ENV"
VAPID_STATE_READY_DATABASE = "READY_DATABASE"
VAPID_STATE_GENERATION_FAILED = "GENERATION_FAILED"
VAPID_STATE_INVALID_KEYPAIR = "INVALID_KEYPAIR"
VAPID_STATE_DEPENDENCY_MISSING = "DEPENDENCY_MISSING"
_VAPID_READY_STATES = (VAPID_STATE_READY_ENV, VAPID_STATE_READY_DATABASE)

_VAPID_STATE: Dict = {
    "state": VAPID_STATE_INITIALIZING,
    "public_key": "",
    "private_key": "",
    "fingerprint": "",
}
_vapid_init_lock = asyncio.Lock()
_vapid_init_event = asyncio.Event()


def _vapid_fingerprint(public_key: str) -> str:
    """Safe-to-log/return identifier for a public key -- never the key
    itself in a context where a rotation needs to be detected without
    exposing the raw material redundantly."""
    return hashlib.sha256(public_key.encode("utf-8")).hexdigest()[:16]


def _validate_vapid_keypair(public_key: str, private_key: str) -> bool:
    """Real cryptographic validation, not a non-empty-string assumption:
    the two keys must form a matching P-256 pair, the public key must be in
    the exact URL-safe base64 uncompressed-point format the browser's
    PushManager.subscribe(applicationServerKey=...) and pywebpush both
    require, and the private key must actually work for VAPID JWT signing
    (a real dry-run sign, no network call). Never logs the private key."""
    try:
        if not public_key or not private_key:
            return False
        public_key = public_key.strip()
        private_key = private_key.strip()
        if "\n" in public_key or "\n" in private_key or "'" in public_key or "'" in private_key \
           or '"' in public_key or '"' in private_key:
            return False
        from py_vapid import Vapid01
        from py_vapid.utils import b64urlencode
        from cryptography.hazmat.primitives import serialization
        vapid = Vapid01.from_string(private_key)
        derived_pub_bytes = vapid.public_key.public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint,
        )
        if len(derived_pub_bytes) != 65 or derived_pub_bytes[0] != 0x04:
            return False  # not an uncompressed P-256 point
        if b64urlencode(derived_pub_bytes) != public_key:
            return False  # public key does not match this private key
        # Dry-run signing test -- proves pywebpush's exact code path (which
        # calls Vapid.sign() internally) works with this private key.
        vapid.sign({"sub": VAPID_CLAIMS_SUB, "aud": "https://validation.local"})
        return True
    except Exception as e:
        logger.warning(f"VAPID_KEYPAIR_VALIDATION_FAILED reason={type(e).__name__}")
        return False


def _generate_vapid_keypair() -> tuple:
    """Generates one fresh, valid, browser/pywebpush-compatible VAPID P-256
    keypair. Returns (public_key_urlsafe_b64, private_key_urlsafe_b64)."""
    from py_vapid import Vapid01
    from py_vapid.utils import b64urlencode
    from cryptography.hazmat.primitives import serialization
    vapid = Vapid01()
    vapid.generate_keys()
    priv_raw = vapid.private_key.private_numbers().private_value.to_bytes(32, "big")
    private_key_str = b64urlencode(priv_raw)
    pub_bytes = vapid.public_key.public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint,
    )
    public_key_str = b64urlencode(pub_bytes)
    return public_key_str, private_key_str


async def initialize_vapid_keys() -> None:
    """Canonical asynchronous VAPID initialization. Must be awaited once
    from the backend's startup event, before any request is served. Priority:
    1) valid VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY environment variables;
    2) the existing persisted keypair in db.system_settings/_id=web_push_vapid_primary;
    3) generate a new keypair and atomically persist it -- if two workers
       race this at once, MongoDB's unique _id constraint on that document
       lets exactly one insert win; the loser rereads and uses the winner's
       persisted pair, so both workers converge on the SAME keypair. Never
       regenerates on an ordinary restart -- a changed public key silently
       invalidates every existing browser subscription."""
    if _vapid_init_event.is_set():
        return  # already initialized this process
    async with _vapid_init_lock:
        if _vapid_init_event.is_set():
            return
        try:
            import pywebpush  # noqa: F401 -- dependency probe
        except ImportError:
            _VAPID_STATE["state"] = VAPID_STATE_DEPENDENCY_MISSING
            logger.error("WEBPUSH_DEPENDENCY available=false -- `pip install pywebpush` on the backend")
            _vapid_init_event.set()
            return

        env_pub = os.environ.get("VAPID_PUBLIC_KEY", "").strip()
        env_priv = os.environ.get("VAPID_PRIVATE_KEY", "").strip()
        if env_pub and env_priv and _validate_vapid_keypair(env_pub, env_priv):
            _VAPID_STATE.update(state=VAPID_STATE_READY_ENV, public_key=env_pub, private_key=env_priv,
                                 fingerprint=_vapid_fingerprint(env_pub))
            logger.info(f"VAPID_INIT state=READY_ENV fingerprint={_VAPID_STATE['fingerprint']}")
            logger.info("WEBPUSH_DEPENDENCY available=true")
            logger.info(f"PUSH_SERVER_READY configured=true fingerprint={_VAPID_STATE['fingerprint']}")
            _vapid_init_event.set()
            return
        if env_pub or env_priv:
            logger.warning("VAPID env vars present but failed cryptographic validation -- falling back to database keypair")

        db = _db()
        doc = await db.system_settings.find_one({"_id": "web_push_vapid_primary"})
        if doc and _validate_vapid_keypair(doc.get("public_key", ""), doc.get("private_key", "")):
            _VAPID_STATE.update(state=VAPID_STATE_READY_DATABASE, public_key=doc["public_key"],
                                 private_key=doc["private_key"], fingerprint=_vapid_fingerprint(doc["public_key"]))
            logger.info(f"VAPID_INIT state=READY_DATABASE fingerprint={_VAPID_STATE['fingerprint']}")
            logger.info("WEBPUSH_DEPENDENCY available=true")
            logger.info(f"PUSH_SERVER_READY configured=true fingerprint={_VAPID_STATE['fingerprint']}")
            _vapid_init_event.set()
            return
        if doc:
            logger.warning("Persisted VAPID keypair failed cryptographic validation -- will not silently regenerate; reporting INVALID_KEYPAIR")
            _VAPID_STATE["state"] = VAPID_STATE_INVALID_KEYPAIR
            _vapid_init_event.set()
            return

        # No env pair, no persisted pair -- generate once and atomically
        # claim the single canonical document.
        pub, priv = _generate_vapid_keypair()
        if not _validate_vapid_keypair(pub, priv):
            _VAPID_STATE["state"] = VAPID_STATE_GENERATION_FAILED
            logger.error("VAPID_INIT state=GENERATION_FAILED -- self-generated keypair failed its own validation")
            _vapid_init_event.set()
            return
        try:
            await db.system_settings.insert_one({
                "_id": "web_push_vapid_primary",
                "public_key": pub,
                "private_key": priv,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            winning_pub, winning_priv = pub, priv
            logger.info("VAPID_KEYPAIR_GENERATED_AND_PERSISTED (this worker won the creation race)")
        except DuplicateKeyError:
            # Another worker started simultaneously and already persisted a
            # pair -- reread it so every worker converges on the SAME keys.
            reread = await db.system_settings.find_one({"_id": "web_push_vapid_primary"})
            winning_pub, winning_priv = reread.get("public_key", ""), reread.get("private_key", "")
            logger.info("VAPID_KEYPAIR_CREATION_RACE_LOST -- reread the winning persisted pair from another worker")

        if not _validate_vapid_keypair(winning_pub, winning_priv):
            _VAPID_STATE["state"] = VAPID_STATE_INVALID_KEYPAIR
            logger.error("VAPID_INIT state=INVALID_KEYPAIR -- persisted winner failed re-validation after re-read")
            _vapid_init_event.set()
            return

        _VAPID_STATE.update(state=VAPID_STATE_READY_DATABASE, public_key=winning_pub, private_key=winning_priv,
                             fingerprint=_vapid_fingerprint(winning_pub))
        logger.info(f"VAPID_INIT state=READY_DATABASE fingerprint={_VAPID_STATE['fingerprint']} (newly generated)")
        logger.info("WEBPUSH_DEPENDENCY available=true")
        logger.info(f"PUSH_SERVER_READY configured=true fingerprint={_VAPID_STATE['fingerprint']}")
        _vapid_init_event.set()


async def _await_vapid_init() -> None:
    """Every accessor below calls this first -- a request that arrives
    before startup's initialize_vapid_keys() call finishes must wait for it
    rather than racing ahead and observing an empty/INITIALIZING state."""
    if not _vapid_init_event.is_set():
        await _vapid_init_event.wait()


async def get_vapid_status() -> Dict:
    """Safe-to-return-to-the-frontend status snapshot. Never includes the
    private key."""
    await _await_vapid_init()
    state = _VAPID_STATE["state"]
    return {
        "configured": state in _VAPID_READY_STATES,
        "initialization_state": state,
        "public_key": _VAPID_STATE["public_key"] if state in _VAPID_READY_STATES else "",
        "key_fingerprint": _VAPID_STATE["fingerprint"],
        "dependency_available": state != VAPID_STATE_DEPENDENCY_MISSING,
    }


async def get_vapid_public_key() -> str:
    await _await_vapid_init()
    return _VAPID_STATE["public_key"]


async def get_vapid_private_key() -> str:
    await _await_vapid_init()
    return _VAPID_STATE["private_key"]


async def vapid_configured() -> bool:
    await _await_vapid_init()
    return _VAPID_STATE["state"] in _VAPID_READY_STATES

# Notification tier ordering -- an event's min_tier must be <= the user's
# configured tier for it to actually be sent.
_TIER_RANK = {"OFF": 0, "HOURLY_ONLY": 1, "HOURLY_PLUS_RESULTS": 2, "ALL_UPDATES": 3}
_EVENT_MIN_TIER = {
    "OUTLOOK_PUBLISHED": "HOURLY_ONLY",
    "ENTRY_ZONE_REACHED": "ALL_UPDATES",
    "OUTLOOK_ACTIVATED": "HOURLY_PLUS_RESULTS",
    "TP1_HIT": "HOURLY_PLUS_RESULTS",
    "TP2_HIT": "HOURLY_PLUS_RESULTS",
    "TP3_HIT": "HOURLY_PLUS_RESULTS",
    "SL_HIT": "HOURLY_PLUS_RESULTS",
    "INVALIDATED": "ALL_UPDATES",
    "EXPIRED_NO_ENTRY": "ALL_UPDATES",
}


def _idempotency_key(outlook_id: str, event: str, user_id: str) -> str:
    return f"{event}:{outlook_id}:{user_id}"


def _build_payload(doc: Dict, event: str) -> Dict:
    direction = doc.get("primary_direction", "NO_VALID_OUTLOOK")
    confidence = doc.get("confidence_pct", 0)
    deep_link = f"/ai-market-outlook?outlook_id={doc.get('id')}"

    if event == "OUTLOOK_PUBLISHED":
        if direction in ("NO_VALID_OUTLOOK", "NEUTRAL", "RANGE", "TRANSITION"):
            title = "XAU AI Sniper — Hourly Outlook"
            body = f"No valid directional outlook this hour. Market state: {direction}. Confidence: {confidence}%"
        else:
            title = "XAU AI Sniper — Hourly Outlook"
            body = (f"{direction} outlook · {confidence}% confidence\n"
                   f"Entry: {doc.get('preferred_entry_zone_low')}–{doc.get('preferred_entry_zone_high')}\n"
                   f"SL: {doc.get('suggested_sl')} | TP1: {doc.get('tp1_price')} TP2: {doc.get('tp2_price')} TP3: {doc.get('tp3_price')}")
    elif event == "OUTLOOK_ACTIVATED":
        title = "XAU Outlook Update"
        body = f"{direction} outlook activated at {(doc.get('activation') or {}).get('activated_price')}\nTP1 target: {doc.get('tp1_price')}"
    elif event in ("TP1_HIT", "TP2_HIT", "TP3_HIT"):
        r_field = {"TP1_HIT": "tp1_r", "TP2_HIT": "tp2_r", "TP3_HIT": "tp3_r"}[event]
        title = "XAU Outlook Result"
        body = f"{event.replace('_HIT',' hit').replace('TP','TP')}\nResult: +{doc.get(r_field)}R\nOutlook: {direction} · {confidence}%"
    elif event == "SL_HIT":
        title = "XAU Outlook Result"
        body = f"Stopped\nResult: -1R\nOutlook: {direction} · {confidence}%"
    elif event == "INVALIDATED":
        title = "XAU Outlook Update"
        body = f"{direction} outlook invalidated before entry."
    elif event == "EXPIRED_NO_ENTRY":
        title = "XAU Outlook Update"
        body = f"{direction} outlook expired — entry zone never reached."
    else:
        title = "XAU AI Sniper"
        body = event

    return {"title": title, "body": body, "deep_link": deep_link, "outlook_id": doc.get("id"), "event": event}


async def send_outlook_notification(doc: Dict, event: str, min_tier: str) -> int:
    """Sends (or logs-as-skipped) a notification for `event` to every user
    subscribed to this outlook's account, respecting per-user tier and
    idempotency. Returns count of pushes actually sent. Never raises --
    notification failures must never affect outlook generation/tracking."""
    try:
        db = _db()
        account = doc.get("account", "")
        outlook_id = doc.get("id", "")
        prefs_cursor = db.cloud_notification_prefs.find({"account": account})
        sent = 0
        async for prefs in prefs_cursor:
            user_id = prefs.get("user_id", "")
            tier = prefs.get("tier", "OFF")
            required_tier = _EVENT_MIN_TIER.get(event, min_tier)
            if _TIER_RANK.get(tier, 0) < _TIER_RANK.get(required_tier, 99):
                continue
            idem_key = _idempotency_key(outlook_id, event, user_id)
            already = await db.cloud_notification_log.find_one({"idempotency_key": idem_key})
            if already:
                continue
            payload = _build_payload(doc, event)
            devices = await db.cloud_push_subscriptions.find({"user_id": user_id}).to_list(10)
            target_devices = devices if prefs.get("notify_all_devices", True) else devices[:1]
            log_entry = {
                "id": str(uuid.uuid4()), "idempotency_key": idem_key, "user_id": user_id,
                "outlook_id": outlook_id, "notification_type": event,
                "scheduled_time": datetime.now(timezone.utc).isoformat(),
                "sent_time": None, "delivery_status": "PENDING", "opened_time": None,
                "device_count": len(target_devices), "retry_count": 0, "failure_reason": None,
            }
            if not target_devices:
                log_entry["delivery_status"] = "NO_DEVICE"
                await db.cloud_notification_log.insert_one(log_entry)
                continue
            delivered_any = False
            last_failure_class = None
            for device in target_devices:
                ok, failure_class = await _send_webpush(device, payload)
                if ok:
                    delivered_any = True
                else:
                    last_failure_class = failure_class
                    # v6.24.18 owner directive 2026-07-16 -- only a CONFIRMED
                    # permanent endpoint failure (browser/OS told us this
                    # subscription is gone/expired -- HTTP 404/410) may delete
                    # the device record. Every other failure class (server not
                    # configured, dependency missing, temporary network error,
                    # timeout, unexpected exception) must NOT delete a real
                    # device just because one push attempt failed -- that was
                    # silently unregistering working devices on ordinary
                    # transient errors.
                    if failure_class == "PERMANENT_SUBSCRIPTION_GONE":
                        await db.cloud_push_subscriptions.delete_one({"id": device.get("id")})
            log_entry["sent_time"] = datetime.now(timezone.utc).isoformat()
            log_entry["delivery_status"] = "SENT" if delivered_any else "FAILED"
            if not delivered_any:
                log_entry["failure_reason"] = last_failure_class or "UNKNOWN_FAILURE"
            await db.cloud_notification_log.insert_one(log_entry)
            if delivered_any:
                sent += 1
        return sent
    except Exception as e:
        logger.error(f"NOTIFICATION_DISPATCH_FAILED event={event} outlook={doc.get('id')}: {e}")
        return 0


# v6.24.18 owner directive 2026-07-16 -- explicit failure taxonomy. A push
# failure is not one undifferentiated "false" -- only PERMANENT_SUBSCRIPTION_GONE
# may ever cause a device record to be deleted; every other class is a
# temporary/environmental condition that must be retried, not treated as
# proof the device is gone. v6.25.2: added KEY_MISMATCH (device subscribed
# under a VAPID public key that is no longer the active one) and
# AUTHENTICATION_FAILED (push service rejected our VAPID auth itself, not
# the subscription) per the owner's expanded taxonomy.
PERMANENT_SUBSCRIPTION_GONE = "PERMANENT_SUBSCRIPTION_GONE"
TEMPORARY_DELIVERY_FAILURE = "TEMPORARY_DELIVERY_FAILURE"
SERVER_NOT_CONFIGURED = "SERVER_NOT_CONFIGURED"
DEPENDENCY_MISSING = "DEPENDENCY_MISSING"
INVALID_PAYLOAD = "INVALID_PAYLOAD"
AUTHENTICATION_FAILED = "AUTHENTICATION_FAILED"
KEY_MISMATCH = "KEY_MISMATCH"
UNKNOWN_FAILURE = "UNKNOWN_FAILURE"


async def _send_webpush(device: Dict, payload: Dict) -> tuple:
    """Returns (ok: bool, failure_class: Optional[str]). The one production
    dispatcher every caller (hourly outlook events, TP/SL results, the Send
    Test Notification button) funnels through -- there is no second path."""
    status = await get_vapid_status()
    if not status["configured"]:
        logger.info(f"NOTIFICATION_SKIPPED_NO_VAPID device={device.get('id')} payload={payload.get('title')} "
                    f"initialization_state={status['initialization_state']}")
        return False, SERVER_NOT_CONFIGURED
    if not status["dependency_available"]:
        return False, DEPENDENCY_MISSING
    try:
        from pywebpush import webpush, WebPushException
    except ImportError:
        logger.warning("pywebpush not installed -- notification not sent. `pip install pywebpush` on the backend.")
        return False, DEPENDENCY_MISSING

    # v6.25.2 owner directive -- if this device subscribed under a VAPID
    # public key that is no longer the active one (a real admin key
    # rotation, not the ordinary restart-retains-same-fingerprint case),
    # the push will fail with a browser-side error the caller cannot fix by
    # retrying. Detect it up front from the stored fingerprint so the
    # caller can prompt a resubscribe instead of endlessly retrying.
    device_fingerprint = device.get("vapid_key_fingerprint")
    if device_fingerprint and device_fingerprint != status["key_fingerprint"]:
        logger.warning(f"WEBPUSH_KEY_MISMATCH device={device.get('id')} "
                        f"deviceFingerprint={device_fingerprint} activeFingerprint={status['key_fingerprint']}")
        return False, KEY_MISMATCH

    private_key = await get_vapid_private_key()
    try:
        webpush(
            subscription_info={
                "endpoint": device.get("endpoint"),
                "keys": device.get("keys", {}),
            },
            data=json.dumps(payload),
            vapid_private_key=private_key,
            vapid_claims={"sub": VAPID_CLAIMS_SUB},
        )
        return True, None
    except WebPushException as e:
        status_code = getattr(getattr(e, "response", None), "status_code", None)
        if status_code in (404, 410):
            # Browser/OS push service confirmed this exact endpoint no
            # longer exists -- the only case that may delete the device.
            logger.warning(f"WEBPUSH_SUBSCRIPTION_GONE device={device.get('id')} status={status_code}: {e}")
            return False, PERMANENT_SUBSCRIPTION_GONE
        if status_code in (401, 403):
            logger.warning(f"WEBPUSH_AUTHENTICATION_FAILED device={device.get('id')} status={status_code}: {e}")
            return False, AUTHENTICATION_FAILED
        logger.warning(f"WEBPUSH_TEMPORARY_FAILURE device={device.get('id')} status={status_code}: {e}")
        return False, TEMPORARY_DELIVERY_FAILURE
    except Exception as e:
        logger.warning(f"WEBPUSH_UNEXPECTED_ERROR device={device.get('id')}: {e}")
        return False, UNKNOWN_FAILURE


async def send_test_notification(user_id: str) -> Dict:
    """Real production dispatcher, not a second fake path. Uses the same
    _send_webpush() every real event uses -- required flow per the owner:
    confirm VAPID READY, confirm pywebpush import, confirm authenticated
    caller (already enforced by the route's Depends(get_cloud_user) before
    this is ever called), confirm >=1 device, send, capture the real
    HTTP/provider outcome, log it, return a truthful status. Never returns
    SENT solely because no Python exception occurred -- SENT here means
    _send_webpush's own (ok=True) branch, which only fires after a real
    webpush() call raised nothing."""
    db = _db()
    status = await get_vapid_status()
    if not status["configured"]:
        return {"status": "SERVER_NOT_CONFIGURED", "message": "Push server VAPID keys are not configured.",
                "initialization_state": status["initialization_state"]}
    if not status["dependency_available"]:
        return {"status": "DEPENDENCY_MISSING", "message": "pywebpush is not installed on the backend."}

    devices = await db.cloud_push_subscriptions.find({"user_id": user_id}).to_list(10)
    if not devices:
        return {"status": "NO_DEVICE", "message": "No registered device subscription for this user."}

    payload = {"title": "XAU AI Sniper Test", "body": "Phone alerts are working.",
               "deep_link": "/ai-market-outlook", "outlook_id": None, "event": "TEST_NOTIFICATION"}
    sent_any = False
    last_failure = None
    for device in devices:
        ok, failure_class = await _send_webpush(device, payload)
        if ok:
            sent_any = True
        else:
            last_failure = failure_class
            if failure_class == PERMANENT_SUBSCRIPTION_GONE:
                await db.cloud_push_subscriptions.delete_one({"id": device.get("id")})
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.cloud_notification_log.insert_one({
        "id": str(uuid.uuid4()), "idempotency_key": f"TEST:{user_id}:{now_iso}",
        "user_id": user_id, "outlook_id": None, "notification_type": "TEST_NOTIFICATION",
        "scheduled_time": now_iso, "sent_time": now_iso,
        "delivery_status": "SENT" if sent_any else "FAILED",
        "device_count": len(devices), "retry_count": 0,
        "failure_reason": None if sent_any else (last_failure or UNKNOWN_FAILURE),
    })
    if sent_any:
        return {"status": "SENT", "message": "Test notification sent."}
    if last_failure == PERMANENT_SUBSCRIPTION_GONE:
        return {"status": "SUBSCRIPTION_EXPIRED", "message": "The stored subscription is no longer valid; please re-enable notifications."}
    if last_failure == KEY_MISMATCH:
        return {"status": "KEY_MISMATCH", "message": "This device subscribed under an old push key; please re-enable notifications to resubscribe."}
    return {"status": "FAILED", "message": f"Delivery failed ({last_failure or UNKNOWN_FAILURE})."}


async def get_notification_status(user_id: str, account: str = "") -> Dict:
    """Real, authenticated registration-status snapshot -- the frontend must
    render THIS, never infer ON from the saved preference tier alone. Only
    ON_VERIFIED once a real send has actually succeeded at least once;
    configured-and-registered-but-never-successfully-tested is
    READY_NOT_TESTED, a distinct, honest state."""
    db = _db()
    prefs = await db.cloud_notification_prefs.find_one({"user_id": user_id}, {"_id": 0})
    saved_tier = (prefs or {}).get("tier", "OFF")
    devices = await db.cloud_push_subscriptions.find({"user_id": user_id}).to_list(10)
    last_reg = None
    for d in devices:
        ts = d.get("created_at")
        if ts and (last_reg is None or ts > last_reg):
            last_reg = ts
    last_log = await db.cloud_notification_log.find_one(
        {"user_id": user_id}, {"_id": 0}, sort=[("scheduled_time", -1)],
    )
    last_sent_ok = await db.cloud_notification_log.find_one(
        {"user_id": user_id, "delivery_status": "SENT"}, {"_id": 0}, sort=[("scheduled_time", -1)],
    )
    vapid_status = await get_vapid_status()
    server_ready = vapid_status["configured"]
    dependency_available = vapid_status["dependency_available"]

    if saved_tier == "OFF":
        final_status = "OFF"
    elif not server_ready:
        final_status = "SERVER_NOT_CONFIGURED"
    elif not dependency_available:
        final_status = "DEPENDENCY_MISSING"
    elif not devices:
        final_status = "SUBSCRIPTION_MISSING"
    elif last_log and last_log.get("delivery_status") == "FAILED":
        final_status = "DELIVERY_FAILED"
    elif not last_sent_ok:
        final_status = "READY_NOT_TESTED"
    else:
        final_status = "ON_VERIFIED"

    return {
        "saved_tier": saved_tier,
        "active_device_count": len(devices),
        "most_recent_registration": last_reg,
        "push_server_configured": server_ready,
        "push_server_initialization_state": vapid_status["initialization_state"],
        "push_server_key_fingerprint": vapid_status["key_fingerprint"],
        "delivery_library_available": dependency_available,
        "latest_notification_status": (last_log or {}).get("delivery_status"),
        "latest_failure_reason": (last_log or {}).get("failure_reason"),
        "latest_sent_time": (last_log or {}).get("sent_time"),
        "latest_opened_time": (last_log or {}).get("opened_time"),
        "final_status": final_status,
    }
