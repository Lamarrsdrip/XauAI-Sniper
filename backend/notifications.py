"""Push notification dispatch for the AI Market Outlook feature, via OneSignal.

v6.25.3 owner directive 2026-07-17: switched from self-hosted Web Push
(pywebpush + VAPID) to OneSignal's REST API. The self-hosted implementation
required a Python package (pywebpush, plus its own transitive dependencies
py_vapid/http_ece) that was declared in backend/requirements.txt but never
actually installed in the production environment -- restarting a deployment
does not reinstall dependencies, so this was permanently DEPENDENCY_MISSING
until a full backend rebuild, which required Emergent-dashboard access the
operator did not want to depend on. OneSignal's REST API needs nothing but
a plain HTTPS POST (via `httpx`, already installed and used elsewhere in
this codebase), so it cannot fail the same way -- the only "not configured"
state now is the admin not having entered real OneSignal credentials yet,
which is a genuine, actionable input (Settings -> OneSignal App ID / REST
API Key), unlike a missing native package.

The previous self-hosted VAPID implementation (initialize_vapid_keys,
get_vapid_status, _send_webpush, etc.) has been removed entirely, not kept
as a dead fallback -- see git history if it's ever needed again.

STRICT SEPARATION: unchanged from before -- this module only reads
cloud_notification_prefs and cloud_push_subscriptions (both owned by this
feature) and writes to cloud_notification_log. It never touches any EA/
trade collection and never calls any trading-control endpoint.
"""

from __future__ import annotations

import uuid
import logging
from datetime import datetime, timezone
from typing import Dict, Optional

import httpx

logger = logging.getLogger("notifications")

ONESIGNAL_API_URL = "https://api.onesignal.com/notifications"


def _db():
    import server as _srv
    return _srv.db


async def _onesignal_config() -> Dict[str, str]:
    """Reads OneSignal App ID + REST API Key live from admin settings on
    every call -- never cached at import time, so the admin can paste in
    credentials and have them take effect immediately with no backend
    restart, unlike the retired VAPID system's startup-only initialization."""
    import server as _srv
    s = await _srv.get_settings()
    return {
        "app_id": (s.get("onesignal_app_id") or "").strip(),
        "api_key": (s.get("onesignal_api_key") or "").strip(),
    }


async def get_onesignal_status() -> Dict:
    """Safe-to-return-to-the-frontend status snapshot. Never includes the
    REST API key. app_id is not secret -- the browser SDK needs it directly
    to initialize, same as the old VAPID public key was safe to expose."""
    cfg = await _onesignal_config()
    configured = bool(cfg["app_id"] and cfg["api_key"])
    return {
        "configured": configured,
        "app_id": cfg["app_id"] if configured else "",
        "initialization_state": "READY" if configured else "NOT_CONFIGURED",
    }


async def get_onesignal_app_id() -> str:
    """Public, safe to expose without auth -- the frontend SDK's init() call
    needs this before the user is necessarily logged in."""
    cfg = await _onesignal_config()
    return cfg["app_id"]


# Notification tier ordering -- an event's min_tier must be <= the user's
# configured tier for it to actually be sent.
_TIER_RANK = {"OFF": 0, "HOURLY_ONLY": 1, "HOURLY_PLUS_RESULTS": 2, "ALL_UPDATES": 3}
_EVENT_MIN_TIER = {
    "TRACKING_STARTED": "HOURLY_ONLY",
    "HALF_R_REACHED": "HOURLY_PLUS_RESULTS",
    "TIMEOUT_60M": "HOURLY_PLUS_RESULTS",
    "OUTLOOK_PUBLISHED": "HOURLY_ONLY",
    "TP1_HIT": "HOURLY_PLUS_RESULTS",
    "TP2_HIT": "HOURLY_PLUS_RESULTS",
    "TP3_HIT": "HOURLY_PLUS_RESULTS",
    "SL_HIT": "HOURLY_PLUS_RESULTS",
}


def _idempotency_key(outlook_id: str, event: str, user_id: str) -> str:
    return f"{event}:{outlook_id}:{user_id}"


def _build_payload(doc: Dict, event: str) -> Dict:
    direction = doc.get("primary_direction", "NO_VALID_OUTLOOK")
    confidence = doc.get("confidence_pct", 0)
    deep_link = f"/ai-market-outlook?outlook_id={doc.get('id')}"

    signal_time = doc.get("published_at") or doc.get("generated_at")
    entry = doc.get("tracking_entry_price")
    event_snapshot = ((doc.get("event_snapshots") or {}).get(event) or {})
    event_at = event_snapshot.get("event_at") or {
        "HALF_R_REACHED": doc.get("first_half_r_at"), "TP1_HIT": doc.get("tp1_hit_at"),
        "TP2_HIT": doc.get("tp2_hit_at"), "TP3_HIT": doc.get("tp3_hit_at"),
        "SL_HIT": doc.get("sl_hit_at"), "TIMEOUT_60M": doc.get("evaluation_deadline"),
    }.get(event) or signal_time
    hit_price = event_snapshot.get("hit_price") if "hit_price" in event_snapshot else doc.get("last_tracked_price")
    achieved_r = event_snapshot.get("achieved_r") if "achieved_r" in event_snapshot else doc.get("current_r")
    timed_out = doc.get("analytics_outcome") == "LOSS" and doc.get("signal_state") == "LOSS_RED_TIMEOUT"

    if event == "TRACKING_STARTED":
        title = f"{direction} outlook tracking started"
        body = f"Signal {signal_time} · entry {entry} · Bid {doc.get('published_bid')} · Ask {doc.get('published_ask')}"
    elif event == "HALF_R_REACHED":
        title = f"{direction} outlook reached late +0.50R" if timed_out else f"{direction} outlook reached +0.50R"
        late_text = " after its 60-minute deadline" if timed_out else ""
        body = f"Signal {signal_time} reached +0.50R{late_text} at {event_at} · entry {entry} · hit {hit_price} · R {achieved_r}"
    elif event == "TIMEOUT_60M":
        title = f"{direction} outlook missed the 60-minute target"
        body = f"Signal {signal_time} failed to reach +0.50R within 60 minutes · entry {entry} · last {hit_price} · R {achieved_r}"
    elif event == "OUTLOOK_PUBLISHED":
        if direction in ("NO_VALID_OUTLOOK", "NEUTRAL", "RANGE", "TRANSITION"):
            title = "XAU AI Sniper — Hourly Outlook"
            body = f"No valid directional outlook this hour. Market state: {direction}. Confidence: {confidence}%"
        else:
            title = "XAU AI Sniper — Hourly Outlook"
            body = (f"{direction} outlook · {confidence}% confidence\n"
                   f"Entry: {doc.get('preferred_entry_zone_low')}–{doc.get('preferred_entry_zone_high')}\n"
                   f"SL: {doc.get('suggested_sl')} | TP1: {doc.get('tp1_price')} TP2: {doc.get('tp2_price')} TP3: {doc.get('tp3_price')}")
    elif event in ("TP1_HIT", "TP2_HIT", "TP3_HIT"):
        r_field = {"TP1_HIT": "tp1_r", "TP2_HIT": "tp2_r", "TP3_HIT": "tp3_r"}[event]
        title = "XAU Outlook Late Path Event" if timed_out else "XAU Outlook Result"
        late_text = " after its 60-minute deadline" if timed_out else ""
        body = (f"Signal {signal_time} hit {event.replace('_HIT', '')}{late_text} at {event_at} · "
                f"entry {entry} · hit {hit_price} · R {achieved_r if achieved_r is not None else doc.get(r_field)}")
    elif event == "SL_HIT":
        title = "XAU Outlook Late Path Event" if timed_out else "XAU Outlook Result"
        late_text = " after its 60-minute deadline" if timed_out else ""
        body = f"Signal {signal_time} hit SL{late_text} at {event_at} · entry {entry} · hit {hit_price} · R {achieved_r}"
    else:
        title = "XAU AI Sniper"
        body = event

    return {"title": title, "body": body, "deep_link": deep_link, "outlook_id": doc.get("id"), "event": event}


# v6.25.3 -- failure taxonomy for the OneSignal REST API. Only
# NO_DEVICE_REGISTERED reflects "OneSignal itself confirmed nothing is
# subscribed" (its own recipients=0 response) -- every other class is a
# configuration or transient-network condition, not proof the user opted
# out, so nothing here ever deletes a subscription record the way the old
# PERMANENT_SUBSCRIPTION_GONE class did (OneSignal manages device lifecycle
# itself; we no longer store per-device push endpoints at all).
SERVER_NOT_CONFIGURED = "SERVER_NOT_CONFIGURED"
NO_DEVICE_REGISTERED = "NO_DEVICE_REGISTERED"
AUTHENTICATION_FAILED = "AUTHENTICATION_FAILED"
INVALID_PAYLOAD = "INVALID_PAYLOAD"
TEMPORARY_DELIVERY_FAILURE = "TEMPORARY_DELIVERY_FAILURE"
UNKNOWN_FAILURE = "UNKNOWN_FAILURE"
RETRYABLE_FAILURES = {
    SERVER_NOT_CONFIGURED, AUTHENTICATION_FAILED, INVALID_PAYLOAD,
    TEMPORARY_DELIVERY_FAILURE, UNKNOWN_FAILURE,
}


async def _send_onesignal(user_id: str, payload: Dict) -> tuple:
    """Returns (ok: bool, failure_class: Optional[str]). The one production
    dispatcher every caller (hourly outlook events, TP/SL results, the Send
    Test Notification button) funnels through -- there is no second path.

    Sends by OneSignal external_id (== our own user_id). The client
    SDK tags every device the user grants permission on with
    OneSignal.login(user_id) (see frontend), so OneSignal itself fans this
    single call out to every device for this user -- unlike the old
    self-hosted Web Push code, this module never loops over per-device
    subscription records or stores raw push endpoints."""
    cfg = await _onesignal_config()
    if not (cfg["app_id"] and cfg["api_key"]):
        logger.info(f"NOTIFICATION_SKIPPED_NOT_CONFIGURED user={user_id} payload={payload.get('title')}")
        return False, SERVER_NOT_CONFIGURED

    import server as _srv
    deep_link = payload.get("deep_link") or "/ai-market-outlook"
    web_url = f"{_srv.PUBLIC_SITE_URL}{deep_link if str(deep_link).startswith('/') else '/' + str(deep_link)}"
    provider_idempotency = str(uuid.uuid5(
        uuid.NAMESPACE_URL,
        f"xau-outlook:{payload.get('outlook_id') or 'none'}:{payload.get('event') or 'unknown'}:{user_id}",
    ))
    body = {
        "app_id": cfg["app_id"],
        "include_aliases": {"external_id": [user_id]},
        "target_channel": "push",
        "headings": {"en": payload.get("title", "XAU AI Sniper")},
        "contents": {"en": payload.get("body", "")},
        "data": {"deep_link": payload.get("deep_link", ""), "outlook_id": payload.get("outlook_id"), "event": payload.get("event", "")},
        "web_url": web_url,
        "idempotency_key": provider_idempotency,
    }
    headers = {"Authorization": f"Key {cfg['api_key']}", "Content-Type": "application/json; charset=utf-8"}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(ONESIGNAL_API_URL, json=body, headers=headers)
    except httpx.TimeoutException:
        logger.warning(f"ONESIGNAL_TIMEOUT user={user_id}")
        return False, TEMPORARY_DELIVERY_FAILURE
    except httpx.HTTPError as e:
        logger.warning(f"ONESIGNAL_NETWORK_ERROR user={user_id}: {e}")
        return False, TEMPORARY_DELIVERY_FAILURE
    except Exception as e:
        logger.warning(f"ONESIGNAL_UNEXPECTED_ERROR user={user_id}: {e}")
        return False, UNKNOWN_FAILURE

    if resp.status_code in (401, 403):
        logger.warning(f"ONESIGNAL_AUTH_FAILED user={user_id} status={resp.status_code}: {resp.text[:200]}")
        return False, AUTHENTICATION_FAILED
    if resp.status_code >= 500:
        logger.warning(f"ONESIGNAL_SERVER_ERROR user={user_id} status={resp.status_code}")
        return False, TEMPORARY_DELIVERY_FAILURE
    if resp.status_code >= 400:
        logger.warning(f"ONESIGNAL_INVALID_REQUEST user={user_id} status={resp.status_code}: {resp.text[:200]}")
        return False, INVALID_PAYLOAD

    try:
        data = resp.json()
    except Exception:
        return False, UNKNOWN_FAILURE
    if data.get("id"):
        return True, None
    logger.info(f"ONESIGNAL_NO_RECIPIENTS user={user_id} response={data}")
    return False, NO_DEVICE_REGISTERED


async def send_outlook_notification(doc: Dict, event: str, min_tier: str) -> Optional[int]:
    """Sends (or logs-as-skipped) a notification for `event` to every user
    subscribed to this outlook's account, respecting per-user tier and
    idempotency. Returns the sent count when every eligible recipient has a
    terminal result, or None when recovery must retry. Never raises --
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
            if already and (already.get("delivery_status") == "SENT"
                            or already.get("failure_reason") not in RETRYABLE_FAILURES):
                continue
            payload = _build_payload(doc, event)
            subscription = await db.cloud_push_subscriptions.find_one({"user_id": user_id, "opted_in": True})
            log_entry = {
                "id": (already or {}).get("id") or str(uuid.uuid4()), "idempotency_key": idem_key, "user_id": user_id,
                "outlook_id": outlook_id, "notification_type": event,
                "scheduled_time": (already or {}).get("scheduled_time") or datetime.now(timezone.utc).isoformat(),
                "sent_time": None, "delivery_status": "PENDING", "opened_time": None,
                "device_count": 1 if subscription else 0, "retry_count": 0, "failure_reason": None,
            }
            if not subscription:
                log_entry["delivery_status"] = "NO_DEVICE"
                if already:
                    await db.cloud_notification_log.update_one({"idempotency_key": idem_key}, {"$set": log_entry})
                else:
                    await db.cloud_notification_log.insert_one(log_entry)
                continue
            ok, failure_class = await _send_onesignal(user_id, payload)
            log_entry["sent_time"] = datetime.now(timezone.utc).isoformat()
            log_entry["delivery_status"] = "SENT" if ok else "FAILED"
            if not ok:
                log_entry["failure_reason"] = failure_class or UNKNOWN_FAILURE
            if already:
                log_entry["retry_count"] = int(already.get("retry_count", 0) or 0) + 1
                await db.cloud_notification_log.update_one({"idempotency_key": idem_key}, {"$set": log_entry})
            else:
                await db.cloud_notification_log.insert_one(log_entry)
            if ok:
                sent += 1
        return sent
    except Exception as e:
        logger.error(f"NOTIFICATION_DISPATCH_FAILED event={event} outlook={doc.get('id')}: {e}")
        # None means the dispatch attempt itself did not complete far enough
        # to establish terminal per-recipient logs. The persisted event must
        # remain unflagged so restart recovery can retry it.
        return None


async def send_test_notification(user_id: str) -> Dict:
    """Real production dispatcher, not a second fake path. Uses the same
    _send_onesignal() every real event uses -- required flow per the owner:
    confirm OneSignal is configured, confirm this user has actually opted
    in, send, capture the real HTTP/provider outcome, log it, return a
    truthful status. Never returns SENT solely because no Python exception
    occurred -- SENT here means _send_onesignal's own (ok=True) branch,
    which only fires after OneSignal's response confirmed recipients > 0."""
    db = _db()
    status = await get_onesignal_status()
    if not status["configured"]:
        return {"status": "SERVER_NOT_CONFIGURED",
                "message": "OneSignal is not configured. Enter your App ID and REST API Key in Admin -> Settings."}

    subscription = await db.cloud_push_subscriptions.find_one({"user_id": user_id, "opted_in": True})
    if not subscription:
        return {"status": "NO_DEVICE", "message": "No registered device subscription for this user."}

    payload = {"title": "XAU AI Sniper Test", "body": "Phone alerts are working.",
               "deep_link": "/ai-market-outlook", "outlook_id": None, "event": "TEST_NOTIFICATION"}
    ok, failure_class = await _send_onesignal(user_id, payload)
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.cloud_notification_log.insert_one({
        "id": str(uuid.uuid4()), "idempotency_key": f"TEST:{user_id}:{now_iso}",
        "user_id": user_id, "outlook_id": None, "notification_type": "TEST_NOTIFICATION",
        "scheduled_time": now_iso, "sent_time": now_iso,
        "delivery_status": "SENT" if ok else "FAILED",
        "device_count": 1, "retry_count": 0,
        "failure_reason": None if ok else (failure_class or UNKNOWN_FAILURE),
    })
    if ok:
        return {"status": "SENT", "message": "Test notification sent."}
    if failure_class == NO_DEVICE_REGISTERED:
        return {"status": "NO_DEVICE", "message": "OneSignal reports no active device for this account -- re-enable notifications to resubscribe."}
    if failure_class == AUTHENTICATION_FAILED:
        return {"status": "FAILED", "message": "OneSignal rejected the REST API Key -- check Admin -> Settings."}
    return {"status": "FAILED", "message": f"Delivery failed ({failure_class or UNKNOWN_FAILURE})."}


async def get_notification_status(user_id: str, account: str = "") -> Dict:
    """Real, authenticated registration-status snapshot -- the frontend must
    render THIS, never infer ON from the saved preference tier alone. Only
    ON_VERIFIED once a real send has actually succeeded at least once;
    configured-and-registered-but-never-successfully-tested is
    READY_NOT_TESTED, a distinct, honest state."""
    db = _db()
    prefs = await db.cloud_notification_prefs.find_one({"user_id": user_id}, {"_id": 0})
    saved_tier = (prefs or {}).get("tier", "OFF")
    subscription = await db.cloud_push_subscriptions.find_one({"user_id": user_id, "opted_in": True}, {"_id": 0})
    last_log = await db.cloud_notification_log.find_one(
        {"user_id": user_id}, {"_id": 0}, sort=[("scheduled_time", -1)],
    )
    last_sent_ok = await db.cloud_notification_log.find_one(
        {"user_id": user_id, "delivery_status": "SENT"}, {"_id": 0}, sort=[("scheduled_time", -1)],
    )
    onesignal_status = await get_onesignal_status()
    server_ready = onesignal_status["configured"]

    if saved_tier == "OFF":
        final_status = "OFF"
    elif not server_ready:
        final_status = "SERVER_NOT_CONFIGURED"
    elif not subscription:
        final_status = "SUBSCRIPTION_MISSING"
    elif last_log and last_log.get("delivery_status") == "FAILED":
        final_status = "DELIVERY_FAILED"
    elif not last_sent_ok:
        final_status = "READY_NOT_TESTED"
    else:
        final_status = "ON_VERIFIED"

    return {
        "saved_tier": saved_tier,
        "active_device_count": 1 if subscription else 0,
        "most_recent_registration": (subscription or {}).get("created_at"),
        "push_server_configured": server_ready,
        "push_server_initialization_state": onesignal_status["initialization_state"],
        "latest_notification_status": (last_log or {}).get("delivery_status"),
        "latest_failure_reason": (last_log or {}).get("failure_reason"),
        "latest_sent_time": (last_log or {}).get("sent_time"),
        "latest_opened_time": (last_log or {}).get("opened_time"),
        "final_status": final_status,
    }
