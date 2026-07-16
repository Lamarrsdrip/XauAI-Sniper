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
        if direction in ("NO_VALID_OUTLOOK", "NEUTRAL", "RANGE"):
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
            for device in target_devices:
                ok = await _send_webpush(device, payload)
                if ok:
                    delivered_any = True
                else:
                    await db.cloud_push_subscriptions.delete_one({"id": device.get("id")})
            log_entry["sent_time"] = datetime.now(timezone.utc).isoformat()
            log_entry["delivery_status"] = "SENT" if delivered_any else "FAILED"
            await db.cloud_notification_log.insert_one(log_entry)
            if delivered_any:
                sent += 1
        return sent
    except Exception as e:
        logger.error(f"NOTIFICATION_DISPATCH_FAILED event={event} outlook={doc.get('id')}: {e}")
        return 0


async def _send_webpush(device: Dict, payload: Dict) -> bool:
    if not vapid_configured():
        logger.info(f"NOTIFICATION_SKIPPED_NO_VAPID device={device.get('id')} payload={payload.get('title')}")
        return False
    try:
        from pywebpush import webpush, WebPushException
    except ImportError:
        logger.warning("pywebpush not installed -- notification not sent. `pip install pywebpush` on the backend.")
        return False
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
        return True
    except WebPushException as e:
        logger.warning(f"WEBPUSH_FAILED device={device.get('id')}: {e}")
        return False
    except Exception as e:
        logger.warning(f"WEBPUSH_UNEXPECTED_ERROR device={device.get('id')}: {e}")
        return False
