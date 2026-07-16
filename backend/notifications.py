"""Web Push notification dispatch for the AI Market Outlook feature.

Uses standard Web Push (RFC 8030) with self-generated VAPID keys -- no
external account, no Firebase/APNs project, no service-account key. The
VAPID keypair is generated once, locally (`npx web-push generate-vapid-keys`),
and stored as two environment variables (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY).

STRICT SEPARATION: this module only reads cloud_notification_prefs and
cloud_push_subscriptions (both owned by this feature) and writes to
cloud_notification_log. It never touches any EA/trade collection and never
calls any trading-control endpoint.
"""

from __future__ import annotations

import os
import json
import uuid
import logging
from datetime import datetime, timezone
from typing import Dict, Optional

logger = logging.getLogger("notifications")

VAPID_PUBLIC_KEY = os.environ.get("VAPID_PUBLIC_KEY", "")
VAPID_PRIVATE_KEY = os.environ.get("VAPID_PRIVATE_KEY", "")
VAPID_CLAIMS_SUB = os.environ.get("VAPID_CONTACT_EMAIL", "mailto:support@xauaisniper.com")

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


def _db():
    import server as _srv
    return _srv.db


def vapid_configured() -> bool:
    return bool(VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY)


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
# proof the device is gone.
PERMANENT_SUBSCRIPTION_GONE = "PERMANENT_SUBSCRIPTION_GONE"
TEMPORARY_DELIVERY_FAILURE = "TEMPORARY_DELIVERY_FAILURE"
SERVER_NOT_CONFIGURED = "SERVER_NOT_CONFIGURED"
DEPENDENCY_MISSING = "DEPENDENCY_MISSING"
INVALID_PAYLOAD = "INVALID_PAYLOAD"
UNKNOWN_FAILURE = "UNKNOWN_FAILURE"


async def _send_webpush(device: Dict, payload: Dict) -> tuple:
    """Returns (ok: bool, failure_class: Optional[str])."""
    if not vapid_configured():
        logger.info(f"NOTIFICATION_SKIPPED_NO_VAPID device={device.get('id')} payload={payload.get('title')}")
        return False, SERVER_NOT_CONFIGURED
    try:
        from pywebpush import webpush, WebPushException
    except ImportError:
        logger.warning("pywebpush not installed -- notification not sent. `pip install pywebpush` on the backend.")
        return False, DEPENDENCY_MISSING
    try:
        webpush(
            subscription_info={
                "endpoint": device.get("endpoint"),
                "keys": device.get("keys", {}),
            },
            data=json.dumps(payload),
            vapid_private_key=VAPID_PRIVATE_KEY,
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
        logger.warning(f"WEBPUSH_TEMPORARY_FAILURE device={device.get('id')} status={status_code}: {e}")
        return False, TEMPORARY_DELIVERY_FAILURE
    except Exception as e:
        logger.warning(f"WEBPUSH_UNEXPECTED_ERROR device={device.get('id')}: {e}")
        return False, UNKNOWN_FAILURE


async def send_test_notification(user_id: str) -> Dict:
    """Real production dispatcher, not a second fake path. Uses the same
    _send_webpush() every real event uses. Returns a structured status the
    frontend can render without guessing (SENT/FAILED/NO_DEVICE/
    SERVER_NOT_CONFIGURED/DEPENDENCY_MISSING/SUBSCRIPTION_EXPIRED). Never
    creates an Outlook and never touches trading state."""
    db = _db()
    if not vapid_configured():
        return {"status": "SERVER_NOT_CONFIGURED", "message": "Push server VAPID keys are not configured."}
    try:
        from pywebpush import webpush  # noqa: F401 -- import-availability probe
    except ImportError:
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
    return {"status": "FAILED", "message": f"Delivery failed ({last_failure or UNKNOWN_FAILURE})."}


async def get_notification_status(user_id: str, account: str = "") -> Dict:
    """Real, authenticated registration-status snapshot -- the frontend must
    render THIS, never infer ON from the saved preference tier alone."""
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
    server_ready = vapid_configured()
    try:
        import pywebpush  # noqa: F401
        dependency_available = True
    except ImportError:
        dependency_available = False

    if saved_tier == "OFF":
        final_status = "OFF"
    elif not server_ready:
        final_status = "SERVER_NOT_CONFIGURED"
    elif not dependency_available:
        final_status = "SERVER_NOT_CONFIGURED"
    elif not devices:
        final_status = "SUBSCRIPTION_MISSING"
    elif last_log and last_log.get("delivery_status") == "FAILED" and last_log.get("notification_type") in ("TEST_NOTIFICATION",):
        final_status = "DELIVERY_FAILED"
    else:
        final_status = "ON_VERIFIED"

    return {
        "saved_tier": saved_tier,
        "active_device_count": len(devices),
        "most_recent_registration": last_reg,
        "push_server_configured": server_ready,
        "delivery_library_available": dependency_available,
        "latest_notification_status": (last_log or {}).get("delivery_status"),
        "latest_failure_reason": (last_log or {}).get("failure_reason"),
        "latest_sent_time": (last_log or {}).get("sent_time"),
        "latest_opened_time": (last_log or {}).get("opened_time"),
        "final_status": final_status,
    }
