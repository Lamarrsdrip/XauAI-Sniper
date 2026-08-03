"""AI Market Outlook — hourly advisory market analysis + learning system.

STRICT SEPARATION (verified by tests/test_market_outlook.py): this module
never calls, imports, or references anything that opens, closes, blocks,
delays, sizes, or otherwise touches a live trade. It is a pure read-and-
advise system:
  - reads real evidence the EA has ALREADY computed and POSTed to
    /api/cloud/monitor/activity (the market_thesis/post_trade_state/
    entry_readiness JSON fields built into the EA in earlier v6.24.x work),
  - reads the existing live gold price feed (fetch_live_gold_price),
  - calls the existing LLM integration for narrative synthesis only,
  - writes to its OWN collections (cloud_market_outlooks and friends),
  - never writes to any EA-facing collection, never calls OpenTrade or any
    EA control endpoint, never posts a remote command
    (cloud_bot_commands is never touched by this file).

This module intentionally does NOT own a market-data/indicator pipeline of
its own. The backend has no independent OHLC/candle source (confirmed by
investigation: fetch_live_gold_price returns a single scraped bid/ask, not
bars) -- so every trend/structure/pressure/exhaustion field an outlook
uses is the EA's own most-recently-transmitted evidence for that user's
connected account, not a separately fabricated read. This is an honest
architectural choice, not a shortcut: reusing real, EA-computed evidence
beats inventing a second, unverified analysis pipeline. The practical
consequence, stated plainly: an outlook is only as fresh/available as the
most recent EA heartbeat for that account. If no EA has ever connected for
a user, XAU_MARKET_OUTLOOK returns NO_VALID_OUTLOOK with an honest reason,
never a fabricated one.
"""

from __future__ import annotations

import uuid
import json
import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional

from pydantic import BaseModel
from pymongo.errors import DuplicateKeyError

logger = logging.getLogger("market_outlook")

# ---------------------------------------------------------------------------
# Lazy accessors -- avoids a circular import with server.py (this module is
# imported BY server.py; server.py's own globals like `db`/`LLM_KEY` are only
# resolved the first time an outlook function actually runs, by which point
# server.py has finished its own top-level execution).
# ---------------------------------------------------------------------------

def _server():
    import server as _srv
    return _srv


def _db():
    return _server().db


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

OUTLOOK_SYMBOL = "XAUUSD"
OUTLOOK_HORIZON_HOURS = 4  # how long a published outlook's window stays valid before EXPIRED
OUTLOOK_EVALUATION_MINUTES = 60
HALF_R_WIN_THRESHOLD = 0.50
MAX_PUBLICATION_QUOTE_AGE_SECONDS = 30
MAX_PUBLICATION_QUOTE_FUTURE_SKEW_SECONDS = 30
MAX_HISTORICAL_ANCHOR_AGE_SECONDS = 90
MAX_HISTORICAL_QUOTE_GAP_SECONDS = 10
ROOM_COLLAPSE_R = 0.3      # same threshold the EA's readiness engine uses -- invalidates a candidate

PRIMARY_DIRECTIONS = ("BUY", "SELL", "NEUTRAL", "RANGE", "TRANSITION", "NO_VALID_OUTLOOK")
EXPECTED_PATHS = ("PULLBACK_FIRST_THEN_BUY", "RALLY_FIRST_THEN_SELL", "DIRECT_CONTINUATION",
                  "RANGE_ROTATION", "REVERSAL_FORMING", "NO_CLEAR_PATH")
LIFECYCLE_STATES = ("INFORMATIONAL", "TRACKING_AMBER", "WIN_GREEN_0_5R",
                    "WIN_GREEN_TP1", "LOSS_RED_SL", "LOSS_RED_TIMEOUT")
FINAL_RESULTS = ("WIN_GREEN_0_5R", "WIN_GREEN_TP1", "LOSS_RED_SL",
                 "LOSS_RED_TIMEOUT", "HISTORICAL_DATA_UNAVAILABLE")
NOTIFICATION_TIERS = ("OFF", "HOURLY_ONLY", "HOURLY_PLUS_RESULTS", "ALL_UPDATES")
MILESTONES = ("TRACKING_STARTED", "HALF_R_REACHED", "TP1_HIT", "TP2_HIT",
              "TP3_HIT", "SL_HIT", "TIMEOUT_60M")

SIGNAL_INFORMATIONAL = "INFORMATIONAL"
SIGNAL_TRACKING = "TRACKING_AMBER"
SIGNAL_WIN_HALF_R = "WIN_GREEN_0_5R"
SIGNAL_WIN_TP1 = "WIN_GREEN_TP1"
SIGNAL_LOSS_SL = "LOSS_RED_SL"
SIGNAL_LOSS_TIMEOUT = "LOSS_RED_TIMEOUT"
ANALYTICS_WIN = "WIN"
ANALYTICS_LOSS = "LOSS"
ANALYTICS_UNAVAILABLE = "HISTORICAL_DATA_UNAVAILABLE"

OUTLOOK_ACTIONABLE = "ACTIONABLE_SIGNAL"
OUTLOOK_WATCHING = "WATCHING"
OUTLOOK_NO_SIGNAL = "NO_SIGNAL"
OUTLOOK_DATA_UNAVAILABLE = "DATA_UNAVAILABLE"
OUTLOOK_BLOCKED = "BLOCKED"
OUTLOOK_EXPIRED = "EXPIRED"

EXECUTION_READY_DECISIONS = {
    "ALLOW", "ALLOW_CORE", "ALLOWED", "READY", "EXECUTION_READY", "EXECUTED",
    "FILLED", "BROKER_CONFIRMED",
}
BLOCKED_DECISIONS = {"BLOCKED", "REJECTED", "DENIED", "ERROR"}
EXPIRED_DECISIONS = {"EXPIRED", "CANCELLED", "CANCELED", "TIMED_OUT", "TIMEOUT"}


# ---------------------------------------------------------------------------
# Pydantic models (API-facing)
# ---------------------------------------------------------------------------

class ConfidenceComponents(BaseModel):
    trend_alignment: float = 0.0
    structure: float = 0.0
    pressure: float = 0.0
    location: float = 0.0
    exhaustion: float = 0.0
    remaining_room: float = 0.0
    liquidity_clarity: float = 0.0
    session_news_stability: float = 0.0


class OutlookRevisionIn(BaseModel):
    field: str
    previous_value: Any
    new_value: Any
    reason: str


class NotificationPrefsUpdate(BaseModel):
    tier: str = "HOURLY_PLUS_RESULTS"       # OFF | HOURLY_ONLY | HOURLY_PLUS_RESULTS | ALL_UPDATES
    quiet_hours_start: Optional[int] = None  # local hour 0-23, or None
    quiet_hours_end: Optional[int] = None
    notify_all_devices: bool = True


# OneSignal v16 genuine per-device registration. The raw push token is
# never sent or persisted; token_present proves that OneSignal finished
# creating the browser subscription.
class PushSubscriptionIn(BaseModel):
    onesignal_subscription_id: str
    onesignal_id: str
    external_id: str
    device_instance_id: Optional[str] = ""
    device_label: Optional[str] = ""
    platform: Optional[str] = ""
    browser: Optional[str] = ""
    timezone_offset_minutes: Optional[int] = 0
    permission_state: str
    opted_in: bool
    token_present: bool
    service_worker_scope: Optional[str] = "/"
    registration_version: Optional[str] = "onesignal-web-v16-device-v1"


class PushUnsubscribeIn(BaseModel):
    onesignal_subscription_id: Optional[str] = None
    device_instance_id: Optional[str] = None
    external_id: Optional[str] = None

# ---------------------------------------------------------------------------
# Evidence gathering — reads the EA's own already-transmitted state only
# ---------------------------------------------------------------------------

async def _latest_ea_evidence(license_key: str, account: str, source_event_id: str = "") -> tuple:
    """Reads the most recent cloud_bot_activity event for this account/license
    that carries usable thesis evidence (market_thesis and/or
    entry_readiness populated). Read-only, same scoping pattern
    cloud_monitor_decision_feed already uses. Returns (evidence_or_None,
    reason_code) -- never a fabricated evidence fallback -- so the caller can
    tell a never-connected EA apart from one that connected once and went
    silent, apart from one that is live but hasn't produced usable thesis
    fields yet (this last case should be rare after the v6.24.17 fix that
    stopped gating market_thesis on an ACTIVE CAMPAIGN/open position -- see
    BotMonitorDecisionEvent's thesisJson block on the EA side)."""
    db = _db()
    if not account and not license_key:
        return None, "NO_CONNECTED_EA"
    scope = {"$or": [{"account": account}, {"license_key": license_key}]} if account and license_key \
        else ({"account": account} if account else {"license_key": license_key})
    ever = await db.cloud_bot_activity.find_one(scope, {"_id": 0, "id": 1})
    if not ever:
        return None, "NO_CONNECTED_EA"
    if source_event_id:
        exact = await db.cloud_bot_activity.find_one(
            {"$and": [scope, {"id": source_event_id}]}, {"_id": 0}
        )
        if exact:
            rows = [exact]
        else:
            return None, "SOURCE_EVENT_NOT_FOUND"
    else:
        rows = None
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=20)).isoformat()
    if rows is None:
        rows = await db.cloud_bot_activity.find(
            {"$and": [scope, {"ts": {"$gte": cutoff}}]}, {"_id": 0}
        ).sort("ts", -1).to_list(50)
    if not rows:
        return None, "STALE_EVIDENCE"
    for row in rows:
        details = row.get("details") or {}
        thesis = details.get("market_thesis") or {}
        readiness = details.get("entry_readiness") or {}
        m10_signal = details.get("m10_signal") or {}
        if thesis or readiness or m10_signal:
            return {
                "ts": row.get("ts"),
                "source_event_id": row.get("id") or source_event_id,
                "symbol": row.get("symbol") or OUTLOOK_SYMBOL,
                "market_thesis": thesis,
                "post_trade_state": details.get("post_trade_state") or {},
                "entry_readiness": readiness,
                "m10_signal": m10_signal,
                "regime": details.get("regime") or row.get("mode") or "",
                "session": details.get("session") or "",
                "event_time": row.get("ts"),
                "broker_time": details.get("broker_time") or details.get("server_time"),
                "device_time": details.get("device_time") or details.get("local_time"),
                "execution": {
                    "candidate_allowed": details.get("candidate_allowed"),
                    "final_execution_allowed": details.get("final_execution_allowed"),
                    "final_decision": details.get("final_decision"),
                    "final_blocker": details.get("final_blocker") or details.get("blocked_by"),
                    "pipeline_stage": details.get("pipeline_stage"),
                    "open_trade_called": details.get("open_trade_called"),
                    "broker_retcode": details.get("broker_retcode"),
                },
            }, "OK"
    return None, "INSUFFICIENT_MARKET_EVIDENCE"


def _canonical_m10_signal(evidence: Dict) -> Dict:
    """Resolve an explicit M10 candidate without inventing readiness.

    The M10 engine is the canonical near-term signal source already displayed
    by the Command Center. Advisory fields such as exhaustion_decision may say
    TRANSITION_WATCH for context, but they cannot erase an explicit
    BUY_CANDIDATE/SELL_CANDIDATE emitted by the same immutable EA event.
    Pressure alone is never promoted into a signal.
    """
    evidence = evidence or {}
    m10 = evidence.get("m10_signal") or {}
    readiness = evidence.get("entry_readiness") or {}
    thesis = evidence.get("market_thesis") or {}
    decision = str(
        m10.get("decision")
        or m10.get("final_decision")
        or readiness.get("final_action")
        or readiness.get("action")
        or thesis.get("final_action")
        or thesis.get("action")
        or ""
    ).upper().strip()
    preferred = str(
        m10.get("preferred_direction")
        or m10.get("direction")
        or readiness.get("preferred_direction")
        or readiness.get("direction")
        or thesis.get("preferred_direction")
        or thesis.get("direction")
        or ""
    ).upper().strip()
    freshness = str(m10.get("freshness_state") or "FRESH").upper().strip()
    execution = evidence.get("execution") or {}
    final_decision = str(
        execution.get("final_decision")
        or m10.get("execution_status")
        or m10.get("execution_decision")
        or readiness.get("final_decision")
        or ""
    ).upper().strip()
    blocker = str(
        execution.get("final_blocker")
        or m10.get("blocker_code")
        or m10.get("blocked_by")
        or readiness.get("final_blocker")
        or readiness.get("blocked_by")
        or ""
    ).upper().strip()

    direction = ""
    if decision == "BUY_CANDIDATE":
        direction = "BUY"
    elif decision == "SELL_CANDIDATE":
        direction = "SELL"
    elif decision == "ALLOW_CORE" and preferred in ("BUY", "SELL"):
        direction = preferred

    # An explicit candidate must not contradict a separately supplied preferred
    # direction. Fail closed on malformed telemetry rather than guessing.
    if direction and preferred in ("BUY", "SELL") and preferred != direction:
        direction = ""
    candidate = direction in ("BUY", "SELL")
    stale = freshness not in ("", "FRESH", "CURRENT")
    explicit_allowed = execution.get("final_execution_allowed") is True
    explicit_blocked = (
        execution.get("final_execution_allowed") is False
        and (bool(blocker) or final_decision in BLOCKED_DECISIONS)
    ) or final_decision in BLOCKED_DECISIONS
    expired = (stale or final_decision in EXPIRED_DECISIONS
               or final_decision.startswith(("CANCEL", "EXPIRE", "TIMEOUT")))
    execution_ready = bool(candidate and not expired and not explicit_blocked and (
        explicit_allowed
        or final_decision in EXECUTION_READY_DECISIONS
        or decision == "ALLOW_CORE"
    ))

    try:
        confidence = float(m10.get("confidence")) if m10.get("confidence") is not None else None
    except (TypeError, ValueError):
        confidence = None
    if confidence is not None:
        confidence = max(0.0, min(100.0, confidence))

    return {
        "candidate": candidate,
        "actionable": execution_ready,
        "execution_ready": execution_ready,
        "blocked": bool(candidate and explicit_blocked),
        "expired": bool(candidate and expired),
        "direction": direction,
        "decision": decision,
        "execution_status": final_decision or ("READY" if execution_ready else "PENDING" if candidate else "NO_CANDIDATE"),
        "blocker_code": blocker or None,
        "confidence": confidence,
        "freshness_state": freshness,
        "bar_time": str(m10.get("bar_time") or m10.get("candle_time") or evidence.get("ts") or ""),
        "source": "M10_SIGNAL" if m10 else "READINESS_FALLBACK",
        "candidate_id": str(
            m10.get("candidate_id")
            or m10.get("signal_id")
            or readiness.get("candidate_id")
            or ""
        ),
    }


def _first_positive_number(*values: Any) -> float:
    for value in values:
        try:
            number = float(value or 0.0)
        except (TypeError, ValueError):
            continue
        if number > 0.0:
            return number
    return 0.0


def extract_evidence_quote(evidence: Dict) -> Dict[str, Any]:
    """Return the EA broker quote regardless of which accepted evidence block carried it."""
    evidence = evidence or {}
    thesis = evidence.get("market_thesis") or {}
    readiness = evidence.get("entry_readiness") or {}
    m10 = evidence.get("m10_signal") or {}
    bid = _first_positive_number(thesis.get("live_bid"), m10.get("live_bid"), m10.get("bid"),
                                 readiness.get("live_bid"), readiness.get("bid"))
    ask = _first_positive_number(thesis.get("live_ask"), m10.get("live_ask"), m10.get("ask"),
                                 readiness.get("live_ask"), readiness.get("ask"))
    mid = _first_positive_number(thesis.get("live_mid"), m10.get("live_mid"), readiness.get("live_mid"))
    if not mid and bid > 0.0 and ask >= bid:
        mid = (bid + ask) / 2.0
    quote_at = (
        thesis.get("evidence_time_utc") or m10.get("quote_time") or m10.get("evidence_time_utc")
        or readiness.get("evidence_time_utc") or evidence.get("event_time") or evidence.get("ts")
    )
    valid = bid > 0.0 and ask >= bid
    return {"bid": bid or None, "ask": ask or None, "mid": mid or None,
            "quote_at": quote_at, "valid": valid, "spread": (ask - bid) if valid else None}


def extract_evidence_quote_from_details(details: Dict, event_time: Any = None) -> Dict[str, Any]:
    """Adapter for the activity route before a database read is necessary."""
    details = details or {}
    return extract_evidence_quote({
        "market_thesis": details.get("market_thesis") or {},
        "entry_readiness": details.get("entry_readiness") or {},
        "m10_signal": details.get("m10_signal") or {},
        "event_time": event_time,
    })


def _as_iso(value: Any) -> Optional[str]:
    parsed = _as_utc(value)
    return parsed.isoformat() if parsed else None


def build_authoritative_outlook_contract(evidence: Optional[Dict], evidence_reason: str,
                                         hourly_doc: Optional[Dict] = None,
                                         signal_doc: Optional[Dict] = None,
                                         notification: Optional[Dict] = None,
                                         now: Optional[datetime] = None) -> Dict[str, Any]:
    """Single deterministic M10-first API contract consumed by the Outlook UI."""
    wall_now = _as_utc(now) or datetime.now(timezone.utc)
    evidence = evidence or {}
    canonical = _canonical_m10_signal(evidence)
    quote = extract_evidence_quote(evidence)
    event_at = _as_utc(evidence.get("event_time") or evidence.get("ts"))
    freshness_seconds = max(0, int((wall_now - event_at).total_seconds())) if event_at else None
    missing_fields = []
    if not evidence:
        missing_fields.append("EA_EVIDENCE")
    if evidence and not quote.get("bid"):
        missing_fields.append("BROKER_BID")
    if evidence and not quote.get("ask"):
        missing_fields.append("BROKER_ASK")

    stored_expiry = _as_utc((signal_doc or {}).get("expiry_at"))
    stored_active = bool(
        signal_doc
        and (signal_doc or {}).get("primary_direction") in ("BUY", "SELL")
        and not (signal_doc or {}).get("monitoring_closed")
        and (not stored_expiry or stored_expiry > wall_now)
    )
    direction = canonical.get("direction") or ((signal_doc or {}).get("primary_direction") if stored_active else None)
    confidence = (canonical.get("confidence") if canonical.get("candidate")
                  else (signal_doc or {}).get("confidence_pct") if stored_active else None)
    blocker = canonical.get("blocker_code")
    if not evidence or evidence_reason != "OK" or missing_fields:
        state = OUTLOOK_DATA_UNAVAILABLE
        state_reason = evidence_reason if evidence_reason != "OK" else "MISSING_BROKER_QUOTE"
    elif stored_active and not canonical.get("candidate"):
        state, state_reason = OUTLOOK_ACTIONABLE, "ACTIVE_M10_SIGNAL_PRESERVED"
    elif canonical.get("expired"):
        state, state_reason = OUTLOOK_EXPIRED, "CANDIDATE_EXPIRED"
    elif canonical.get("blocked"):
        state, state_reason = OUTLOOK_BLOCKED, blocker or "EXECUTION_BLOCKED"
    elif canonical.get("actionable"):
        state, state_reason = OUTLOOK_ACTIONABLE, "M10_EXECUTION_READY"
    elif canonical.get("candidate"):
        state, state_reason = OUTLOOK_WATCHING, "AWAITING_EXECUTION_CONFIRMATION"
    else:
        state, state_reason = OUTLOOK_NO_SIGNAL, "NO_QUALIFYING_M10_SETUP"

    notification = notification or {}
    eligible = state == OUTLOOK_ACTIONABLE and not bool(notification.get("delivery_status") == "SENT")
    notification_reason = ("ALREADY_SENT" if state == OUTLOOK_ACTIONABLE and not eligible else "ELIGIBLE") if state == OUTLOOK_ACTIONABLE else {
        OUTLOOK_WATCHING: "CANDIDATE_NOT_EXECUTION_READY",
        OUTLOOK_BLOCKED: "EXECUTION_BLOCKED",
        OUTLOOK_EXPIRED: "STALE_OR_EXPIRED_CANDIDATE",
        OUTLOOK_DATA_UNAVAILABLE: "DATA_UNAVAILABLE",
    }.get(state, "NO_CONFIRMED_SIGNAL")
    hourly_direction = (hourly_doc or {}).get("primary_direction")
    hourly_state = (
        "BULLISH" if hourly_direction == "BUY" else "BEARISH" if hourly_direction == "SELL"
        else "UNAVAILABLE" if hourly_direction == "NO_VALID_OUTLOOK" or not hourly_doc else "NEUTRAL"
    )
    candidate_id = canonical.get("candidate_id") or (
        f"{canonical.get('bar_time')}:{direction}" if canonical.get("candidate") else None
    )
    source_doc = signal_doc or {}
    return {
        "contractVersion": "outlook-current-v3",
        "state": state,
        "stateReason": state_reason,
        "canonicalSource": "M10" if evidence else "NONE",
        "symbol": evidence.get("symbol") or (hourly_doc or {}).get("symbol") or OUTLOOK_SYMBOL,
        "direction": direction,
        "confidence": confidence,
        "confidenceSource": "EA_M10" if confidence is not None else None,
        "executionStatus": canonical.get("execution_status") if canonical.get("candidate") else ("TRACKING" if stored_active else canonical.get("execution_status")),
        "executionReady": bool(canonical.get("execution_ready") or stored_active),
        "candidateId": candidate_id,
        "signalBarTime": _as_iso(canonical.get("bar_time")) or canonical.get("bar_time") or None,
        "eventTime": _as_iso(evidence.get("event_time") or evidence.get("ts")),
        "brokerTime": _as_iso(evidence.get("broker_time")),
        "freshnessSeconds": freshness_seconds,
        "dataHealth": "HEALTHY" if state != OUTLOOK_DATA_UNAVAILABLE else "UNAVAILABLE",
        "missingFields": missing_fields,
        "blockerCode": blocker,
        "blockerLabel": blocker.replace("_", " ").title() if blocker else None,
        "nextRequiredCondition": {
            OUTLOOK_WATCHING: "Wait for the EA's final execution revalidation.",
            OUTLOOK_BLOCKED: "Wait for the reported blocker to clear.",
            OUTLOOK_EXPIRED: "Scanning the next completed M10 bar.",
            OUTLOOK_DATA_UNAVAILABLE: "Wait for a fresh broker Bid/Ask snapshot.",
            OUTLOOK_NO_SIGNAL: "Scanning for the next qualifying M10 setup.",
        }.get(state, "Signal is confirmed by the EA."),
        "m10": {
            **canonical,
            "bid": quote.get("bid"), "ask": quote.get("ask"), "spread": quote.get("spread"),
            "quoteTime": _as_iso(quote.get("quote_at")),
        },
        "hourlyContext": {
            "state": hourly_state,
            "direction": hourly_direction if hourly_direction in ("BUY", "SELL") else None,
            "confidence": (hourly_doc or {}).get("confidence_pct"),
            "reason": (hourly_doc or {}).get("reasoning") or (hourly_doc or {}).get("no_valid_outlook_reason"),
            "generatedAt": (hourly_doc or {}).get("generated_at"),
            "advisoryOnly": True,
        },
        "notificationEligibility": {"eligible": eligible, "reason": notification_reason},
        "notificationSent": bool(notification.get("delivery_status") == "SENT"),
        "notificationEventId": notification.get("id"),
        "lastValidOutlook": source_doc or None,
        "nextEvaluationTime": (wall_now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)).isoformat(),
    }


# ---------------------------------------------------------------------------
# Confidence model — transparent weighted evidence, stored component-by-component
# ---------------------------------------------------------------------------

def _score_component(value: float, good_at: float, bad_at: float) -> float:
    """Linear 0-100 scale between two real evidence anchors. good_at/bad_at
    can be either order (rising-good or falling-good metrics)."""
    if good_at == bad_at:
        return 50.0
    t = (value - bad_at) / (good_at - bad_at)
    return max(0.0, min(100.0, t * 100.0))


def _compute_confidence(direction: int, thesis: Dict, readiness: Dict) -> ConfidenceComponents:
    buy_p = float(thesis.get("buy_pressure", 50.0) or 50.0)
    sell_p = float(thesis.get("sell_pressure", 50.0) or 50.0)
    pressure_for_us = buy_p if direction == 1 else sell_p
    location = str(thesis.get("location", "") or "")
    structure = str(thesis.get("structure", "") or "")
    exhaustion_pct = float(thesis.get("exhaustion_pct", 40.0) or 40.0)
    remaining_room = float(thesis.get("remaining_room_r", 1.0) or 1.0)
    trend_health = 60.0  # neutral default when the EA field isn't present this cycle
    if "action" in thesis:
        trend_health = 75.0 if thesis.get("action") == "ALLOW_CORE" else 45.0

    location_score = {
        "LOCATION_EXCELLENT": 95.0, "LOCATION_GOOD": 78.0, "LOCATION_ACCEPTABLE": 55.0,
        "LOCATION_LATE": 30.0, "LOCATION_EXTREME": 10.0,
        "LOCATION_RESET_PENDING": 40.0, "LOCATION_RESET_CONFIRMED": 70.0,
    }.get(location, 50.0)
    structure_score = {
        "STRUCTURE_STRONGLY_SUPPORTS": 95.0, "STRUCTURE_SUPPORTS": 75.0,
        "STRUCTURE_MIXED": 50.0, "STRUCTURE_OPPOSES": 20.0, "STRUCTURE_INVALIDATED": 0.0,
    }.get(structure, 50.0)

    return ConfidenceComponents(
        trend_alignment=trend_health,
        structure=structure_score,
        pressure=pressure_for_us,
        location=location_score,
        exhaustion=_score_component(exhaustion_pct, good_at=0.0, bad_at=100.0),
        remaining_room=_score_component(remaining_room, good_at=3.0, bad_at=0.0),
        liquidity_clarity=70.0 if thesis.get("action") not in (None, "", "NO_VALID_TRADE") else 35.0,
        session_news_stability=80.0,
    )


def _confidence_pct(c: ConfidenceComponents) -> int:
    weights = {
        "trend_alignment": 0.20, "structure": 0.15, "pressure": 0.20, "location": 0.15,
        "exhaustion": 0.10, "remaining_room": 0.10, "liquidity_clarity": 0.05,
        "session_news_stability": 0.05,
    }
    total = sum(getattr(c, k) * w for k, w in weights.items())
    return int(round(max(0.0, min(100.0, total))))


# Customer-friendly confidence category, calibrated off this module's own
# weighted composite (see _confidence_pct above), not an arbitrary 0-100
# quartile split -- most components default to a 50-70 midpoint when the EA
# hasn't supplied strong readings, so "Moderate" starts above that band.
def _confidence_category(pct: int) -> str:
    if pct < 35:
        return "VERY_LOW"
    if pct < 55:
        return "LOW"
    if pct < 75:
        return "MODERATE"
    return "HIGH"


# ---------------------------------------------------------------------------
# Entry zone / SL / targets — derived from real structure fields, not a
# blind current-price or fixed-R-multiple guess.
# ---------------------------------------------------------------------------

def _compute_zone_and_targets(direction: int, current_price: float, thesis: Dict, atr_estimate: float) -> Dict:
    """direction: 1=BUY, -1=SELL. Uses whatever real distances the EA's own
    campaign/thesis evidence provides (movement consumed / remaining room in
    R, translated back to price via the ATR-scale distance already implicit
    in remaining_room_r) -- not a fixed 1R/2R/3R multiplication of a made-up
    SL distance. Falls back to a conservative ATR-based zone only when no
    richer campaign destination price is present, and labels that
    explicitly (never claims false precision)."""
    atr = max(0.01, float(atr_estimate or 0.0))
    consumed_pct = float(thesis.get("movement_consumed_pct", thesis.get("move_consumed_pct", 40.0)) or 40.0)
    pullback_depth_atr = 0.6 if consumed_pct < 60 else 1.0

    if direction == 1:
        zone_low = round(current_price - pullback_depth_atr * atr, 2)
        zone_high = round(current_price - pullback_depth_atr * 0.4 * atr, 2)
        chase_limit = round(current_price + 0.5 * atr, 2)
        sl = round(zone_low - 0.5 * atr, 2)
    else:
        zone_low = round(current_price + pullback_depth_atr * 0.4 * atr, 2)
        zone_high = round(current_price + pullback_depth_atr * atr, 2)
        chase_limit = round(current_price - 0.5 * atr, 2)
        sl = round(zone_high + 0.5 * atr, 2)

    mid_entry = round((zone_low + zone_high) / 2.0, 2)
    risk_dist = abs(mid_entry - sl)
    if risk_dist <= 0:
        risk_dist = atr

    remaining_room_r = float(thesis.get("remaining_room_r", 2.0) or 2.0)
    remaining_room_r = max(0.5, remaining_room_r)
    tp1_r = min(1.0, remaining_room_r * 0.4)
    tp2_r = min(2.0, remaining_room_r * 0.75)
    tp3_r = remaining_room_r

    def _tp_price(r_mult: float) -> float:
        return round(mid_entry + risk_dist * r_mult, 2) if direction == 1 else round(mid_entry - risk_dist * r_mult, 2)

    return {
        "preferred_entry_zone_low": min(zone_low, zone_high),
        "preferred_entry_zone_high": max(zone_low, zone_high),
        "chase_limit": chase_limit,
        "invalidation_price": sl,
        "suggested_sl": sl,
        "tp1_price": _tp_price(tp1_r), "tp1_r": round(tp1_r, 2),
        "tp2_price": _tp_price(tp2_r), "tp2_r": round(tp2_r, 2),
        "tp3_price": _tp_price(tp3_r), "tp3_r": round(tp3_r, 2),
    }


def _expected_path(direction: int, thesis: Dict) -> str:
    location = str(thesis.get("location", "") or "")
    action = str(thesis.get("action", "") or "")
    if direction == 0:
        return "RANGE_ROTATION" if location in ("LOCATION_ACCEPTABLE", "") else "NO_CLEAR_PATH"
    if action in ("TRANSITION_WATCH", "OPPOSITE_DISCOVERY"):
        return "REVERSAL_FORMING"
    if location in ("LOCATION_LATE", "LOCATION_EXTREME"):
        return "PULLBACK_FIRST_THEN_BUY" if direction == 1 else "RALLY_FIRST_THEN_SELL"
    if action == "ALLOW_CORE":
        return "DIRECT_CONTINUATION"
    return "NO_CLEAR_PATH"


# ---------------------------------------------------------------------------
# LLM narrative synthesis (advisory text only -- never a decision input)
# ---------------------------------------------------------------------------

async def _synthesize_narrative(direction_label: str, confidence: int, thesis: Dict,
                                path: str, zone: Dict, account_id: str) -> Dict[str, str]:
    """Calls the existing LLM integration for the human-readable reasoning
    text only -- every number in the outlook (confidence, zone, SL, targets)
    was already computed above from real evidence before this call; the LLM
    only explains it in prose. If the AI budget is exhausted or the call
    fails, falls back to a template-built explanation using the same real
    numbers -- the outlook is never blocked or degraded by LLM availability."""
    srv = _server()
    cache_key = f"outlook:{direction_label}:{confidence}:{thesis.get('action','')}"
    fallback = {
        "reasoning": (f"{direction_label} bias with {confidence}% confidence. "
                     f"Location: {thesis.get('location','unknown')}. "
                     f"Structure: {thesis.get('structure','unknown')}. "
                     f"Expected path: {path.replace('_',' ').lower()}."),
        "uncertainty": "Template fallback (AI narrative unavailable this cycle) -- numbers above are still real evidence, not fabricated.",
    }
    if not srv.LLM_KEY:
        return fallback
    allowed, _reason = srv._ai_budget_allows("outlook", cache_key, high_impact=False, account_id=account_id)
    if not allowed:
        return fallback
    try:
        chat = srv.LlmChat(
            api_key=srv.LLM_KEY,
            session_id=f"outlook-{uuid.uuid4().hex[:8]}",
            system_message=("You are writing a concise, honest hourly XAUUSD market outlook for manual "
                            "traders. You are NOT deciding a trade -- only explaining evidence that was "
                            "already computed. Use probability language, never certainty. JSON only: "
                            '{"reasoning": "<= 80 words", "uncertainty": "<= 40 words describing what would prove this wrong"}')
        ).with_model("anthropic", "claude-sonnet-4-5-20250929")
        prompt = (f"Direction: {direction_label} | Confidence: {confidence}%\n"
                 f"Location: {thesis.get('location')} | Structure: {thesis.get('structure')} | "
                 f"Pressure buy={thesis.get('buy_pressure')} sell={thesis.get('sell_pressure')}\n"
                 f"Exhaustion: {thesis.get('exhaustion_pct')}% | Movement consumed: {thesis.get('movement_consumed_pct')}%\n"
                 f"Expected path: {path}\n"
                 f"Preferred zone: {zone.get('preferred_entry_zone_low')}-{zone.get('preferred_entry_zone_high')} | "
                 f"SL: {zone.get('suggested_sl')} | TP1/2/3: {zone.get('tp1_price')}/{zone.get('tp2_price')}/{zone.get('tp3_price')}\n"
                 "Write the outlook explanation. JSON only.")
        response = await chat.send_message(srv.UserMessage(text=prompt))
        srv._record_ai_cost("anthropic", "claude-sonnet-4-5-20250929", prompt, response,
                            "outlook", cache_key, "hourly market outlook narrative", account_id=account_id)
        cleaned = response.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.strip("`").split("\n", 1)[-1]
        parsed = json.loads(cleaned)
        return {
            "reasoning": str(parsed.get("reasoning", fallback["reasoning"]))[:600],
            "uncertainty": str(parsed.get("uncertainty", fallback["uncertainty"]))[:300],
        }
    except Exception as e:
        logger.warning(f"Outlook LLM synthesis failed, using template fallback: {e}")
        return fallback


# ---------------------------------------------------------------------------
# Core generation
# ---------------------------------------------------------------------------

def _new_outlook_id(direction_label: str) -> str:
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
    return f"OUTLOOK-{OUTLOOK_SYMBOL}-{ts}-{direction_label}-{uuid.uuid4().hex[:6]}"


def _outlook_slot_id(account: str, symbol: str, hourly_slot: str) -> str:
    return f"outlook-slot:{account}:{symbol}:{hourly_slot}"


def _build_tracking_anchor(direction: str, bid: Any, ask: Any, original_sl: Any) -> Optional[Dict]:
    """Build the immutable executable-price anchor and initial spread state.

    BUY opens at Ask and is immediately valued at Bid. SELL opens at Bid and
    is immediately valued at Ask. Directionally invalid SL geometry is
    rejected rather than hidden behind ``abs()``.
    """
    try:
        direction = str(direction or "").upper()
        bid = float(bid or 0.0)
        ask = float(ask or 0.0)
        sl = float(original_sl or 0.0)
    except (TypeError, ValueError):
        return None
    if direction not in ("BUY", "SELL") or bid <= 0.0 or ask < bid or sl <= 0.0:
        return None
    entry = ask if direction == "BUY" else bid
    geometry_valid = sl < entry if direction == "BUY" else sl > entry
    if not geometry_valid:
        return None
    risk = abs(entry - sl)
    if risk <= 0.0:
        return None
    close_price = bid if direction == "BUY" else ask
    current_r = ((close_price - entry) / risk) if direction == "BUY" else ((entry - close_price) / risk)
    return {
        "tracking_entry_price": entry,
        "original_sl": sl,
        "risk_distance": risk,
        "current_r": round(current_r, 6),
        "mfe_r": round(max(0.0, current_r), 6),
        "mae_r": round(min(0.0, current_r), 6),
        "highest_tracked_price": max(entry, close_price),
        "lowest_tracked_price": min(entry, close_price),
        "last_bid": bid,
        "last_ask": ask,
        "last_tracked_price": close_price,
    }


def _targets_have_valid_geometry(direction: str, entry: Any, tp1: Any, tp2: Any, tp3: Any) -> bool:
    """Fail closed when the published TP ladder cannot describe profit.

    Missing, reversed, or out-of-order targets must never become instant TP
    hits merely because a zero/behind-entry number satisfies a comparison.
    """
    try:
        direction = str(direction or "").upper()
        entry = float(entry or 0.0)
        targets = [float(tp1 or 0.0), float(tp2 or 0.0), float(tp3 or 0.0)]
    except (TypeError, ValueError):
        return False
    if direction == "BUY":
        return entry > 0.0 and entry < targets[0] <= targets[1] <= targets[2]
    if direction == "SELL":
        return entry > 0.0 and entry > targets[0] >= targets[1] >= targets[2] > 0.0
    return False


async def _insert_outlook_atomically(db, doc: Dict, account: str, symbol: str, hourly_slot: str, publication_key: str = "") -> Dict:
    """v6.25.2 owner directive 2026-07-17 -- URGENT duplicate-publication
    repair. hourly_generation_tick()'s existing-slot check and this
    function's own insert are two separate operations with no atomicity
    between them (a genuine read-then-write race) -- two concurrent
    generation passes can both see "no record for this slot" and both
    insert, producing the exact live-evidence duplicate 09:00 TRANSITION
    published twice. Fixed the only way that is actually atomic: give every
    outlook document for a given (account, symbol, hourly_slot) the SAME
    deterministic MongoDB _id (which is uniquely indexed by MongoDB itself,
    no separate index to create or forget). The first insert for a slot
    always wins; a second concurrent attempt raises DuplicateKeyError,
    which is caught here and resolved by returning the ALREADY-PERSISTED
    winning document instead of creating a second one -- so at most one
    outlook, and at most one notification (the caller only dispatches a
    notification when this returns the document IT inserted), can ever
    exist per slot, regardless of how many workers race to generate it."""
    doc = dict(doc)
    publication_key = publication_key or hourly_slot
    doc["publication_key"] = publication_key
    doc["_id"] = _outlook_slot_id(account, symbol, publication_key)
    try:
        await db.cloud_market_outlooks.insert_one(doc)
        doc["_newly_inserted"] = True
        return doc
    except DuplicateKeyError:
        existing = await db.cloud_market_outlooks.find_one({"_id": doc["_id"]})
        logger.info(f"OUTLOOK_SLOT_DUPLICATE_PREVENTED account={account} symbol={symbol} hourly_slot={hourly_slot} -- returning existing winning record, not inserting a second one")
        if existing is None:
            # Extremely unlikely (would mean the winning insert was deleted
            # between the DuplicateKeyError and this read) -- fail closed
            # rather than silently double-inserting.
            raise
        existing["_newly_inserted"] = False
        return existing


def _resolve_hourly_bias(canonical_m10: Dict, thesis: Dict) -> Dict:
    """Pure directional-bias resolver for the Hourly Manual Outlook.

    Answers "which side does the evidence favor this hour", independently of
    whether the strict M10 automated engine approved an executable entry --
    `canonical_m10["actionable"]` is automated execution readiness, not
    "a direction exists". A healthy hour with real buy/sell pressure
    evidence must always resolve to BUY or SELL here; only the caller's
    upstream evidence/price checks (missing EA evidence, stale data, failed
    price sanity) are allowed to withhold a direction entirely, via the
    separate NO_VALID_OUTLOOK paths in generate_outlook_for_account.

    Returns direction_label/direction, confidence (0-100) and its customer
    category, and the automated-execution-status fields the Command Center
    needs to explain "why didn't XauCloud enter" separately from the
    manual bias itself.
    """
    raw_dir = canonical_m10.get("direction") or ""  # "" | "BUY" | "SELL" -- explicit EA candidate
    actionable = bool(canonical_m10.get("actionable"))  # automated M10 execution-ready
    automated_entry_approved = actionable
    automated_block_reason = None if actionable else (canonical_m10.get("blocker_code") or canonical_m10.get("execution_status") or None)

    buy_p = float(thesis.get("buy_pressure", 50.0) or 50.0)
    sell_p = float(thesis.get("sell_pressure", 50.0) or 50.0)
    pressure_gap = buy_p - sell_p  # positive = bullish pressure dominant
    structure_state = str(thesis.get("structure", "") or "")

    # v6.25.x owner directive -- the Hourly Manual Outlook is a directional
    # ADVISORY, answered independently of whether the strict M10 automated
    # engine approved an executable entry this hour. Gating direction on
    # `actionable` conflates "no automated entry" with "no directional
    # evidence", which is exactly why a healthy hour with real buy/sell
    # pressure evidence used to be able to publish NEUTRAL. Direction now
    # answers "which side does the evidence favor": an explicit EA
    # candidate first (whether or not it was execution-approved), else the
    # raw buy/sell pressure reading itself.
    directional_conflict = None
    directional_transformation_applied = False
    if raw_dir in ("BUY", "SELL"):
        direction_label = raw_dir
    elif buy_p != sell_p:
        direction_label = "BUY" if buy_p > sell_p else "SELL"
    else:
        # Genuine exact tie in the underlying evidence -- policy still
        # requires a side (never NEUTRAL on healthy data); deterministic
        # tiebreak, always capped to Very Low confidence below.
        direction_label = "BUY"
    direction = 1 if direction_label == "BUY" else -1

    # v6.24.17 directional-consistency validator: a direction must never
    # publish against a materially dominant opposite pressure reading unless
    # structure documents a real override. Prevents the observed incident
    # (published SELL while reasoning/evidence said "buy pressure
    # significantly outweighs sell pressure"). Previously this collapsed the
    # outlook to NEUTRAL/0% confidence, which contradicted its own
    # reasoning text; now it flips to the pressure-dominant side instead --
    # still never publishing the contradicted direction, but never erasing
    # the bias either -- and confidence is reduced, not zeroed.
    structural_override_bearish = structure_state in ("STRUCTURE_STRONGLY_SUPPORTS", "STRUCTURE_SUPPORTS") and direction == -1
    structural_override_bullish = structure_state in ("STRUCTURE_STRONGLY_SUPPORTS", "STRUCTURE_SUPPORTS") and direction == 1
    if direction_label == "SELL" and pressure_gap >= 15.0 and not structural_override_bearish:
        directional_conflict = f"buy pressure ({buy_p:.0f}) outweighs sell pressure ({sell_p:.0f}) with no documented bearish structural override"
    elif direction_label == "BUY" and pressure_gap <= -15.0 and not structural_override_bullish:
        directional_conflict = f"sell pressure ({sell_p:.0f}) outweighs buy pressure ({buy_p:.0f}) with no documented bullish structural override"
    if directional_conflict:
        direction_label = "BUY" if pressure_gap > 0 else "SELL"
        direction = 1 if direction_label == "BUY" else -1
        directional_transformation_applied = True

    market_regime = "TRANSITION" if directional_transformation_applied else str(
        thesis.get("market_regime")
        or thesis.get("regime")
        or thesis.get("direction_stage")
        or thesis.get("lifecycle")
        or "WAITING"
    ).upper()

    components = _compute_confidence(direction, thesis, {})
    evidence_strength = _confidence_pct(components)
    canonical_confidence = canonical_m10.get("confidence") if (raw_dir == direction_label and not directional_transformation_applied) else None
    confidence = round(canonical_confidence) if canonical_confidence is not None else evidence_strength
    # Small evidence advantages must read as low confidence and large ones
    # can read as high confidence, regardless of how strong the rest of the
    # multi-factor composite looks -- the primary directional evidence gap
    # is the ceiling, not just one 20%-weighted component among many.
    pressure_gap_abs = abs(pressure_gap)
    if pressure_gap_abs < 4.0:
        confidence = min(confidence, 25)
    elif pressure_gap_abs < 12.0:
        confidence = min(confidence, 45)
    elif pressure_gap_abs < 25.0:
        confidence = min(confidence, 70)
    if directional_transformation_applied:
        # A resolved candidate-vs-pressure conflict is itself a
        # confidence-reducing signal -- never publish it as High.
        confidence = min(confidence, 65)
    confidence = max(0, min(100, int(confidence)))
    confidence_category = _confidence_category(confidence)

    return {
        "direction_label": direction_label,
        "direction": direction,
        "market_regime": market_regime,
        "components": components,
        "evidence_strength": evidence_strength,
        "confidence": confidence,
        "confidence_category": confidence_category,
        "directional_conflict": directional_conflict,
        "directional_transformation_applied": directional_transformation_applied,
        "automated_entry_approved": automated_entry_approved,
        "automated_block_reason": automated_block_reason,
    }


async def generate_outlook_for_account(license_key: str, account: str, account_id: str = "",
                                        is_late_catchup: bool = False, publication_key: str = "",
                                        publication_mode: str = "HOURLY", source_event_id: str = "") -> Optional[Dict]:
    """Generates and persists ONE new immutable outlook document for this
    account, using only real, already-transmitted EA evidence + the live
    price feed. Returns the stored document, or None if there is genuinely
    no usable evidence yet (never fabricates one to avoid returning None)."""
    srv = _server()
    db = _db()

    evidence, evidence_reason = await _latest_ea_evidence(license_key, account, source_event_id=source_event_id)

    # v6.24.17 CRITICAL FIX: a real production incident published an entry
    # zone ~$960 away from the live broker price because this function used
    # to ALWAYS call fetch_live_gold_price() -- a scraped third-party COMEX
    # futures quote with a hardcoded stale-price fallback -- as the "current
    # price" for zone/SL/TP math, even for an account with its own connected,
    # live EA reporting its actual broker bid/ask every decision. The EA's
    # own reported price (now always sent -- see the EA's thesisJson
    # live_bid/live_ask/live_mid fields, v6.24.17) is the only authoritative
    # price for THIS account's THIS symbol; the external feed is now used
    # only as a last-resort fallback when no EA price is available at all,
    # and is refused outright if it is itself the hardcoded stale constant.
    thesis_preview = (evidence.get("market_thesis") or {}) if evidence else {}
    evidence_quote = extract_evidence_quote(evidence or {})
    ea_mid = float(evidence_quote.get("mid") or 0.0)
    current_price = 0.0
    price_source = "NONE"
    if ea_mid > 0.0:
        current_price = ea_mid
        price_source = "EA_LIVE_BROKER_PRICE"
    else:
        price_info = await srv.fetch_live_gold_price()
        if price_info.get("source") == "live" and float(price_info.get("bid", 0.0) or 0.0) > 0.0:
            current_price = float(price_info.get("bid", 0.0) or 0.0)
            price_source = "EXTERNAL_FALLBACK_FEED"
        # else: stays 0.0 / "NONE" -- the stale hardcoded constant (source ==
        # "fallback_stale_constant") is never treated as a usable price here.

    outlook_id = _new_outlook_id("PENDING")
    now = datetime.now(timezone.utc)
    # v6.24.18 owner directive 2026-07-16 -- explicit hourly slot key
    # (account + symbol + UTC hour), NOT "however many minutes ago the last
    # one happened to publish". A publication at 18:51 belongs to the 18:00
    # slot; this field is what lets hourly_generation_tick check "does the
    # 19:00 slot exist yet" instead of "was anything published recently",
    # which is the exact distinction that prevented the 19:00 slot from
    # being skipped by a late 18:51 publication.
    hourly_slot = now.strftime("%Y-%m-%dT%H:00")
    publication_key = publication_key or hourly_slot

    if not evidence or current_price <= 0:
        no_valid_reason = evidence_reason if not evidence else "INTERNAL_GENERATION_ERROR"
        reason_text = {
            "NO_CONNECTED_EA": "No EA has ever reported activity for this account -- connect and run your EA to begin receiving hourly outlooks.",
            "STALE_EVIDENCE": "This account's EA has connected before, but has not reported any activity in the last 6 hours -- check that it is still running.",
            "INSUFFICIENT_MARKET_EVIDENCE": "The EA is connected and reporting, but its recent events do not yet carry usable market-thesis or entry-readiness data.",
            "INTERNAL_GENERATION_ERROR": "No usable live price is available from the EA or the fallback feed right now, so no outlook could be generated this cycle.",
        }.get(no_valid_reason, "No recent EA evidence available for this account yet -- nothing to analyze.")
        doc = {
            "id": outlook_id.replace("PENDING", "NO_VALID_OUTLOOK"),
            "symbol": OUTLOOK_SYMBOL,
            "account": account, "license_key": license_key,
            "generated_at": now.isoformat(),
            "hourly_slot": hourly_slot,
        "publication_key": publication_key,
            "publication_mode": publication_mode,
            "source_event_id": source_event_id or None,
            "late_catchup": is_late_catchup,
            "expiry_at": (now + timedelta(hours=OUTLOOK_HORIZON_HOURS)).isoformat(),
            "current_price": current_price,
            "primary_direction": "NO_VALID_OUTLOOK",
            "outlook_type": "HOURLY_MANUAL_BIAS",
            "execution_authority": False,
            "no_valid_outlook_reason": no_valid_reason,
            "confidence_pct": 0,
            "confidence_components": ConfidenceComponents().model_dump(),
            "status": "PUBLISHED",
            "reasoning": reason_text,
            "uncertainty": "Connect and run your EA to begin receiving hourly outlooks." if no_valid_reason in ("NO_CONNECTED_EA", "STALE_EVIDENCE") else "Retry next hourly cycle.",
            "expected_path": "NO_CLEAR_PATH",
            "setup_type": "NONE",
        }
        return await _insert_outlook_atomically(db, doc, account, OUTLOOK_SYMBOL, hourly_slot, publication_key=publication_key)

    # Analysis fields remain thesis-first, but accepted quote/time fields are
    # normalized independently so an M10 payload cannot be rejected merely
    # because its broker snapshot was nested under m10_signal/readiness.
    thesis = dict(evidence.get("m10_signal") or {})
    thesis.update(evidence.get("entry_readiness") or {})
    thesis.update(evidence.get("market_thesis") or {})
    readiness = evidence.get("entry_readiness") or {}
    canonical_m10 = _canonical_m10_signal(evidence)
    action = canonical_m10["decision"]

    bias = _resolve_hourly_bias(canonical_m10, thesis)
    direction_label = bias["direction_label"]
    direction = bias["direction"]
    market_regime = bias["market_regime"]
    components = bias["components"]
    evidence_strength = bias["evidence_strength"]
    confidence = bias["confidence"]
    confidence_category = bias["confidence_category"]
    directional_conflict = bias["directional_conflict"]
    directional_transformation_applied = bias["directional_transformation_applied"]
    automated_entry_approved = bias["automated_entry_approved"]
    automated_block_reason = bias["automated_block_reason"]
    if directional_conflict:
        buy_p = float(thesis.get("buy_pressure", 50.0) or 50.0)
        sell_p = float(thesis.get("sell_pressure", 50.0) or 50.0)
        logger.warning(f"OUTLOOK_DIRECTIONAL_CONFLICT | account={account} buy_pressure={buy_p} sell_pressure={sell_p} -> flipped to pressure-dominant side {direction_label}")
    data_status = "LIVE"
    path = _expected_path(direction, thesis)
    setup_type = ("WITH_TREND_PULLBACK" if path.startswith(("PULLBACK", "RALLY"))
                 else "TREND_CONTINUATION" if path == "DIRECT_CONTINUATION"
                 else "OPPOSITE_DIRECTION_REVERSAL" if path == "REVERSAL_FORMING"
                 else "NONE")

    zone = {}
    price_sanity_failed = False
    if direction != 0 and direction_label in ("BUY", "SELL"):
        ea_struct_entry = float(thesis.get("structural_entry", 0.0) or 0.0)
        ea_struct_sl = float(thesis.get("structural_sl", 0.0) or 0.0)
        ea_atr = float(thesis.get("atr_m5", 0.0) or 0.0)
        if ea_struct_entry > 0.0 and ea_struct_sl > 0.0 and ea_atr > 0.0:
            # Prefer the EA's own structural entry/SL/TP -- computed from its
            # own live bid/ask at the SAME evidence timestamp as everything
            # else in `thesis`, using the exact same risk-distance convention
            # the EA's live order-execution funnel uses (atr * InpSLMultiplier).
            # This is the "one atomic evidence snapshot" the whole zone must
            # come from.
            zone = {
                "preferred_entry_zone_low": round(min(ea_struct_entry, ea_struct_entry - ea_atr * 0.15), 2),
                "preferred_entry_zone_high": round(max(ea_struct_entry, ea_struct_entry + ea_atr * 0.15), 2),
                "chase_limit": round(ea_struct_entry + (ea_atr * 0.5 if direction == 1 else -ea_atr * 0.5), 2),
                "invalidation_price": round(ea_struct_sl, 2),
                "suggested_sl": round(ea_struct_sl, 2),
                "tp1_price": round(float(thesis.get("tp1_price", 0.0) or 0.0), 2), "tp1_r": 1.0,
                "tp2_price": round(float(thesis.get("tp2_price", 0.0) or 0.0), 2), "tp2_r": 2.0,
                "tp3_price": round(float(thesis.get("tp3_price", 0.0) or 0.0), 2),
                "tp3_r": round(max(1.0, float(thesis.get("remaining_room_r", 2.0) or 2.0)), 2),
            }
        else:
            # Older EA build without the v6.24.17 structural fields yet --
            # fall back to the ATR-proxy geometry, still anchored to the
            # EA's own current_price (never the external feed) when possible.
            atr_estimate = ea_atr if ea_atr > 0.0 else current_price * 0.0035
            zone = _compute_zone_and_targets(direction, current_price, thesis, atr_estimate)

        # Hard price-sanity gate: an entry zone must be geometrically near
        # the account's own current price. Bounded by ATR (not an arbitrary
        # dollar figure) with a generous multiple, plus a percentage floor
        # for when ATR itself is missing/zero. This is what would have
        # caught the $960 divergence outright, regardless of root cause.
        entry_mid = (zone.get("preferred_entry_zone_low", current_price) + zone.get("preferred_entry_zone_high", current_price)) / 2.0
        atr_for_check = ea_atr if ea_atr > 0.0 else max(1.0, current_price * 0.005)
        max_allowed_distance = max(atr_for_check * 5.0, current_price * 0.02)
        distance = abs(entry_mid - current_price)
        if distance > max_allowed_distance:
            price_sanity_failed = True
            logger.error(f"OUTLOOK_PRICE_SANITY_FAILED | account={account} market={current_price} entryMid={entry_mid} distance={distance} maxAllowed={max_allowed_distance} atr={atr_for_check} priceSource={price_source} action=NO_PUBLISH")

    if price_sanity_failed:
        doc = {
            "id": outlook_id.replace("PENDING", "NO_VALID_OUTLOOK"),
            "symbol": OUTLOOK_SYMBOL,
            "account": account, "license_key": license_key,
            "generated_at": now.isoformat(),
            "hourly_slot": hourly_slot,
        "publication_key": publication_key,
            "publication_mode": publication_mode,
            "source_event_id": source_event_id or None,
            "late_catchup": is_late_catchup,
            "expiry_at": (now + timedelta(hours=OUTLOOK_HORIZON_HOURS)).isoformat(),
            "current_price": current_price,
            "primary_direction": "NO_VALID_OUTLOOK",
            "outlook_type": "HOURLY_MANUAL_BIAS",
            "execution_authority": False,
            "no_valid_outlook_reason": "INTERNAL_DATA_INCONSISTENCY",
            "confidence_pct": 0,
            "confidence_components": ConfidenceComponents().model_dump(),
            "status": "PUBLISHED",
            "reasoning": "Computed entry geometry did not pass price-sanity validation against the account's live market price this cycle.",
            "uncertainty": "Retry next hourly cycle.",
            "expected_path": "NO_CLEAR_PATH",
            "setup_type": "NONE",
        }
        return await _insert_outlook_atomically(db, doc, account, OUTLOOK_SYMBOL, hourly_slot, publication_key=publication_key)

    # Signal-performance tracking is anchored to the broker-executable quote
    # in the same immutable EA evidence snapshot used to publish the outlook.
    # The suggested zone remains analysis-only; it is never an activation
    # gate and never becomes the performance entry.
    published_bid = float(evidence_quote.get("bid") or 0.0)
    published_ask = float(evidence_quote.get("ask") or 0.0)
    raw_published_quote_at = evidence_quote.get("quote_at")
    published_quote_dt = _as_utc(raw_published_quote_at)
    published_quote_at = published_quote_dt.isoformat() if published_quote_dt else None
    actionable = direction_label in ("BUY", "SELL")
    original_sl = zone.get("suggested_sl")
    tracking_anchor = _build_tracking_anchor(direction_label, published_bid, published_ask, original_sl) if actionable else None
    quote_age_seconds = (now - published_quote_dt).total_seconds() if published_quote_dt else None
    quote_fresh = (quote_age_seconds is not None
                   and -MAX_PUBLICATION_QUOTE_FUTURE_SKEW_SECONDS <= quote_age_seconds <= MAX_PUBLICATION_QUOTE_AGE_SECONDS)
    target_geometry_valid = bool(
        tracking_anchor
        and _targets_have_valid_geometry(
            direction_label,
            tracking_anchor["tracking_entry_price"],
            zone.get("tp1_price"), zone.get("tp2_price"), zone.get("tp3_price"),
        )
    ) if actionable else True
    if actionable and tracking_anchor and not quote_fresh:
        # Do not consume the deterministic hourly slot with an actionable
        # signal anchored to an old quote. The activity endpoint invokes the
        # same canonical hourly publisher on the next fresh EA Bid/Ask event.
        logger.info(
            "OUTLOOK_AWAITING_FRESH_PUBLICATION_QUOTE account=%s direction=%s quoteAt=%s ageSeconds=%s",
            account, direction_label, published_quote_at, quote_age_seconds,
        )
        return None

    quote_valid = bool(tracking_anchor and target_geometry_valid)
    if actionable and not quote_valid:
        invalid_reason = ("PUBLISHED_TARGET_GEOMETRY_INVALID" if tracking_anchor and not target_geometry_valid
                          else "EXECUTABLE_PUBLICATION_QUOTE_OR_SL_INVALID")
        logger.error(
            "OUTLOOK_PUBLICATION_QUOTE_INVALID | account=%s direction=%s bid=%s ask=%s sl=%s quoteAt=%s ageSeconds=%s reason=%s action=NO_VALID_OUTLOOK",
            account, direction_label, published_bid, published_ask, original_sl,
            published_quote_at, quote_age_seconds, invalid_reason,
        )
        doc = {
            "id": outlook_id.replace("PENDING", "NO_VALID_OUTLOOK"),
            "symbol": OUTLOOK_SYMBOL, "account": account, "license_key": license_key,
            "generated_at": now.isoformat(), "published_at": now.isoformat(),
            "hourly_slot": hourly_slot, "late_catchup": is_late_catchup,
            "expiry_at": (now + timedelta(hours=OUTLOOK_HORIZON_HOURS)).isoformat(),
            "current_price": current_price, "primary_direction": "NO_VALID_OUTLOOK",
            "outlook_type": "HOURLY_MANUAL_BIAS", "execution_authority": False,
            "no_valid_outlook_reason": invalid_reason,
            "confidence_pct": 0, "confidence_components": ConfidenceComponents().model_dump(),
            "status": "INFORMATIONAL", "signal_state": SIGNAL_INFORMATIONAL,
            "reasoning": "No complete broker Bid/Ask snapshot was available, so no actionable signal or performance record was created.",
            "uncertainty": "Wait for a fresh EA quote.", "expected_path": "NO_CLEAR_PATH", "setup_type": "NONE",
            "analytics_outcome": None, "excluded_from_signal_analytics": True,
        }
        return await _insert_outlook_atomically(db, doc, account, OUTLOOK_SYMBOL, hourly_slot, publication_key=publication_key)

    tracking_entry = tracking_anchor["tracking_entry_price"] if tracking_anchor else None
    risk_distance = tracking_anchor["risk_distance"] if tracking_anchor else None

    narrative = await _synthesize_narrative(direction_label, confidence, thesis, path, zone, account_id)

    outlook_id = _new_outlook_id(direction_label)
    published_at = now.isoformat()
    doc = {
        "id": outlook_id,
        "symbol": OUTLOOK_SYMBOL,
        "account": account, "license_key": license_key,
        "generated_at": published_at,
        "published_at": published_at,
        "hourly_slot": hourly_slot,
        "publication_key": publication_key,
        "publication_mode": publication_mode,
        "source_event_id": source_event_id or None,
        "late_catchup": is_late_catchup,
        "expiry_at": (now + timedelta(hours=OUTLOOK_HORIZON_HOURS)).isoformat(),
        "current_price": current_price,
        "price_source": price_source,
        "primary_direction": direction_label,
        "actionable_signal": direction_label if direction_label in ("BUY", "SELL") else "NO_TRADE_RIGHT_NOW",
        "market_regime": market_regime,
        "data_status": data_status,
        "evidence_strength_pct": evidence_strength,
        "direction": direction,
        "directional_conflict": directional_conflict,
        "directional_transformation_applied": directional_transformation_applied,
        "source_regime": evidence.get("regime", ""),
        "signal_source": canonical_m10.get("source"),
        "source_m10_decision": canonical_m10.get("decision"),
        "source_m10_bar_time": canonical_m10.get("bar_time"),
        "setup_type": setup_type,
        "confidence_pct": confidence,
        "confidence_category": confidence_category,
        "confidence_components": components.model_dump(),
        # Manual-advisory identity: this document is a directional opinion
        # only. It carries zero automated execution authority and must
        # never be interpreted as "XauCloud opened/approved a trade" -- see
        # automated_entry_approved/automated_block_reason for the separate,
        # real M10 automated-execution status this hour.
        "outlook_type": "HOURLY_MANUAL_BIAS",
        "execution_authority": False,
        "automated_entry_approved": automated_entry_approved,
        "automated_block_reason": automated_block_reason,
        "expected_path": path,
        "preferred_entry_zone_low": zone.get("preferred_entry_zone_low"),
        "preferred_entry_zone_high": zone.get("preferred_entry_zone_high"),
        "chase_limit": zone.get("chase_limit"),
        "invalidation_price": zone.get("invalidation_price"),
        "suggested_sl": zone.get("suggested_sl"),
        "tp1_price": zone.get("tp1_price"), "tp1_r": zone.get("tp1_r"),
        "tp2_price": zone.get("tp2_price"), "tp2_r": zone.get("tp2_r"),
        "tp3_price": zone.get("tp3_price"), "tp3_r": zone.get("tp3_r"),
        # v6.24.17 owner directive: expose the EA's own raw-vs-final SL
        # geometry so the Outlook is transparent about the 20% structural
        # widening policy -- never recomputed/re-widened here, only passed
        # through from the EA's own thesis snapshot (source of truth).
        "raw_structural_sl": thesis.get("raw_structural_sl"),
        "raw_sl_distance": thesis.get("raw_sl_distance"),
        "sl_widening_factor": thesis.get("sl_widening_factor"),
        "final_structural_sl": thesis.get("final_structural_sl"),
        "final_sl_distance": thesis.get("final_sl_distance"),
        "configured_risk_pct": thesis.get("configured_risk_pct"),
        "buy_pressure": thesis.get("buy_pressure"),
        "sell_pressure": thesis.get("sell_pressure"),
        "exhaustion_pct": thesis.get("exhaustion_pct"),
        "movement_consumed_pct": thesis.get("movement_consumed_pct"),
        "remaining_room_r": thesis.get("remaining_room_r"),
        "trend_state": thesis.get("lifecycle", thesis.get("direction_stage", "")),
        "structure_state": thesis.get("structure", ""),
        "liquidity_destination": thesis.get("primary_destination") or thesis.get("first_destination"),
        "session": evidence.get("session", ""),
        "expected_holding_horizon": "hours" if setup_type != "NONE" else "n/a",
        "reasoning": narrative["reasoning"],
        "uncertainty": narrative["uncertainty"],
        "status": "TRACKING" if actionable else "INFORMATIONAL",
        "signal_state": SIGNAL_TRACKING if actionable else SIGNAL_INFORMATIONAL,
        "signal_tracking_version": 2,
        "published_bid": published_bid if published_bid > 0 else None,
        "published_ask": published_ask if published_ask > 0 else None,
        "published_spread": (published_ask - published_bid) if published_bid > 0 and published_ask >= published_bid else None,
        "published_quote_at": published_quote_at,
        "tracking_entry_price": tracking_entry if actionable else None,
        "original_sl": original_sl if actionable else None,
        "risk_distance": risk_distance if actionable else None,
        "evaluation_deadline": (now + timedelta(minutes=OUTLOOK_EVALUATION_MINUTES)).isoformat() if actionable else None,
        "activation": {"activated": actionable, "activated_at": published_at if actionable else None,
                       "activated_price": tracking_entry if actionable else None},
        "milestones_hit": [],
        "final_result": None,
        "final_r": None,
        "analytics_outcome": None,
        "analytics_r": None,
        "current_r": tracking_anchor["current_r"] if actionable else None,
        "mfe_r": tracking_anchor["mfe_r"] if actionable else None,
        "mae_r": tracking_anchor["mae_r"] if actionable else None,
        "highest_tracked_price": tracking_anchor["highest_tracked_price"] if actionable else None,
        "lowest_tracked_price": tracking_anchor["lowest_tracked_price"] if actionable else None,
        "last_bid": tracking_anchor["last_bid"] if actionable else None,
        "last_ask": tracking_anchor["last_ask"] if actionable else None,
        "last_tracked_price": tracking_anchor["last_tracked_price"] if actionable else None,
        "first_half_r_at": None,
        "tp1_hit_at": None, "tp2_hit_at": None, "tp3_hit_at": None, "sl_hit_at": None,
        "classification_at": None, "latest_path_event": "TRACKING_STARTED" if actionable else "INFORMATIONAL_UPDATE",
        "notification_flags": {}, "last_monitored_at": published_quote_at if actionable else None,
        "event_snapshots": ({
            "TRACKING_STARTED": {
                "event_at": published_at,
                "hit_price": tracking_entry,
                "achieved_r": tracking_anchor["current_r"],
            }
        } if actionable else {}),
        "excluded_from_signal_analytics": not actionable,
        "highest_tp_reached": None,
        "mfe": tracking_anchor["mfe_r"] if actionable else 0.0,
        "mae": tracking_anchor["mae_r"] if actionable else 0.0,
        "color_state": "AMBER",
    }
    stored = await _insert_outlook_atomically(db, doc, account, OUTLOOK_SYMBOL, hourly_slot, publication_key=publication_key)
    if stored.get("_newly_inserted"):
        logger.info(f"OUTLOOK_PUBLISHED id={outlook_id} dir={direction_label} conf={confidence}% account={account}")
    return stored


async def publish_m10_signal_from_activity(license_key: str, account: str,
                                           source_event_id: str = "") -> int:
    """Persist M10 lifecycle truth and publish only an execution-ready signal.

    The normal hourly slot remains the informational cadence. A deterministic
    M10 publication key lets a candidate arriving after an earlier neutral
    hourly outlook become visible immediately while repeated telemetry for the
    same M10 bar remains idempotent.
    """
    evidence, reason = await _latest_ea_evidence(
        license_key, account, source_event_id=source_event_id
    )
    if not evidence:
        logger.info("M10_OUTLOOK_NOT_PUBLISHED account=%s reason=%s", account, reason)
        return 0
    canonical = _canonical_m10_signal(evidence)
    if not canonical.get("candidate"):
        return 0

    identity = canonical.get("candidate_id") or f"{account}|{OUTLOOK_SYMBOL}|{canonical.get('bar_time')}|{canonical.get('direction')}"
    candidate_id = canonical.get("candidate_id") or uuid.uuid5(uuid.NAMESPACE_URL, identity).hex
    event_state = (
        OUTLOOK_EXPIRED if canonical.get("expired") else
        OUTLOOK_BLOCKED if canonical.get("blocked") else
        OUTLOOK_ACTIONABLE if canonical.get("actionable") else OUTLOOK_WATCHING
    )
    notification_reason = (
        "ELIGIBLE" if canonical.get("actionable") else
        "STALE_OR_EXPIRED_CANDIDATE" if canonical.get("expired") else
        "EXECUTION_BLOCKED" if canonical.get("blocked") else
        "CANDIDATE_NOT_EXECUTION_READY"
    )
    now_iso = datetime.now(timezone.utc).isoformat()
    event_doc = {
        "candidate_id": candidate_id,
        "account": account,
        "license_key": license_key,
        "symbol": OUTLOOK_SYMBOL,
        "signal_bar_time": canonical.get("bar_time"),
        "event_type": event_state,
        "event_version": 1,
        "event_time": evidence.get("event_time") or evidence.get("ts") or now_iso,
        "source_event_id": source_event_id or evidence.get("source_event_id"),
        "direction": canonical.get("direction"),
        "confidence": canonical.get("confidence"),
        "freshness_state": canonical.get("freshness_state"),
        "execution_status": canonical.get("execution_status"),
        "execution_ready": bool(canonical.get("execution_ready")),
        "blocker_code": canonical.get("blocker_code"),
        "notification_eligibility": bool(canonical.get("actionable")),
        "notification_reason": notification_reason,
        "updated_at": now_iso,
    }
    await _db().cloud_outlook_signal_events.update_one(
        {"account": account, "candidate_id": candidate_id, "event_type": event_state, "event_version": 1},
        {"$set": event_doc, "$setOnInsert": {"id": str(uuid.uuid4()), "created_at": now_iso}},
        upsert=True,
    )
    if not canonical.get("actionable"):
        logger.info(
            "M10_SIGNAL_SUPPRESSED account=%s candidate=%s state=%s reason=%s",
            account, candidate_id, event_state, notification_reason,
        )
        return 0

    publication_key = f"m10-signal:{uuid.uuid5(uuid.NAMESPACE_URL, identity).hex}"
    doc = await generate_outlook_for_account(
        license_key,
        account,
        account_id=account,
        publication_key=publication_key,
        publication_mode="M10_SIGNAL",
        source_event_id=source_event_id,
    )
    if not doc:
        await _db().cloud_outlook_signal_events.update_one(
            {"account": account, "candidate_id": candidate_id, "event_type": OUTLOOK_ACTIONABLE, "event_version": 1},
            {"$set": {"notification_eligibility": False,
                      "notification_reason": "AWAITING_FRESH_PUBLICATION_QUOTE"}},
        )
        return 0
    newly_inserted = doc.pop("_newly_inserted", True)
    if newly_inserted and doc.get("primary_direction") in ("BUY", "SELL"):
        await _dispatch_signal_event(doc, "TRACKING_STARTED")
        await _db().cloud_outlook_signal_events.update_one(
            {"account": account, "candidate_id": candidate_id, "event_type": OUTLOOK_ACTIONABLE, "event_version": 1},
            {"$set": {"outlook_id": doc.get("id"), "notification_dispatched_at": datetime.now(timezone.utc).isoformat()}},
        )
        logger.info(
            "M10_OUTLOOK_PUBLISHED id=%s account=%s direction=%s bar=%s",
            doc.get("id"), account, doc.get("primary_direction"), canonical.get("bar_time"),
        )
        return 1
    if doc.get("primary_direction") not in ("BUY", "SELL"):
        await _db().cloud_outlook_signal_events.update_one(
            {"account": account, "candidate_id": candidate_id, "event_type": OUTLOOK_ACTIONABLE, "event_version": 1},
            {"$set": {"notification_eligibility": False,
                      "notification_reason": "PUBLICATION_VALIDATION_FAILED",
                      "outlook_id": doc.get("id")}},
        )
    return 0


async def hourly_generation_tick(account: str = "") -> int:
    """Generates at most one NEW outlook per (account, symbol, UTC hourly
    slot) that has posted EA evidence recently.

    v6.24.18 owner directive 2026-07-16 -- root-cause fix for the "6:51 PM
    publication skipped the 7:00 PM slot" incident. The OLD check asked "was
    anything published in the last 55 minutes?" -- a publication at 18:51
    answers that question "yes" all the way past 19:00, silently skipping
    the 19:00 slot entirely. The fix asks the only question that actually
    matters: "does THIS EXACT hourly slot (account+symbol+UTC hour) already
    have an outlook?" A late 18:51 publication belongs to the 18:00 slot and
    has zero bearing on whether the 19:00 slot exists.

    Also performs bounded missed-slot catch-up: if the current slot doesn't
    exist yet and the account's most recent outlook is itself more than one
    slot old (i.e. a genuine gap, not just "this is the first tick after the
    top of the hour"), the generated doc is marked late_catchup=True. Exactly
    one outlook is still produced for the CURRENT slot only -- this does not
    backfill every missed hour, and the next scheduled slot remains the next
    real wall-clock hour boundary regardless of how late this one ran."""
    db = _db()
    now = datetime.now(timezone.utc)
    current_slot = now.strftime("%Y-%m-%dT%H:00")
    cutoff = (now - timedelta(hours=2)).isoformat()
    accounts = [account] if account else await db.cloud_bot_activity.distinct("account", {"ts": {"$gte": cutoff}})
    published = 0
    for account in accounts:
        if not account:
            continue
        existing_slot = await db.cloud_market_outlooks.find_one(
            {"account": account, "symbol": OUTLOOK_SYMBOL, "hourly_slot": current_slot},
            {"_id": 0, "id": 1},
        )
        if existing_slot:
            continue  # this exact hourly slot already has an outlook for this account -- never duplicate it

        last_doc = await db.cloud_market_outlooks.find_one(
            {"account": account, "symbol": OUTLOOK_SYMBOL},
            {"_id": 0, "hourly_slot": 1}, sort=[("generated_at", -1)],
        )
        is_late_catchup = False
        if last_doc and last_doc.get("hourly_slot") and last_doc["hourly_slot"] != current_slot:
            try:
                last_slot_dt = datetime.strptime(last_doc["hourly_slot"], "%Y-%m-%dT%H:00").replace(tzinfo=timezone.utc)
                current_slot_dt = datetime.strptime(current_slot, "%Y-%m-%dT%H:00").replace(tzinfo=timezone.utc)
                is_late_catchup = (current_slot_dt - last_slot_dt) > timedelta(hours=1, minutes=5)
            except ValueError:
                is_late_catchup = False

        lic_key = ""
        row = await db.cloud_bot_activity.find_one({"account": account}, {"_id": 0, "details": 1}, sort=[("ts", -1)])
        if row:
            lic_key = (row.get("details") or {}).get("license_key", "")
        try:
            doc = await generate_outlook_for_account(lic_key, account, account_id=account, is_late_catchup=is_late_catchup)
            if doc:
                # v6.25.2 owner directive 2026-07-17 -- idempotency: only the
                # call that genuinely won the atomic insert (see
                # _insert_outlook_atomically) may count as a publication or
                # dispatch a notification. A concurrent racing call that got
                # back the OTHER worker's already-persisted document must be
                # a complete no-op here, or the exact live-evidence bug
                # (duplicate 09:00 TRANSITION, and a duplicate notification
                # with it) reproduces even with the insert itself fixed.
                newly_inserted = doc.pop("_newly_inserted", True)
                if newly_inserted:
                    published += 1
                    if is_late_catchup:
                        logger.warning(f"OUTLOOK_SLOT_LATE_CATCHUP account={account} slot={current_slot} previousSlot={last_doc.get('hourly_slot') if last_doc else None}")
                    await _dispatch_hourly_notification(doc)
                else:
                    logger.info(f"OUTLOOK_SLOT_ALREADY_PUBLISHED_BY_ANOTHER_WORKER account={account} slot={current_slot} -- no duplicate publish, no duplicate notification")
        except Exception as e:
            logger.error(f"OUTLOOK_GENERATION_FAILED account={account}: {e}")
    return published


async def repair_price_integrity_incidents(max_reasonable_price: float = 6000.0, min_reasonable_price: float = 500.0) -> int:
    """One-time (idempotent) repair for the v6.24.17 price-integrity incident:
    outlooks published with an entry zone geometrically impossible for the
    account's own current_price at publication time (root cause: the old
    fetch_live_gold_price()-only price source, including its hardcoded
    stale-price fallback -- see that function's own comment and
    generate_outlook_for_account's price_source logic above).

    Does NOT rewrite the record's original fields (owner directive: preserve
    for audit). Only adds a marker so it is excluded from stats/performance
    and visibly flagged. Safe to run repeatedly -- already-marked docs are
    skipped via the query filter.

    Call this once, manually, against the real production database
    (e.g. from a one-off admin script or shell) as part of this release's
    deployment -- it is not wired into any automatic startup/tick path."""
    db = _db()
    cursor = db.cloud_market_outlooks.find({
        "primary_direction": {"$in": ["BUY", "SELL"]},
        "data_integrity_status": {"$exists": False},
    }, {"_id": 0})
    flagged = 0
    async for doc in cursor:
        current_price = float(doc.get("current_price", 0.0) or 0.0)
        entry_low = doc.get("preferred_entry_zone_low")
        entry_high = doc.get("preferred_entry_zone_high")
        if current_price <= 0 or entry_low is None or entry_high is None:
            continue
        entry_mid = (float(entry_low) + float(entry_high)) / 2.0
        implausible_price = not (min_reasonable_price <= current_price <= max_reasonable_price)
        distance = abs(entry_mid - current_price)
        geometrically_broken = distance > max(current_price * 0.05, 50.0)
        if implausible_price or geometrically_broken:
            await db.cloud_market_outlooks.update_one(
                {"id": doc["id"]},
                {"$set": {
                    "data_integrity_status": "INVALID_DATA",
                    "data_integrity_reason": "DATA_INTEGRITY_FAILURE",
                    "data_integrity_note": (
                        f"Rejected because published price geometry (entry_mid={entry_mid}) "
                        f"did not match the live EA market snapshot (current_price={current_price}) "
                        f"at publication time. Excluded from win/loss/no-entry counts, TP rate, "
                        f"and confidence calibration. Repaired {datetime.now(timezone.utc).isoformat()}."
                    ),
                    "excluded_from_stats": True,
                }},
            )
            await _record_revision(doc["id"], "data_integrity_status", None, "INVALID_DATA",
                                   "v6.24.17 price-integrity repair: entry geometry did not match live market snapshot")
            flagged += 1
            logger.warning(f"OUTLOOK_DATA_INTEGRITY_REPAIRED id={doc['id']} current_price={current_price} entry_mid={entry_mid}")
    return flagged


# ---------------------------------------------------------------------------
# Lifecycle / outcome tracking
# ---------------------------------------------------------------------------

def _as_utc(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        for pattern in ("%Y.%m.%d %H:%M:%S", "%Y.%m.%d %H:%M"):
            try:
                return datetime.strptime(str(value), pattern).replace(tzinfo=timezone.utc)
            except (TypeError, ValueError):
                continue
        return None


def _signal_events_present(doc: Dict) -> list:
    events = ["TRACKING_STARTED"] if doc.get("tracking_entry_price") else []
    for field, event in (("first_half_r_at", "HALF_R_REACHED"), ("tp1_hit_at", "TP1_HIT"),
                         ("tp2_hit_at", "TP2_HIT"), ("tp3_hit_at", "TP3_HIT"),
                         ("sl_hit_at", "SL_HIT")):
        if doc.get(field):
            events.append(event)
    if doc.get("signal_state") == SIGNAL_LOSS_TIMEOUT:
        events.append("TIMEOUT_60M")
    return events


def advance_persisted_signal(doc: Dict, bid: Optional[float], ask: Optional[float],
                             observed_at: datetime) -> tuple:
    """Pure state-machine transition used by live monitoring and backfill.

    BUY is valued on executable Bid and SELL on executable Ask. The immutable
    tracking entry and original SL are never changed here. Returns
    (field_updates, newly_observed_events).
    """
    direction = str(doc.get("primary_direction") or "").upper()
    if direction not in ("BUY", "SELL"):
        return {}, []
    entry = float(doc.get("tracking_entry_price", 0.0) or 0.0)
    risk = float(doc.get("risk_distance", 0.0) or 0.0)
    if entry <= 0.0 or risk <= 0.0:
        return {}, []

    observed_at = _as_utc(observed_at) or datetime.now(timezone.utc)
    observed_iso = observed_at.isoformat()
    deadline = _as_utc(doc.get("evaluation_deadline"))
    expiry = _as_utc(doc.get("expiry_at"))
    outcome = doc.get("analytics_outcome")
    updates: Dict[str, Any] = {"last_monitored_at": observed_iso}
    events = []
    milestones = list(doc.get("milestones_hit") or [])
    event_snapshots = dict(doc.get("event_snapshots") or {})
    snapshots_changed = False

    close_price = None
    if direction == "BUY" and bid is not None and float(bid) > 0.0:
        close_price = float(bid)
    elif direction == "SELL" and ask is not None and float(ask) > 0.0:
        close_price = float(ask)

    current_r = float(doc.get("current_r", 0.0) or 0.0)
    prior_current_r = current_r
    mfe_r = float(doc.get("mfe_r", doc.get("mfe", 0.0)) or 0.0)
    mae_r = float(doc.get("mae_r", doc.get("mae", 0.0)) or 0.0)
    tp1_hit = bool(doc.get("tp1_hit_at"))
    tp2_hit = bool(doc.get("tp2_hit_at"))
    tp3_hit = bool(doc.get("tp3_hit_at"))
    sl_hit = bool(doc.get("sl_hit_at"))
    half_hit = bool(doc.get("first_half_r_at"))

    def record_event(event: str, event_at: str, hit_price: Optional[float], achieved_r: Optional[float]) -> None:
        nonlocal snapshots_changed
        events.append(event)
        event_snapshots[event] = {
            "event_at": event_at,
            "hit_price": round(float(hit_price), 6) if hit_price is not None else None,
            "achieved_r": round(float(achieved_r), 6) if achieved_r is not None else None,
        }
        snapshots_changed = True

    if close_price is not None:
        current_r = ((close_price - entry) / risk) if direction == "BUY" else ((entry - close_price) / risk)
        mfe_r = max(mfe_r, current_r)
        mae_r = min(mae_r, current_r, 0.0)
        updates.update({
            "current_r": round(current_r, 6), "mfe_r": round(mfe_r, 6), "mae_r": round(mae_r, 6),
            "mfe": round(mfe_r, 6), "mae": round(mae_r, 6),
            "highest_tracked_price": max(float(doc.get("highest_tracked_price", entry) or entry), close_price),
            "lowest_tracked_price": min(float(doc.get("lowest_tracked_price", entry) or entry), close_price),
            "last_bid": float(bid) if bid is not None else None,
            "last_ask": float(ask) if ask is not None else None,
            "last_tracked_price": close_price,
        })

        tp1 = float(doc.get("tp1_price", 0.0) or 0.0)
        tp2 = float(doc.get("tp2_price", 0.0) or 0.0)
        tp3 = float(doc.get("tp3_price", 0.0) or 0.0)
        sl = float(doc.get("original_sl", doc.get("suggested_sl", 0.0)) or 0.0)
        targets_valid = _targets_have_valid_geometry(direction, entry, tp1, tp2, tp3)
        reached = (lambda target: close_price >= target) if direction == "BUY" else (lambda target: close_price <= target)
        hit_sl_now = sl > 0.0 and ((direction == "BUY" and close_price <= sl) or (direction == "SELL" and close_price >= sl))

        if current_r >= HALF_R_WIN_THRESHOLD and not half_hit:
            half_hit = True
            updates["first_half_r_at"] = observed_iso
            record_event("HALF_R_REACHED", observed_iso, close_price, current_r)
            if "HALF_R_REACHED" not in milestones:
                milestones.append("HALF_R_REACHED")
        for target, field, event, number in ((tp1, "tp1_hit_at", "TP1_HIT", 1),
                                              (tp2, "tp2_hit_at", "TP2_HIT", 2),
                                              (tp3, "tp3_hit_at", "TP3_HIT", 3)):
            already = bool(doc.get(field)) or bool(updates.get(field))
            if targets_valid and reached(target) and not already:
                updates[field] = observed_iso
                record_event(event, observed_iso, close_price, current_r)
                if event not in milestones:
                    milestones.append(event)
                updates["highest_tp_reached"] = max(int(doc.get("highest_tp_reached") or 0), number)
                if number == 1: tp1_hit = True
                elif number == 2: tp2_hit = True
                else: tp3_hit = True
        if hit_sl_now and not sl_hit:
            sl_hit = True
            updates["sl_hit_at"] = observed_iso
            record_event("SL_HIT", observed_iso, close_price, current_r)
            if "SL_HIT" not in milestones:
                milestones.append("SL_HIT")

    # Classification is immutable. A target observed exactly at the deadline
    # is still within the 60-minute window. A price event strictly after the
    # deadline cannot replace the timeout classification.
    new_state = doc.get("signal_state") or SIGNAL_TRACKING
    latest_path = doc.get("latest_path_event") or "TRACKING_STARTED"
    classification_at = doc.get("classification_at")
    analytics_r = doc.get("analytics_r")
    half_at = _as_utc(updates.get("first_half_r_at") or doc.get("first_half_r_at"))
    tp1_at = _as_utc(updates.get("tp1_hit_at") or doc.get("tp1_hit_at"))
    sl_at = _as_utc(updates.get("sl_hit_at") or doc.get("sl_hit_at"))
    half_on_time = bool(half_at and (not deadline or half_at <= deadline))
    tp1_on_time = bool(tp1_at and (not deadline or tp1_at <= deadline))
    sl_on_time = bool(sl_at and (not deadline or sl_at <= deadline))
    timeout_classified_now = False
    if outcome is None:
        if sl_on_time:
            outcome, new_state, latest_path = ANALYTICS_LOSS, SIGNAL_LOSS_SL, "SL_HIT_BEFORE_WIN"
            classification_at, analytics_r = updates.get("sl_hit_at") or doc.get("sl_hit_at") or observed_iso, -1.0
        elif tp1_on_time:
            outcome, new_state, latest_path = ANALYTICS_WIN, SIGNAL_WIN_TP1, "TP1_HIT"
            classification_at = updates.get("tp1_hit_at") or doc.get("tp1_hit_at") or observed_iso
            # TP1 may sit closer than +0.50R. Its analytics value must still
            # use the executable tracking anchor, never the suggested-zone R.
            analytics_r = round(current_r, 6)
        elif half_on_time:
            outcome, new_state, latest_path = ANALYTICS_WIN, SIGNAL_WIN_HALF_R, "HALF_R_REACHED"
            classification_at = updates.get("first_half_r_at") or doc.get("first_half_r_at") or observed_iso
            analytics_r = HALF_R_WIN_THRESHOLD
        elif deadline and observed_at >= deadline:
            outcome, new_state, latest_path = ANALYTICS_LOSS, SIGNAL_LOSS_TIMEOUT, "FAILED_HALF_R_60M"
            classification_at = deadline.isoformat()
            analytics_r = round(current_r if observed_at <= deadline else prior_current_r, 6)
            timeout_classified_now = True
            if "TIMEOUT_60M" not in milestones:
                milestones.append("TIMEOUT_60M")
            timeout_price = (
                updates.get("last_tracked_price", doc.get("last_tracked_price"))
                if observed_at <= deadline else doc.get("last_tracked_price")
            )
            record_event(
                "TIMEOUT_60M", deadline.isoformat(), timeout_price, analytics_r,
            )
        elif sl_hit:
            # Only reachable for records without a deadline.
            outcome, new_state, latest_path = ANALYTICS_LOSS, SIGNAL_LOSS_SL, "SL_HIT_BEFORE_WIN"
            classification_at, analytics_r = updates.get("sl_hit_at") or doc.get("sl_hit_at") or observed_iso, -1.0
    elif outcome == ANALYTICS_WIN:
        # A later SL is the terminal path event for a signal that already
        # qualified as a win. Keep that truthful metadata stable on repeated
        # quotes instead of allowing an earlier TP milestone to overwrite it.
        if sl_hit:
            latest_path = "LATER_SL_AFTER_WIN"
        elif tp3_hit:
            latest_path = "TP3_HIT"
        elif tp2_hit:
            latest_path = "TP2_HIT"
        elif tp1_hit:
            latest_path = "TP1_HIT"
    elif outcome == ANALYTICS_LOSS and doc.get("signal_state") == SIGNAL_LOSS_TIMEOUT:
        if tp3_hit and not doc.get("tp3_hit_at"):
            latest_path = "LATE_TP3_AFTER_60M"
        elif tp2_hit and not doc.get("tp2_hit_at"):
            latest_path = "LATE_TP2_AFTER_60M"
        elif tp1_hit and not doc.get("tp1_hit_at"):
            latest_path = "LATE_TP1_AFTER_60M"
        elif half_hit and not doc.get("first_half_r_at"):
            latest_path = "LATE_HALF_R_AFTER_60M"

    if timeout_classified_now:
        if sl_hit and not sl_on_time:
            latest_path = "LATE_SL_AFTER_60M"
        elif tp3_hit and not doc.get("tp3_hit_at"):
            latest_path = "LATE_TP3_AFTER_60M"
        elif tp2_hit and not doc.get("tp2_hit_at"):
            latest_path = "LATE_TP2_AFTER_60M"
        elif tp1_hit and not tp1_on_time:
            latest_path = "LATE_TP1_AFTER_60M"
        elif half_hit and not half_on_time:
            latest_path = "LATE_HALF_R_AFTER_60M"

    updates.update({
        "signal_state": new_state,
        "analytics_outcome": outcome,
        "analytics_r": analytics_r,
        "final_result": new_state if outcome else None,
        "final_r": analytics_r if outcome else None,
        "classification_at": classification_at,
        "resolved_at": classification_at,
        "latest_path_event": latest_path,
        "status": "TRACKING" if outcome is None else latest_path,
        "color_state": "GREEN" if outcome == ANALYTICS_WIN else "RED" if outcome == ANALYTICS_LOSS else "AMBER",
        "milestones_hit": milestones,
    })
    if snapshots_changed:
        updates["event_snapshots"] = event_snapshots
    monitoring_closed = bool(doc.get("monitoring_closed"))
    if new_state == SIGNAL_LOSS_SL or sl_hit or (expiry and observed_at >= expiry):
        monitoring_closed = True
    updates["monitoring_closed"] = monitoring_closed
    return updates, list(dict.fromkeys(events))


async def _account_quotes_since(account: str, since: datetime, until: datetime) -> list:
    """Returns persisted account quotes in event order for restart replay."""
    if not account:
        return []
    rows = await _db().cloud_bot_activity.find({
        "account": account,
        "ts": {"$gt": since.isoformat(), "$lte": until.isoformat()},
        "details.market_thesis.live_bid": {"$gt": 0},
        "details.market_thesis.live_ask": {"$gt": 0},
    }, {"_id": 0, "ts": 1, "details.market_thesis.live_bid": 1, "details.market_thesis.live_ask": 1},
    ).sort("ts", 1).to_list(5000)
    quotes = []
    for row in rows:
        thesis = ((row or {}).get("details") or {}).get("market_thesis") or {}
        quote_time = _as_utc(row.get("ts"))
        quote_bid = thesis.get("live_bid")
        quote_ask = thesis.get("live_ask")
        if quote_time and quote_bid and quote_ask and float(quote_ask) >= float(quote_bid):
            quotes.append((float(quote_bid), float(quote_ask), quote_time))
    return quotes


async def track_outlook_lifecycle_tick(account: str = "", bid: Optional[float] = None,
                                       ask: Optional[float] = None, quote_at: Any = None,
                                       now: Optional[datetime] = None) -> int:
    """Restart-safe persisted signal monitor.

    The activity endpoint can pass a fresh account-specific broker quote for
    event-driven updates. The background loop calls this without arguments
    and resumes every open persisted signal, including deadline processing
    when no fresh quote is temporarily available.
    """
    db = _db()
    wall_now = _as_utc(now) or datetime.now(timezone.utc)
    query: Dict[str, Any] = {
        "primary_direction": {"$in": ["BUY", "SELL"]},
        "tracking_entry_price": {"$gt": 0},
        "monitoring_closed": {"$ne": True},
    }
    if account:
        query["account"] = account
    docs = db.cloud_market_outlooks.find(query, {"_id": 0})
    updated_count = 0
    async for initial_doc in docs:
        doc = initial_doc
        committed = None
        # Optimistic compare-and-set prevents two simultaneous EA activity
        # requests from allowing an older quote to overwrite a newer state.
        # On contention, recompute from the newly persisted checkpoint.
        for _attempt in range(3):
            doc_account = str(doc.get("account") or "")
            last_monitored = (_as_utc(doc.get("last_monitored_at"))
                              or _as_utc(doc.get("published_quote_at"))
                              or _as_utc(doc.get("published_at"))
                              or wall_now)
            if account:
                observed = _as_utc(quote_at) or wall_now
                quote_journey = [(bid, ask, observed)] if observed > last_monitored else []
            else:
                # Replay every safely persisted quote after a restart/deployment.
                # Looking at only the newest quote could erase an earlier TP/MFE
                # excursion when price had already reversed by the next poll.
                quote_journey = await _account_quotes_since(doc_account, last_monitored, wall_now)

            price_updates: Dict[str, Any] = {}
            events = []
            merged = dict(doc)
            for doc_bid, doc_ask, observed in quote_journey:
                deadline = _as_utc(merged.get("evaluation_deadline"))
                if deadline and observed > deadline and merged.get("analytics_outcome") is None:
                    timeout_updates, timeout_events = advance_persisted_signal(merged, None, None, deadline)
                    price_updates.update(timeout_updates)
                    events.extend(timeout_events)
                    merged.update(timeout_updates)
                quote_updates, quote_events = advance_persisted_signal(merged, doc_bid, doc_ask, observed)
                price_updates.update(quote_updates)
                events.extend(quote_events)
                merged.update(quote_updates)
            deadline = _as_utc(merged.get("evaluation_deadline"))
            if deadline and wall_now >= deadline and merged.get("analytics_outcome") is None:
                timeout_updates, timeout_events = advance_persisted_signal(merged, None, None, deadline)
                price_updates.update(timeout_updates)
                events.extend(timeout_events)
                merged.update(timeout_updates)
            changed = any(doc.get(key) != value for key, value in price_updates.items())
            if not changed:
                committed = (merged, [])
                break

            result = await db.cloud_market_outlooks.update_one(
                {"id": doc["id"], "last_monitored_at": doc.get("last_monitored_at")},
                {"$set": price_updates},
            )
            if result.modified_count:
                if doc.get("analytics_outcome") != merged.get("analytics_outcome"):
                    await _record_revision(
                        doc["id"], "analytics_outcome", doc.get("analytics_outcome"),
                        merged.get("analytics_outcome"), merged.get("latest_path_event", "signal classified"),
                    )
                if merged.get("analytics_outcome") in (ANALYTICS_WIN, ANALYTICS_LOSS):
                    await _persist_signal_outcome(merged)
                updated_count += 1
                committed = (merged, list(dict.fromkeys(events)))
                break
            fresh = await db.cloud_market_outlooks.find_one({"id": doc["id"]}, {"_id": 0})
            if not fresh or fresh.get("monitoring_closed"):
                break
            doc = fresh

        if committed:
            merged, committed_events = committed
            for event in committed_events:
                await _dispatch_signal_event(merged, event)
    # The account-specific path already dispatches every newly persisted
    # event above.  Only the background/restart pass needs to scan for the
    # narrow state-write/send crash gap; doing that scan on every EA quote
    # would add unnecessary database work to the live telemetry endpoint.
    if not account:
        await dispatch_pending_signal_notifications()
        try:
            from notifications import dispatch_pending_trade_notifications
            await dispatch_pending_trade_notifications()
        except Exception as exc:
            logger.warning("PENDING_TRADE_NOTIFICATION_RETRY_FAILED: %s", exc)
    return updated_count


async def _record_revision(outlook_id: str, field: str, previous_value: Any, new_value: Any, reason: str) -> None:
    db = _db()
    await db.cloud_market_outlook_revisions.insert_one({
        "id": str(uuid.uuid4()),
        "outlook_id": outlook_id,
        "revision_time": datetime.now(timezone.utc).isoformat(),
        "field": field,
        "previous_value": previous_value,
        "new_value": new_value,
        "reason": reason,
    })


async def _persist_signal_outcome(doc: Dict) -> None:
    if doc.get("analytics_outcome") not in (ANALYTICS_WIN, ANALYTICS_LOSS):
        return
    outcome_doc = {
        "outlook_id": doc["id"], "account": doc.get("account"),
        "analytics_outcome": doc.get("analytics_outcome"), "analytics_r": doc.get("analytics_r"),
        "signal_state": doc.get("signal_state"), "classification_at": doc.get("classification_at"),
        "tracking_entry_price": doc.get("tracking_entry_price"), "original_sl": doc.get("original_sl"),
        "risk_distance": doc.get("risk_distance"), "mfe_r": doc.get("mfe_r"), "mae_r": doc.get("mae_r"),
        "highest_tp_reached": doc.get("highest_tp_reached"), "confidence_pct": doc.get("confidence_pct"),
        "primary_direction": doc.get("primary_direction"), "setup_type": doc.get("setup_type"),
        "expected_path": doc.get("expected_path"), "session": doc.get("session"),
        "current_r": doc.get("current_r"), "latest_path_event": doc.get("latest_path_event"),
        "first_half_r_at": doc.get("first_half_r_at"), "tp1_hit_at": doc.get("tp1_hit_at"),
        "tp2_hit_at": doc.get("tp2_hit_at"), "tp3_hit_at": doc.get("tp3_hit_at"),
        "sl_hit_at": doc.get("sl_hit_at"),
        "event_snapshots": doc.get("event_snapshots") or {},
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await _db().cloud_market_outlook_outcomes.update_one(
        {"outlook_id": doc["id"]}, {"$set": outcome_doc, "$setOnInsert": {"id": str(uuid.uuid4())}}, upsert=True)


async def _dispatch_signal_event(doc: Dict, event: str) -> None:
    flag = (doc.get("notification_flags") or {}).get(event)
    if flag:
        return
    from notifications import RETRYABLE_FAILURES, send_outlook_notification
    dispatch_result = await send_outlook_notification(doc, event=event, min_tier="HOURLY_PLUS_RESULTS")
    if dispatch_result is None:
        return
    # Do not close the persisted retry gap while any eligible recipient has
    # a transient/configuration failure. Sent/no-device results are terminal;
    # credentials or payload errors remain pending so a settings correction
    # or later deployment can recover them. The OneSignal provider
    # idempotency key protects a recipient that succeeded while another
    # recipient still needs a retry.
    retryable = await _db().cloud_notification_log.find_one({
        "outlook_id": doc["id"],
        "notification_type": event,
        "failure_reason": {"$in": list(RETRYABLE_FAILURES)},
    })
    if not retryable:
        await _db().cloud_market_outlooks.update_one(
            {"id": doc["id"]},
            {"$set": {f"notification_flags.{event}": datetime.now(timezone.utc).isoformat()}},
        )


async def dispatch_pending_signal_notifications() -> int:
    """Closes the state-write/send crash gap after restarts.

    Provider calls are themselves idempotent by outlook+event+user, so it is
    safe to retry any persisted event whose document flag was not committed.
    """
    db = _db()
    # Query only records that actually have at least one persisted event
    # without its completion flag. Scanning the entire lifetime history on
    # every one-minute recovery pass would grow linearly forever.
    pending_event_conditions = [
        {"notification_flags.TRACKING_STARTED": {"$exists": False}},
        {"first_half_r_at": {"$ne": None}, "notification_flags.HALF_R_REACHED": {"$exists": False}},
        {"tp1_hit_at": {"$ne": None}, "notification_flags.TP1_HIT": {"$exists": False}},
        {"tp2_hit_at": {"$ne": None}, "notification_flags.TP2_HIT": {"$exists": False}},
        {"tp3_hit_at": {"$ne": None}, "notification_flags.TP3_HIT": {"$exists": False}},
        {"sl_hit_at": {"$ne": None}, "notification_flags.SL_HIT": {"$exists": False}},
        {"signal_state": SIGNAL_LOSS_TIMEOUT, "notification_flags.TIMEOUT_60M": {"$exists": False}},
    ]
    rows = db.cloud_market_outlooks.find({
        "tracking_entry_price": {"$gt": 0}, "$or": pending_event_conditions,
    }, {"_id": 0}).sort("published_at", -1)
    dispatched = 0
    async for doc in rows:
        for event in _signal_events_present(doc):
            if not (doc.get("notification_flags") or {}).get(event):
                await _dispatch_signal_event(doc, event)
                dispatched += 1
    return dispatched


def _quote_from_activity(row: Dict) -> tuple:
    thesis = ((row.get("details") or {}).get("market_thesis") or {})
    bid = float(thesis.get("live_bid", 0.0) or 0.0)
    ask = float(thesis.get("live_ask", 0.0) or 0.0)
    return (bid, ask) if bid > 0.0 and ask >= bid else (None, None)


async def backfill_signal_outlook_history(limit: int = 500) -> Dict[str, int]:
    """Idempotently reconstruct legacy BUY/SELL history from stored EA quotes.

    A timeout is only reconstructed when quote coverage spans the complete
    60-minute window at near-tick density. Sparse or missing data is marked
    unavailable and excluded; absence of a sampled target is never invented
    into a loss.
    """
    db = _db()
    now = datetime.now(timezone.utc)
    repair_run_id = str(uuid.uuid4())
    legacy = await db.cloud_market_outlooks.find({
        "primary_direction": {"$in": ["BUY", "SELL"]},
        "signal_tracking_version": {"$ne": 2},
    }, {"_id": 0}).sort("generated_at", 1).to_list(limit)
    report = {"examined": len(legacy), "reconstructed": 0, "wins": 0, "losses": 0,
              "active": 0, "unavailable": 0}
    for old in legacy:
        published = _as_utc(old.get("published_at") or old.get("generated_at"))
        sl = float(old.get("original_sl", old.get("suggested_sl", 0.0)) or 0.0)
        account = str(old.get("account") or "")
        if not published or not account or sl <= 0.0:
            await _mark_history_unavailable(old, "missing publication timestamp, account, or original SL")
            report["unavailable"] += 1
            continue
        deadline = published + timedelta(minutes=OUTLOOK_EVALUATION_MINUTES)
        end = min(now, published + timedelta(hours=OUTLOOK_HORIZON_HOURS))
        rows = await db.cloud_bot_activity.find({
            "account": account,
            "ts": {"$gte": (published - timedelta(minutes=2)).isoformat(), "$lte": end.isoformat()},
            "details.market_thesis.live_bid": {"$gt": 0},
            "details.market_thesis.live_ask": {"$gt": 0},
        }, {"_id": 0, "ts": 1, "details.market_thesis.live_bid": 1,
            "details.market_thesis.live_ask": 1}).sort("ts", 1).to_list(5000)
        usable = [(row, _as_utc(row.get("ts"))) for row in rows]
        usable = [(row, ts) for row, ts in usable if ts and all(v is not None for v in _quote_from_activity(row))]
        if not usable:
            await _mark_history_unavailable(old, "no stored broker Bid/Ask history")
            report["unavailable"] += 1
            continue
        anchor_candidates = [(row, ts) for row, ts in usable if ts <= published]
        if not anchor_candidates:
            await _mark_history_unavailable(old, "no stored executable quote at or before publication")
            report["unavailable"] += 1
            continue
        anchor_row, anchor_at = max(anchor_candidates, key=lambda item: item[1])
        if (published - anchor_at).total_seconds() > MAX_HISTORICAL_ANCHOR_AGE_SECONDS:
            await _mark_history_unavailable(old, "no reliable publication quote within 90 seconds before publication")
            report["unavailable"] += 1
            continue
        anchor_bid, anchor_ask = _quote_from_activity(anchor_row)
        direction = old["primary_direction"]
        tracking_anchor = _build_tracking_anchor(direction, anchor_bid, anchor_ask, sl)
        if not tracking_anchor:
            await _mark_history_unavailable(old, "publication quote and original SL have invalid directional geometry")
            report["unavailable"] += 1
            continue
        if not _targets_have_valid_geometry(
            direction, tracking_anchor["tracking_entry_price"],
            old.get("tp1_price"), old.get("tp2_price"), old.get("tp3_price"),
        ):
            await _mark_history_unavailable(old, "published TP ladder has invalid directional geometry")
            report["unavailable"] += 1
            continue
        entry = tracking_anchor["tracking_entry_price"]
        risk = tracking_anchor["risk_distance"]

        working = {**old,
            "published_at": published.isoformat(), "published_bid": anchor_bid, "published_ask": anchor_ask,
            "published_spread": anchor_ask - anchor_bid, "published_quote_at": anchor_at.isoformat(),
            "tracking_entry_price": entry, "original_sl": sl, "risk_distance": risk,
            "evaluation_deadline": deadline.isoformat(), "signal_tracking_version": 2,
            "signal_state": SIGNAL_TRACKING, "analytics_outcome": None, "analytics_r": None,
            "current_r": tracking_anchor["current_r"],
            "mfe_r": tracking_anchor["mfe_r"], "mae_r": tracking_anchor["mae_r"],
            "mfe": tracking_anchor["mfe_r"], "mae": tracking_anchor["mae_r"],
            "highest_tracked_price": tracking_anchor["highest_tracked_price"],
            "lowest_tracked_price": tracking_anchor["lowest_tracked_price"],
            "last_bid": tracking_anchor["last_bid"], "last_ask": tracking_anchor["last_ask"],
            "last_tracked_price": tracking_anchor["last_tracked_price"],
            "last_monitored_at": anchor_at.isoformat(),
            "first_half_r_at": None, "tp1_hit_at": None, "tp2_hit_at": None,
            "tp3_hit_at": None, "sl_hit_at": None, "classification_at": None,
            "latest_path_event": "TRACKING_STARTED", "monitoring_closed": False,
            "color_state": "AMBER", "status": "TRACKING", "milestones_hit": [],
            "event_snapshots": {"TRACKING_STARTED": {
                "event_at": published.isoformat(), "hit_price": entry,
                "achieved_r": tracking_anchor["current_r"],
            }},
            "final_result": None, "final_r": None, "resolved_at": None,
            "legacy_result_before_repair": old.get("final_result"),
            "activation": {"activated": True, "activated_at": published.isoformat(), "activated_price": entry},
            "excluded_from_signal_analytics": False,
        }
        in_window = [(row, ts) for row, ts in usable if published <= ts <= deadline]
        coverage_reliable = False
        if in_window and deadline <= now:
            times = [ts for _, ts in in_window]
            max_gap = max(((b - a).total_seconds() for a, b in zip(times, times[1:])), default=0.0)
            coverage_reliable = (times[0] <= published + timedelta(seconds=MAX_HISTORICAL_QUOTE_GAP_SECONDS)
                                 and times[-1] >= deadline - timedelta(seconds=MAX_HISTORICAL_QUOTE_GAP_SECONDS)
                                 and max_gap <= MAX_HISTORICAL_QUOTE_GAP_SECONDS)

        repair_unavailable = False
        # Replay the complete path in order. If the first post-deadline quote
        # arrives before a classification, commit the timeout at the exact
        # deadline first; later events remain path metadata only.
        for row, ts in usable:
            if ts < published or ts > end:
                continue
            if ts > deadline and working.get("analytics_outcome") is None:
                if not coverage_reliable:
                    await _mark_history_unavailable(old, "stored quotes do not reliably cover the full 60-minute window")
                    report["unavailable"] += 1
                    repair_unavailable = True
                    break
                update, _ = advance_persisted_signal(working, None, None, deadline)
                working.update(update)
            q_bid, q_ask = _quote_from_activity(row)
            update, _ = advance_persisted_signal(working, q_bid, q_ask, ts)
            working.update(update)
            if working.get("signal_state") == SIGNAL_LOSS_TIMEOUT and not coverage_reliable:
                await _mark_history_unavailable(old, "stored quotes do not reliably cover the full 60-minute window")
                report["unavailable"] += 1
                repair_unavailable = True
                break
            if working.get("monitoring_closed"):
                break
        if repair_unavailable:
            continue
        if deadline <= now and working.get("analytics_outcome") is None:
            if not coverage_reliable:
                await _mark_history_unavailable(old, "stored quotes do not reliably cover the full 60-minute window")
                report["unavailable"] += 1
                continue
            update, _ = advance_persisted_signal(working, None, None, deadline)
            working.update(update)

        historical_flags = {event: "BACKFILL_SUPPRESSED" for event in _signal_events_present(working)}
        working.update({"historical_repair_status": "RECONSTRUCTED", "historical_repaired_at": now.isoformat(),
                        "notification_flags": historical_flags})
        persist = {k: v for k, v in working.items() if k != "_id"}
        await db.cloud_market_outlooks.update_one({"id": old["id"]}, {"$set": persist})
        await _record_revision(old["id"], "final_result", old.get("final_result"), working.get("final_result"),
                               "v2 signal lifecycle reconstructed from persisted broker quotes")
        await _persist_signal_outcome(working)
        report["reconstructed"] += 1
        if working.get("analytics_outcome") == ANALYTICS_WIN: report["wins"] += 1
        elif working.get("analytics_outcome") == ANALYTICS_LOSS: report["losses"] += 1
        else: report["active"] += 1
    await db.cloud_market_outlook_repair_runs.insert_one({
        "id": repair_run_id,
        "started_at": now.isoformat(),
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "tracking_version": 2,
        "report": report,
    })
    return report


async def _mark_history_unavailable(doc: Dict, reason: str) -> None:
    update = {
        "signal_tracking_version": 2,
        "signal_state": ANALYTICS_UNAVAILABLE,
        "historical_repair_status": ANALYTICS_UNAVAILABLE,
        "historical_data_unavailable_reason": reason,
        "analytics_outcome": ANALYTICS_UNAVAILABLE,
        "analytics_r": None, "final_r": None,
        "final_result": ANALYTICS_UNAVAILABLE,
        "color_state": "GRAY", "status": ANALYTICS_UNAVAILABLE,
        "excluded_from_signal_analytics": True,
        "legacy_result_before_repair": doc.get("final_result"),
        "historical_repaired_at": datetime.now(timezone.utc).isoformat(),
        "monitoring_closed": True,
    }
    await _db().cloud_market_outlooks.update_one({"id": doc["id"]}, {"$set": update})
    await _record_revision(doc["id"], "final_result", doc.get("final_result"), ANALYTICS_UNAVAILABLE,
                           f"historical signal excluded: {reason}")


# ---------------------------------------------------------------------------
# Notification dispatch (delegates actual push sending to notifications.py)
# ---------------------------------------------------------------------------

async def _dispatch_hourly_notification(doc: Dict) -> None:
    if doc.get("primary_direction") in ("BUY", "SELL") and doc.get("tracking_entry_price"):
        await _dispatch_signal_event(doc, "TRACKING_STARTED")
    else:
        # Hourly context is advisory. Neutral/missing-data heartbeats are
        # intentionally visible in the API but can never masquerade as a
        # confirmed signal notification.
        logger.info("OUTLOOK_NOTIFICATION_SUPPRESSED id=%s reason=ADVISORY_ONLY", doc.get("id"))
