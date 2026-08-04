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

STRICT SEPARATION: this module owns OneSignal device registrations and delivery
logs. It reads notification preferences and, for crash-safe notification retry
only, already-persisted broker-confirmed cloud_bot_activity events. It writes
only to cloud_push_subscriptions and cloud_notification_log. It never writes an
EA/trade collection and never calls any trading-control endpoint.
"""

from __future__ import annotations

import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, Optional

import httpx
from pymongo.errors import DuplicateKeyError

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
    "AUTOMATED_TRADE_RESULT": "HOURLY_PLUS_RESULTS",
}

# Notification Center category taxonomy. TRADES/MARKET_OUTLOOK/SIGNALS are
# the only categories any dispatch function currently emits (License, Bot
# Updates, Payments, System, and Support notifications go out over email
# today -- see server.py's email templates -- not push); the remaining
# categories exist so the feed/preferences UI has a stable, complete list
# to render even before those channels are wired into this log.
NOTIFICATION_CATEGORIES = [
    "TRADES", "MARKET_OUTLOOK", "SIGNALS", "LICENSE", "BOT_UPDATES",
    "PAYMENTS", "SYSTEM", "SUPPORT",
]
_EVENT_CATEGORY = {
    "OUTLOOK_PUBLISHED": "MARKET_OUTLOOK",
    "TRACKING_STARTED": "MARKET_OUTLOOK",
    "HALF_R_REACHED": "SIGNALS",
    "TIMEOUT_60M": "SIGNALS",
    "TP1_HIT": "SIGNALS",
    "TP2_HIT": "SIGNALS",
    "TP3_HIT": "SIGNALS",
    "SL_HIT": "SIGNALS",
    "TRADE_OPENED": "TRADES",
    "TRADE_CLOSED": "TRADES",
    "AUTOMATED_TRADE_RESULT": "TRADES",
}


def notification_category(event: str) -> str:
    return _EVENT_CATEGORY.get(event, "SYSTEM")


def _category_muted(prefs: Dict, category: str) -> bool:
    return category in (prefs.get("muted_categories") or [])


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
            body = f"No trade right now. Market regime: {doc.get('market_regime', direction)}. Evidence strength: {doc.get('evidence_strength_pct', 0)}%"
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
# Backward-compatible symbol; provider no-recipient is now reported with
# the precise production state name.
NO_DEVICE_REGISTERED = "NO_ACTIVE_ONESIGNAL_RECIPIENT"
NO_ACTIVE_ONESIGNAL_RECIPIENT = NO_DEVICE_REGISTERED
AUTHENTICATION_FAILED = "AUTHENTICATION_FAILED"
INVALID_PAYLOAD = "INVALID_PAYLOAD"
TEMPORARY_DELIVERY_FAILURE = "TEMPORARY_DELIVERY_FAILURE"
UNKNOWN_FAILURE = "UNKNOWN_FAILURE"
RETRYABLE_FAILURES = {
    SERVER_NOT_CONFIGURED, AUTHENTICATION_FAILED, INVALID_PAYLOAD,
    TEMPORARY_DELIVERY_FAILURE, UNKNOWN_FAILURE,
}


# ---------------------------------------------------------------------------
# Genuine per-device OneSignal registration
# ---------------------------------------------------------------------------
REGISTRATION_VERSION = "onesignal-web-v16-device-v1"
NO_ACTIVE_ONESIGNAL_RECIPIENT = "NO_ACTIVE_ONESIGNAL_RECIPIENT"


def _clean_text(value, limit=240):
    return str(value or "").strip()[:limit]


def _device_is_complete(doc: Optional[Dict]) -> bool:
    doc = doc or {}
    return bool(
        doc.get("active", True)
        and doc.get("opted_in") is True
        and doc.get("token_present") is True
        and _clean_text(doc.get("permission_state"), 24) == "granted"
        and _clean_text(doc.get("onesignal_subscription_id"))
        and _clean_text(doc.get("onesignal_id"))
        and _clean_text(doc.get("external_id"))
    )


def _masked_id(value: str) -> str:
    text = _clean_text(value)
    if not text:
        return ""
    if len(text) <= 10:
        return f"{text[:3]}…{text[-2:]}"
    return f"{text[:6]}…{text[-4:]}"


async def _ensure_device_index() -> None:
    """Best-effort uniqueness for real subscription IDs only.

    Old v6.25.3 rows have no subscription ID. The partial index deliberately
    ignores those legacy rows so deployment does not fail while status reports
    them as REGISTRATION_INCOMPLETE.
    """
    db = _db()
    try:
        await db.cloud_push_subscriptions.create_index(
            [("user_id", 1), ("onesignal_subscription_id", 1)],
            unique=True,
            name="uniq_user_onesignal_subscription",
            partialFilterExpression={"onesignal_subscription_id": {"$type": "string"}},
        )
    except Exception as exc:
        logger.warning("ONESIGNAL_DEVICE_INDEX_WARNING: %s", exc)


def validate_device_registration(payload: Dict, authenticated_user_id: str) -> tuple:
    subscription_id = _clean_text(payload.get("onesignal_subscription_id"))
    onesignal_id = _clean_text(payload.get("onesignal_id"))
    external_id = _clean_text(payload.get("external_id"))
    permission = _clean_text(payload.get("permission_state"), 24)
    opted_in = payload.get("opted_in") is True
    token_present = payload.get("token_present") is True

    if external_id != str(authenticated_user_id):
        return False, "EXTERNAL_ID_MISMATCH", "OneSignal External ID does not match the authenticated user."
    if not subscription_id:
        return False, "SUBSCRIPTION_ID_MISSING", "OneSignal did not provide a device Subscription ID."
    if not onesignal_id:
        return False, "ONESIGNAL_ID_MISSING", "OneSignal did not provide a user ID."
    if permission != "granted":
        return False, "PERMISSION_NOT_GRANTED", "Browser notification permission is not granted."
    if not opted_in:
        return False, "SUBSCRIPTION_NOT_OPTED_IN", "OneSignal reports that this device is not opted in."
    if not token_present:
        return False, "PUSH_TOKEN_MISSING", "OneSignal has not created a push token for this device."
    return True, "DEVICE_VALID", "Device registration is complete."


async def upsert_device_registration(authenticated_user_id: str, payload: Dict, user_agent: str = "") -> Dict:
    valid, code, message = validate_device_registration(payload, authenticated_user_id)
    if not valid:
        return {"ok": False, "code": code, "message": message}

    await _ensure_device_index()
    db = _db()
    now_iso = datetime.now(timezone.utc).isoformat()
    subscription_id = _clean_text(payload.get("onesignal_subscription_id"))
    device_instance_id = _clean_text(payload.get("device_instance_id"))

    # A browser may receive a new OneSignal Subscription ID after clearing site
    # data or provider re-registration. The stable local device instance lets us
    # deactivate the old backend row without overwriting other phones/browsers.
    if device_instance_id:
        await db.cloud_push_subscriptions.update_many(
            {
                "user_id": authenticated_user_id,
                "device_instance_id": device_instance_id,
                "onesignal_subscription_id": {"$ne": subscription_id},
                "active": True,
            },
            {"$set": {"active": False, "opted_in": False, "updated_at": now_iso, "deactivated_reason": "SUBSCRIPTION_REPLACED"}},
        )

    query = {"user_id": authenticated_user_id, "onesignal_subscription_id": subscription_id}
    existing = await db.cloud_push_subscriptions.find_one(query)
    record = {
        "user_id": authenticated_user_id,
        "onesignal_subscription_id": subscription_id,
        "onesignal_id": _clean_text(payload.get("onesignal_id")),
        "external_id": authenticated_user_id,
        "device_instance_id": device_instance_id,
        "opted_in": True,
        "token_present": True,
        "permission_state": "granted",
        "active": True,
        "device_label": _clean_text(payload.get("device_label"), 160),
        "user_agent": _clean_text(user_agent or payload.get("user_agent"), 300),
        "platform": _clean_text(payload.get("platform"), 80),
        "browser": _clean_text(payload.get("browser"), 80),
        "timezone_offset_minutes": int(payload.get("timezone_offset_minutes") or 0),
        "service_worker_scope": _clean_text(payload.get("service_worker_scope"), 160),
        "registration_version": _clean_text(payload.get("registration_version"), 80) or REGISTRATION_VERSION,
        "registration_state": "COMPLETE",
        "updated_at": now_iso,
        "last_seen_at": now_iso,
    }
    if existing:
        device_id = existing.get("id") or str(uuid.uuid4())
        record["id"] = device_id
        await db.cloud_push_subscriptions.update_one(query, {"$set": record})
        created = False
    else:
        device_id = str(uuid.uuid4())
        record.update({"id": device_id, "created_at": now_iso, "last_test_status": None, "last_test_at": None})
        await db.cloud_push_subscriptions.insert_one(record)
        created = True

    return {
        "ok": True,
        "code": "DEVICE_REGISTERED",
        "message": "OneSignal device registration stored.",
        "device_id": device_id,
        "created": created,
        "active_device_count": await count_complete_active_devices(authenticated_user_id),
    }


async def deactivate_device_registration(authenticated_user_id: str, payload: Dict) -> Dict:
    db = _db()
    now_iso = datetime.now(timezone.utc).isoformat()
    clauses = []
    subscription_id = _clean_text(payload.get("onesignal_subscription_id"))
    device_instance_id = _clean_text(payload.get("device_instance_id"))
    if subscription_id:
        clauses.append({"onesignal_subscription_id": subscription_id})
    if device_instance_id:
        clauses.append({"device_instance_id": device_instance_id})
    query = {"user_id": authenticated_user_id}
    if clauses:
        query["$or"] = clauses
    result = await db.cloud_push_subscriptions.update_many(
        query,
        {"$set": {"active": False, "opted_in": False, "updated_at": now_iso, "deactivated_reason": "USER_LOGOUT"}},
    )
    return {"ok": True, "deactivated": result.modified_count}


async def complete_active_devices(user_id: str) -> list:
    rows = await _db().cloud_push_subscriptions.find(
        {"user_id": user_id, "active": True, "opted_in": True}, {"_id": 0},
    ).sort("last_seen_at", -1).to_list(100)
    return [row for row in rows if _device_is_complete(row)]


async def count_complete_active_devices(user_id: str) -> int:
    return len(await complete_active_devices(user_id))


async def _send_onesignal(user_id: str, payload: Dict) -> tuple:
    """Single production OneSignal dispatcher.

    Returns (ok, failure_class, provider_result). A HTTP 200 response is not
    success unless OneSignal returns a non-empty notification message id.
    """
    cfg = await _onesignal_config()
    if not (cfg["app_id"] and cfg["api_key"]):
        logger.info("NOTIFICATION_SKIPPED_NOT_CONFIGURED user=%s", user_id)
        return False, SERVER_NOT_CONFIGURED, {"http_status": None, "message_id": None}

    import server as _srv
    deep_link = payload.get("deep_link") or "/ai-market-outlook"
    web_url = f"{_srv.PUBLIC_SITE_URL}{deep_link if str(deep_link).startswith('/') else '/' + str(deep_link)}"
    provider_identity = payload.get("notification_key") or (
        f"xau-outlook:{payload.get('outlook_id') or 'none'}:{payload.get('event') or 'unknown'}:{user_id}"
    )
    provider_idempotency = str(uuid.uuid5(uuid.NAMESPACE_URL, str(provider_identity)))
    body = {
        "app_id": cfg["app_id"],
        "include_aliases": {"external_id": [user_id]},
        "target_channel": "push",
        "headings": {"en": payload.get("title", "XAU AI Sniper")},
        "contents": {"en": payload.get("body", "")},
        "data": {
            "deep_link": payload.get("deep_link", ""),
            "outlook_id": payload.get("outlook_id"),
            "event": payload.get("event", ""),
        },
        "web_url": web_url,
        "idempotency_key": provider_idempotency,
    }
    headers = {"Authorization": f"Key {cfg['api_key']}", "Content-Type": "application/json; charset=utf-8"}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(ONESIGNAL_API_URL, json=body, headers=headers)
    except httpx.TimeoutException:
        logger.warning("ONESIGNAL_TIMEOUT user=%s", user_id)
        return False, TEMPORARY_DELIVERY_FAILURE, {"http_status": None, "message_id": None, "error": "timeout"}
    except httpx.HTTPError as exc:
        logger.warning("ONESIGNAL_NETWORK_ERROR user=%s: %s", user_id, exc)
        return False, TEMPORARY_DELIVERY_FAILURE, {"http_status": None, "message_id": None, "error": "network"}
    except Exception as exc:
        logger.warning("ONESIGNAL_UNEXPECTED_ERROR user=%s: %s", user_id, exc)
        return False, UNKNOWN_FAILURE, {"http_status": None, "message_id": None, "error": "unexpected"}

    provider = {"http_status": resp.status_code, "message_id": None, "errors": None, "warnings": None}
    try:
        data = resp.json()
    except Exception:
        data = {}
    provider["message_id"] = _clean_text(data.get("id")) or None
    provider["errors"] = data.get("errors")
    provider["warnings"] = data.get("warnings")

    if resp.status_code in (401, 403):
        logger.warning("ONESIGNAL_AUTH_FAILED user=%s status=%s", user_id, resp.status_code)
        return False, AUTHENTICATION_FAILED, provider
    if resp.status_code >= 500:
        logger.warning("ONESIGNAL_SERVER_ERROR user=%s status=%s", user_id, resp.status_code)
        return False, TEMPORARY_DELIVERY_FAILURE, provider
    if resp.status_code >= 400:
        logger.warning("ONESIGNAL_INVALID_REQUEST user=%s status=%s", user_id, resp.status_code)
        return False, INVALID_PAYLOAD, provider
    if provider["message_id"]:
        return True, None, provider

    logger.info("ONESIGNAL_NO_ACTIVE_RECIPIENT user=%s errors=%s warnings=%s", user_id, provider["errors"], provider["warnings"])
    return False, NO_ACTIVE_ONESIGNAL_RECIPIENT, provider


def _coerce_send_result(result: tuple) -> tuple:
    """Temporary compatibility for older tests/mocks that return two values."""
    if len(result) == 3:
        return result
    ok, failure_class = result
    return ok, failure_class, {"http_status": None, "message_id": None, "errors": None, "warnings": None}


HEARTBEAT_STALE_SECONDS = 90  # same convention as server.py cloud_monitor_status's own "EA heartbeat" tile


async def _market_open_and_bot_connected(account: str, now: Optional[datetime] = None) -> tuple:
    """v6.25.29 owner directive 2026-07-24: an Outlook push must only ever
    fire while (a) the gold market is genuinely open and (b) this account's
    own EA has a fresh heartbeat -- the owner's exact complaint was
    notifications firing while the bot was offline during a market-closed
    weekend. Returns (allowed, reason) so the caller can log exactly why a
    send was suppressed rather than silently doing nothing.

    Market-open check: XAUUSD/forex is closed roughly Friday 21:00 UTC ->
    Sunday 21:00 UTC. Broker-exact open/close can vary by up to an hour
    depending on server timezone/DST; that tolerance is acceptable here
    because this only ever suppresses a notification, never a trading
    decision (the EA's own broker-side session/weekend gating is untouched
    and independent of this check).

    Bot-connected check reuses the exact same 90-second heartbeat-staleness
    convention already used for the Command Center's own "EA heartbeat"
    status tile (server.py cloud_monitor_status), queried against the same
    cloud_bot_heartbeats collection, so "bot online" means the same thing
    here as it does on the dashboard the owner is looking at.
    """
    now = now or datetime.now(timezone.utc)
    weekday = now.weekday()  # Monday=0 ... Sunday=6
    market_closed = (
        weekday == 5
        or (weekday == 4 and now.hour >= 21)
        or (weekday == 6 and now.hour < 21)
    )
    if market_closed:
        return False, "MARKET_CLOSED_WEEKEND"

    if not account:
        return False, "NO_ACCOUNT_CONTEXT"

    import server as _srv
    db = _db()
    hb = await db.cloud_bot_heartbeats.find_one(
        {"account_number": account}, {"_id": 0, "ts": 1}, sort=[("ts", -1)],
    )
    hb_time = _srv._dt_or_none((hb or {}).get("ts"))
    if hb_time and hb_time.tzinfo is None:
        hb_time = hb_time.replace(tzinfo=timezone.utc)
    age_sec = (now - hb_time).total_seconds() if hb_time else None
    if age_sec is None or age_sec > HEARTBEAT_STALE_SECONDS:
        return False, "BOT_OFFLINE_NO_HEARTBEAT"
    return True, ""


async def send_outlook_notification(doc: Dict, event: str, min_tier: str) -> Optional[int]:
    """Send an Outlook event without allowing push failure to affect trading or Outlook generation."""
    try:
        db = _db()
        account = doc.get("account", "")
        outlook_id = doc.get("id", "")

        allowed, suppress_reason = await _market_open_and_bot_connected(account)
        if not allowed:
            logger.info("OUTLOOK_NOTIFICATION_SUPPRESSED id=%s event=%s reason=%s account=%s",
                        outlook_id, event, suppress_reason, account)
            return None
        prefs_cursor = db.cloud_notification_prefs.find({"account": account})
        sent = 0
        async for prefs in prefs_cursor:
            user_id = prefs.get("user_id", "")
            tier = prefs.get("tier", "OFF")
            required_tier = _EVENT_MIN_TIER.get(event, min_tier)
            if _TIER_RANK.get(tier, 0) < _TIER_RANK.get(required_tier, 99):
                continue
            if _category_muted(prefs, notification_category(event)):
                continue
            idem_key = _idempotency_key(outlook_id, event, user_id)
            already = await db.cloud_notification_log.find_one({"idempotency_key": idem_key})
            if already and (already.get("delivery_status") == "SENT"
                            or already.get("failure_reason") not in RETRYABLE_FAILURES):
                continue

            payload = _build_payload(doc, event)
            devices = await complete_active_devices(user_id)
            log_entry = {
                "id": (already or {}).get("id") or str(uuid.uuid4()),
                "idempotency_key": idem_key,
                "user_id": user_id,
                "outlook_id": outlook_id,
                "notification_type": event,
                "category": notification_category(event),
                "title": payload.get("title"),
                "body": payload.get("body"),
                "scheduled_time": (already or {}).get("scheduled_time") or datetime.now(timezone.utc).isoformat(),
                "sent_time": None,
                "delivery_status": "PENDING",
                "opened_time": None,
                "read_at": (already or {}).get("read_at"),
                "device_count": len(devices),
                "retry_count": int((already or {}).get("retry_count", 0) or 0),
                "failure_reason": None,
            }
            if not devices:
                log_entry.update({"delivery_status": "NO_DEVICE", "failure_reason": "SUBSCRIPTION_MISSING"})
            else:
                ok, failure_class, provider = _coerce_send_result(await _send_onesignal(user_id, payload))
                log_entry.update({
                    "sent_time": datetime.now(timezone.utc).isoformat(),
                    "delivery_status": "SENT" if ok else "FAILED",
                    "failure_reason": None if ok else (failure_class or UNKNOWN_FAILURE),
                    "provider_http_status": provider.get("http_status"),
                    "provider_message_id": provider.get("message_id"),
                    "provider_errors": provider.get("errors"),
                    "provider_warnings": provider.get("warnings"),
                })
                if ok:
                    sent += 1
            if already:
                log_entry["retry_count"] = int(already.get("retry_count", 0) or 0) + 1
                await db.cloud_notification_log.update_one({"idempotency_key": idem_key}, {"$set": log_entry})
            else:
                await db.cloud_notification_log.insert_one(log_entry)
        return sent
    except Exception as exc:
        logger.error("NOTIFICATION_DISPATCH_FAILED event=%s outlook=%s: %s", event, doc.get("id"), exc)
        return None


def _build_automated_trade_payload(doc: Dict) -> Dict:
    """Builds the push payload for a real, broker-confirmed automated trade
    result (doc["automated_trade_result"], written by
    market_outlook.reconcile_automated_trade_result). Deliberately separate
    from _build_payload's advisory TP/SL events -- this describes a trade
    that XauCloud actually executed, not the advisory "if you had taken
    this setup" tracking."""
    result = doc.get("automated_trade_result") or {}
    outcome = result.get("result", "")
    direction = result.get("direction") or doc.get("primary_direction", "")
    symbol = result.get("symbol") or doc.get("symbol", "XAUUSD")
    profit_raw = result.get("realized_profit")
    r_multiple = _fmt_number(result.get("realized_r"))
    entry = result.get("entry_price")
    exit_price = result.get("exit_price")
    close_reason = result.get("close_reason") or ""
    deep_link = f"/ai-market-outlook?outlook_id={doc.get('id')}"

    icon = {"TP_HIT": "✅", "WIN": "✅", "SL_HIT": "❌", "LOSS": "❌", "BREAK_EVEN": "➖"}.get(outcome, "📊")
    label = {
        "TP_HIT": "hit take-profit", "SL_HIT": "hit stop-loss", "WIN": "closed in profit",
        "LOSS": "closed at a loss", "BREAK_EVEN": "closed break-even",
    }.get(outcome, "closed")
    title = f"{icon} {direction} {symbol} automated trade {label}"

    parts = []
    try:
        numeric_profit = float(profit_raw)
        signed_amount = f"+${numeric_profit:,.2f}" if numeric_profit >= 0 else f"-${abs(numeric_profit):,.2f}"
        parts.append(f"P/L {signed_amount}")
    except (TypeError, ValueError):
        pass
    if r_multiple: parts.append(f"{r_multiple}R")
    if entry is not None: parts.append(f"Entry {entry}")
    if exit_price is not None: parts.append(f"Exit {exit_price}")
    if close_reason: parts.append(close_reason)
    if result.get("ticket"): parts.append(f"Ticket {result.get('ticket')}")
    body = " · ".join(parts) or "Your automated trade result has been confirmed by your broker."

    return {
        "title": title, "body": body, "deep_link": deep_link,
        "outlook_id": doc.get("id"), "event": "AUTOMATED_TRADE_RESULT",
    }


async def send_automated_trade_result_notification(doc: Dict) -> Optional[int]:
    """Sends the real, broker-confirmed automated-trade-result push.

    Unlike send_outlook_notification, this never applies the
    market-open/bot-heartbeat suppression gate -- that gate exists only to
    hide notifications about the *advisory* tracking process while the bot
    is offline/market is closed (owner directive 2026-07-24). This event
    reports something that has already genuinely happened (the trade is
    closed), so it is always eligible to send, subject only to the
    recipient's own notification tier preference."""
    try:
        db = _db()
        account = doc.get("account", "")
        outlook_id = doc.get("id", "")
        event = "AUTOMATED_TRADE_RESULT"
        prefs_cursor = db.cloud_notification_prefs.find({"account": account})
        sent = 0
        async for prefs in prefs_cursor:
            user_id = prefs.get("user_id", "")
            tier = prefs.get("tier", "OFF")
            required_tier = _EVENT_MIN_TIER.get(event, "HOURLY_PLUS_RESULTS")
            if _TIER_RANK.get(tier, 0) < _TIER_RANK.get(required_tier, 99):
                continue
            if _category_muted(prefs, notification_category(event)):
                continue
            idem_key = _idempotency_key(outlook_id, event, user_id)
            already = await db.cloud_notification_log.find_one({"idempotency_key": idem_key})
            if already and (already.get("delivery_status") == "SENT"
                            or already.get("failure_reason") not in RETRYABLE_FAILURES):
                continue

            payload = _build_automated_trade_payload(doc)
            devices = await complete_active_devices(user_id)
            log_entry = {
                "id": (already or {}).get("id") or str(uuid.uuid4()),
                "idempotency_key": idem_key,
                "user_id": user_id,
                "outlook_id": outlook_id,
                "notification_type": event,
                "category": notification_category(event),
                "title": payload.get("title"),
                "body": payload.get("body"),
                "scheduled_time": (already or {}).get("scheduled_time") or datetime.now(timezone.utc).isoformat(),
                "sent_time": None,
                "delivery_status": "PENDING",
                "opened_time": None,
                "read_at": (already or {}).get("read_at"),
                "device_count": len(devices),
                "retry_count": int((already or {}).get("retry_count", 0) or 0),
                "failure_reason": None,
            }
            if not devices:
                log_entry.update({"delivery_status": "NO_DEVICE", "failure_reason": "SUBSCRIPTION_MISSING"})
            else:
                ok, failure_class, provider = _coerce_send_result(await _send_onesignal(user_id, payload))
                log_entry.update({
                    "sent_time": datetime.now(timezone.utc).isoformat(),
                    "delivery_status": "SENT" if ok else "FAILED",
                    "failure_reason": None if ok else (failure_class or UNKNOWN_FAILURE),
                    "provider_http_status": provider.get("http_status"),
                    "provider_message_id": provider.get("message_id"),
                    "provider_errors": provider.get("errors"),
                    "provider_warnings": provider.get("warnings"),
                })
                if ok:
                    sent += 1
            if already:
                log_entry["retry_count"] = int(already.get("retry_count", 0) or 0) + 1
                await db.cloud_notification_log.update_one({"idempotency_key": idem_key}, {"$set": log_entry})
            else:
                await db.cloud_notification_log.insert_one(log_entry)
        return sent
    except Exception as exc:
        logger.error("AUTOMATED_TRADE_NOTIFICATION_DISPATCH_FAILED outlook=%s: %s", doc.get("id"), exc)
        return None


BROKER_SUCCESS_RETCODES = {10008, 10009, 10010}


def _activity_value(activity: Dict, *names, default=None):
    details = activity.get("details") or {}
    for name in names:
        value = activity.get(name)
        if value is None or value == "":
            value = details.get(name)
        if value is not None and value != "":
            return value
    return default


def classify_trade_activity(activity: Dict) -> Optional[str]:
    """Return TRADE_OPENED/TRADE_CLOSED only for broker-confirmed events."""
    event_type = str(activity.get("event_type") or "").upper()
    category = str(activity.get("event_category") or "").lower()
    ticket = _clean_text(_activity_value(activity, "ticket", "position_id", "position_ticket"), 80)
    if not ticket:
        return None

    retcode = _activity_value(activity, "broker_retcode")
    if retcode not in (None, ""):
        try:
            if int(retcode) not in BROKER_SUCCESS_RETCODES:
                return None
        except (TypeError, ValueError):
            return None

    final_decision = str(_activity_value(activity, "final_decision", default="") or "").upper()
    open_confirmed = (
        final_decision in {"EXECUTED", "FILLED", "BROKER_CONFIRMED"}
        or any(token in event_type for token in ("TRADE_EXECUTED", "POSITION_OPENED", "TRADE_OPENED", "EXECUTION_CONFIRMED"))
    )
    if open_confirmed:
        return "TRADE_OPENED"

    profit = _activity_value(activity, "profit", "net_profit", "realized_profit")
    close_confirmed = (
        any(token in event_type for token in ("TRADE_CLOSED", "POSITION_CLOSED", "CLOSE_CONFIRMED", "DEAL_CLOSED"))
        or (category == "exits" and bool(_activity_value(activity, "close_reason_exact", "close_reason")))
    )
    if close_confirmed:
        try:
            float(profit)
        except (TypeError, ValueError):
            return None
        return "TRADE_CLOSED"
    return None


def _fmt_number(value, digits=2) -> Optional[str]:
    try:
        return f"{float(value):,.{digits}f}"
    except (TypeError, ValueError):
        return None


def build_trade_notification_payload(activity: Dict, event: str) -> Dict:
    symbol = _clean_text(activity.get("symbol") or _activity_value(activity, "symbol") or "XAUUSD", 32)
    direction = _clean_text(_activity_value(activity, "position_direction", "direction", "signal_direction"), 12).upper()
    ticket = _clean_text(_activity_value(activity, "ticket", "position_id", "position_ticket"), 80)
    price = _fmt_number(_activity_value(activity, "price", "entry_price", "open_price"))
    close_price = _fmt_number(_activity_value(activity, "close_price", "price"))
    lots = _fmt_number(_activity_value(activity, "lots", "volume", "lot_size"))
    sl = _fmt_number(_activity_value(activity, "sl", "stop_loss"))
    tp = _fmt_number(_activity_value(activity, "tp", "take_profit"))
    setup = _clean_text(_activity_value(activity, "setup", "setup_type", "family"), 80)
    campaign = _clean_text(_activity_value(activity, "campaign_id", "campaign"), 80)
    reason = _clean_text(_activity_value(activity, "close_reason_exact", "close_reason", "reason"), 140)
    final_r = _fmt_number(_activity_value(activity, "final_r", "r_multiple"))
    duration = _clean_text(_activity_value(activity, "duration", "duration_text", "trade_duration"), 60)
    balance = _fmt_number(_activity_value(activity, "balance", "account_balance"))
    profit_raw = _activity_value(activity, "profit", "net_profit", "realized_profit")
    profit = _fmt_number(profit_raw)

    if event == "TRADE_OPENED":
        side = direction or "TRADE"
        title = f"{'🟢' if side == 'BUY' else '🔴' if side == 'SELL' else '📈'} {side} {symbol} opened"
        parts = []
        if price: parts.append(f"Entry {price}")
        if lots: parts.append(f"Lots {lots}")
        if sl: parts.append(f"SL {sl}")
        if tp: parts.append(f"TP {tp}")
        if setup: parts.append(setup)
        if campaign: parts.append(f"Campaign {campaign}")
        parts.append(f"Ticket {ticket}")
    else:
        numeric_profit = float(profit_raw)
        icon = "✅" if numeric_profit > 0 else "❌" if numeric_profit < 0 else "➖"
        outcome = "profit" if numeric_profit > 0 else "loss" if numeric_profit < 0 else "break-even"
        title = f"{icon} {symbol} trade closed — {outcome}"
        signed_amount = f"+${profit}" if numeric_profit > 0 else f"-${abs(numeric_profit):,.2f}" if numeric_profit < 0 else "$0.00"
        parts = [f"P/L {signed_amount}"]
        if direction: parts.append(direction)
        if close_price: parts.append(f"Close {close_price}")
        if final_r: parts.append(f"{final_r}R")
        if duration: parts.append(duration)
        if reason: parts.append(reason)
        if balance: parts.append(f"Balance ${balance}")
        parts.append(f"Ticket {ticket}")

    activity_id = _clean_text(activity.get("id"), 120)
    notification_key = f"{event}:{activity.get('account','')}:{symbol}:{ticket}"
    return {
        "title": title,
        "body": " · ".join(parts),
        "deep_link": f"/activity?ticket={ticket}",
        "outlook_id": None,
        "activity_id": activity_id,
        "ticket": ticket,
        "event": event,
        "notification_key": notification_key,
    }


async def send_trade_activity_notification(activity: Dict) -> Optional[int]:
    """Send confirmed trade lifecycle alerts without affecting the EA endpoint."""
    try:
        event = classify_trade_activity(activity)
        if not event:
            return 0
        db = _db()
        account = str(activity.get("account") or "")
        symbol = str(activity.get("symbol") or _activity_value(activity, "symbol") or "XAUUSD")
        ticket = str(_activity_value(activity, "ticket", "position_id", "position_ticket") or "")
        prefs_cursor = db.cloud_notification_prefs.find({"account": account})
        sent = 0
        async for prefs in prefs_cursor:
            user_id = str(prefs.get("user_id") or "")
            if not user_id or _TIER_RANK.get(prefs.get("tier", "OFF"), 0) < _TIER_RANK["ALL_UPDATES"]:
                continue
            if _category_muted(prefs, notification_category(event)):
                continue

            idem_key = f"{event}:{account}:{symbol}:{ticket}:{user_id}"
            already = await db.cloud_notification_log.find_one({"idempotency_key": idem_key})
            if already:
                status = str(already.get("delivery_status") or "")
                failure = already.get("failure_reason")
                if status == "SENT" or status == "NO_DEVICE":
                    continue
                if status == "FAILED" and failure not in RETRYABLE_FAILURES:
                    continue
                if status == "PENDING":
                    try:
                        scheduled = datetime.fromisoformat(str(already.get("scheduled_time") or "").replace("Z", "+00:00"))
                        if datetime.now(timezone.utc) - scheduled < timedelta(minutes=2):
                            continue  # another worker still owns the live claim
                    except (TypeError, ValueError):
                        continue

            devices = await complete_active_devices(user_id)
            now_iso = datetime.now(timezone.utc).isoformat()
            payload = build_trade_notification_payload(activity, event)
            log_entry = {
                "id": (already or {}).get("id") or str(uuid.uuid4()),
                "idempotency_key": idem_key,
                "user_id": user_id,
                "outlook_id": None,
                "activity_id": activity.get("id"),
                "account": account,
                "symbol": symbol,
                "ticket": ticket,
                "notification_type": event,
                "category": notification_category(event),
                "title": payload.get("title"),
                "body": payload.get("body"),
                "scheduled_time": (already or {}).get("scheduled_time") or now_iso,
                "sent_time": None,
                "delivery_status": "PENDING",
                "opened_time": None,
                "read_at": (already or {}).get("read_at"),
                "device_count": len(devices),
                "retry_count": int((already or {}).get("retry_count", 0) or 0),
                "failure_reason": None,
            }

            if not already:
                try:
                    await db.cloud_notification_log.insert_one(dict(log_entry))
                except DuplicateKeyError:
                    continue  # another worker owns this exact trade event

            if not devices:
                log_entry.update({"delivery_status": "NO_DEVICE", "failure_reason": "SUBSCRIPTION_MISSING"})
            else:
                payload["notification_key"] = f"{idem_key}:provider"
                ok, failure_class, provider = _coerce_send_result(await _send_onesignal(user_id, payload))
                log_entry.update({
                    "sent_time": datetime.now(timezone.utc).isoformat(),
                    "delivery_status": "SENT" if ok else "FAILED",
                    "failure_reason": None if ok else (failure_class or UNKNOWN_FAILURE),
                    "provider_http_status": provider.get("http_status"),
                    "provider_message_id": provider.get("message_id"),
                    "provider_errors": provider.get("errors"),
                    "provider_warnings": provider.get("warnings"),
                })
                if ok:
                    sent += 1
            if already:
                log_entry["retry_count"] = int(already.get("retry_count", 0) or 0) + 1
            await db.cloud_notification_log.update_one({"idempotency_key": idem_key}, {"$set": log_entry})
        return sent
    except Exception as exc:
        logger.error("TRADE_NOTIFICATION_DISPATCH_FAILED activity=%s: %s", activity.get("id"), exc)
        return None


async def dispatch_pending_trade_notifications(limit: int = 100) -> int:
    """Retry persisted transient trade alerts after a worker restart/crash."""
    db = _db()
    rows = await db.cloud_notification_log.find({
        "notification_type": {"$in": ["TRADE_OPENED", "TRADE_CLOSED"]},
        "$or": [
            {"delivery_status": "PENDING"},
            {"delivery_status": "FAILED", "failure_reason": {"$in": list(RETRYABLE_FAILURES)}},
        ],
        "activity_id": {"$ne": None},
    }, {"_id": 0, "activity_id": 1}).sort("scheduled_time", 1).to_list(limit)
    dispatched = 0
    seen = set()
    for row in rows:
        activity_id = str(row.get("activity_id") or "")
        if not activity_id or activity_id in seen:
            continue
        seen.add(activity_id)
        activity = await db.cloud_bot_activity.find_one({"id": activity_id}, {"_id": 0})
        if activity:
            result = await send_trade_activity_notification(activity)
            if result:
                dispatched += int(result)
    return dispatched


# ---------------------------------------------------------------------------
# Notification Center -- grouped/paginated in-app feed over the same
# cloud_notification_log every dispatch function above already writes to.
# Read/unread and per-category mute preferences are real, backend-persisted
# state (cloud_notification_log.read_at, cloud_notification_prefs.
# muted_categories), not client-local UI state.
# ---------------------------------------------------------------------------

async def get_notification_center_page(
    user_id: str, category: Optional[str] = None, unread_only: bool = False,
    page: int = 1, limit: int = 20,
) -> Dict:
    db = _db()
    query: Dict = {"user_id": user_id, "delivery_status": {"$in": ["SENT", "NO_DEVICE", "PENDING", "FAILED"]}}
    if category and category != "ALL":
        query["category"] = category
    if unread_only:
        query["read_at"] = None
    page = max(1, int(page))
    limit = max(1, min(int(limit), 100))
    total = await db.cloud_notification_log.count_documents(query)
    unread_total = await db.cloud_notification_log.count_documents({**query, "read_at": None})
    rows = await db.cloud_notification_log.find(query, {"_id": 0}).sort("scheduled_time", -1).skip((page - 1) * limit).limit(limit).to_list(limit)
    category_counts = {}
    for cat in NOTIFICATION_CATEGORIES:
        cat_query = {"user_id": user_id, "category": cat}
        category_counts[cat] = {
            "total": await db.cloud_notification_log.count_documents(cat_query),
            "unread": await db.cloud_notification_log.count_documents({**cat_query, "read_at": None}),
        }
    return {
        "items": rows, "page": page, "limit": limit, "total": total,
        "unread_total": unread_total, "has_more": page * limit < total,
        "category_counts": category_counts,
    }


async def mark_notification_read(user_id: str, notification_id: str) -> bool:
    db = _db()
    result = await db.cloud_notification_log.update_one(
        {"id": notification_id, "user_id": user_id, "read_at": None},
        {"$set": {"read_at": datetime.now(timezone.utc).isoformat()}},
    )
    return result.modified_count > 0


async def mark_all_notifications_read(user_id: str, category: Optional[str] = None) -> int:
    db = _db()
    query: Dict = {"user_id": user_id, "read_at": None}
    if category and category != "ALL":
        query["category"] = category
    result = await db.cloud_notification_log.update_many(
        query, {"$set": {"read_at": datetime.now(timezone.utc).isoformat()}},
    )
    return result.modified_count


async def send_test_notification(user_id: str) -> Dict:
    db = _db()
    status = await get_onesignal_status()
    if not status["configured"]:
        return {"status": "SERVER_NOT_CONFIGURED", "message": "OneSignal is not configured. Enter the App ID and REST API Key in Admin settings."}

    devices = await complete_active_devices(user_id)
    if not devices:
        return {"status": "NO_DEVICE", "message": "No complete registered device subscription exists for this user."}

    payload = {
        "title": "XAU AI Sniper Test",
        "body": "Phone alerts are working.",
        "deep_link": "/ai-market-outlook",
        "outlook_id": None,
        "event": "TEST_NOTIFICATION",
    }
    ok, failure_class, provider = _coerce_send_result(await _send_onesignal(user_id, payload))
    now_iso = datetime.now(timezone.utc).isoformat()
    delivery_status = "SENT" if ok else "FAILED"
    await db.cloud_notification_log.insert_one({
        "id": str(uuid.uuid4()),
        "idempotency_key": f"TEST:{user_id}:{now_iso}",
        "user_id": user_id,
        "outlook_id": None,
        "notification_type": "TEST_NOTIFICATION",
        "scheduled_time": now_iso,
        "sent_time": now_iso,
        "delivery_status": delivery_status,
        "device_count": len(devices),
        "retry_count": 0,
        "failure_reason": None if ok else (failure_class or UNKNOWN_FAILURE),
        "provider_http_status": provider.get("http_status"),
        "provider_message_id": provider.get("message_id"),
        "provider_errors": provider.get("errors"),
        "provider_warnings": provider.get("warnings"),
    })
    await db.cloud_push_subscriptions.update_many(
        {"user_id": user_id, "active": True, "opted_in": True},
        {"$set": {"last_test_status": delivery_status, "last_test_at": now_iso, "last_seen_at": now_iso}},
    )
    if ok:
        return {"status": "SENT", "message": "Test notification sent.", "provider_message_id": provider.get("message_id")}
    if failure_class in (NO_ACTIVE_ONESIGNAL_RECIPIENT, NO_DEVICE_REGISTERED):
        return {"status": "NO_DEVICE", "code": "NO_ACTIVE_ONESIGNAL_RECIPIENT", "message": "OneSignal found no active subscribed recipient for this account. Retry device registration."}
    if failure_class == AUTHENTICATION_FAILED:
        return {"status": "FAILED", "message": "OneSignal rejected the REST API Key. Check Admin settings."}
    return {"status": "FAILED", "message": f"Delivery failed ({failure_class or UNKNOWN_FAILURE})."}


async def get_notification_status(user_id: str, account: str = "") -> Dict:
    db = _db()
    prefs = await db.cloud_notification_prefs.find_one({"user_id": user_id}, {"_id": 0})
    saved_tier = (prefs or {}).get("tier", "OFF")
    all_active = await db.cloud_push_subscriptions.find(
        {"user_id": user_id, "active": {"$ne": False}, "opted_in": True}, {"_id": 0},
    ).sort("last_seen_at", -1).to_list(100)
    complete = [row for row in all_active if _device_is_complete(row)]
    incomplete = [row for row in all_active if not _device_is_complete(row)]
    most_recent = (complete or incomplete or [None])[0]

    last_log = await db.cloud_notification_log.find_one(
        {"user_id": user_id}, {"_id": 0}, sort=[("scheduled_time", -1)],
    )
    registration_at = (most_recent or {}).get("updated_at") or (most_recent or {}).get("created_at") or ""
    sent_query = {"user_id": user_id, "delivery_status": "SENT"}
    if registration_at:
        sent_query["scheduled_time"] = {"$gte": registration_at}
    last_sent_ok = await db.cloud_notification_log.find_one(sent_query, {"_id": 0}, sort=[("scheduled_time", -1)])
    onesignal_status = await get_onesignal_status()
    server_ready = onesignal_status["configured"]

    if saved_tier == "OFF":
        final_status, remediation = "OFF", "NONE"
    elif not server_ready:
        final_status, remediation = "SERVER_NOT_CONFIGURED", "CONFIGURE_ONESIGNAL"
    elif not complete and incomplete:
        final_status, remediation = "REGISTRATION_INCOMPLETE", "RETRY_DEVICE_REGISTRATION"
    elif not complete:
        final_status, remediation = "SUBSCRIPTION_MISSING", "REGISTER_DEVICE"
    elif last_log and last_log.get("failure_reason") in (NO_ACTIVE_ONESIGNAL_RECIPIENT, NO_DEVICE_REGISTERED):
        final_status, remediation = "NO_ACTIVE_ONESIGNAL_RECIPIENT", "RETRY_DEVICE_REGISTRATION"
    elif last_log and last_log.get("delivery_status") == "FAILED":
        final_status, remediation = "DELIVERY_FAILED", "RETRY_TEST"
    elif not last_sent_ok:
        final_status, remediation = "READY_NOT_TESTED", "SEND_TEST"
    else:
        final_status, remediation = "ON_VERIFIED", "NONE"

    device_summaries = [{
        "device_id": row.get("id"),
        "subscription_id_masked": _masked_id(row.get("onesignal_subscription_id")),
        "onesignal_id_masked": _masked_id(row.get("onesignal_id")),
        "device_label": row.get("device_label", ""),
        "platform": row.get("platform", ""),
        "browser": row.get("browser", ""),
        "registration_state": "COMPLETE" if _device_is_complete(row) else "INCOMPLETE",
        "last_seen_at": row.get("last_seen_at"),
        "last_test_status": row.get("last_test_status"),
        "last_test_at": row.get("last_test_at"),
    } for row in (complete + incomplete)[:10]]

    return {
        "saved_tier": saved_tier,
        "active_device_count": len(complete),
        "incomplete_device_count": len(incomplete),
        "registered_devices": device_summaries,
        "most_recent_registration": registration_at or None,
        "push_server_configured": server_ready,
        "push_server_initialization_state": onesignal_status["initialization_state"],
        "latest_notification_status": (last_log or {}).get("delivery_status"),
        "latest_failure_reason": (last_log or {}).get("failure_reason"),
        "latest_provider_message_id": (last_log or {}).get("provider_message_id"),
        "latest_sent_time": (last_log or {}).get("sent_time"),
        "latest_opened_time": (last_log or {}).get("opened_time"),
        "final_status": final_status,
        "remediation_code": remediation,
    }
