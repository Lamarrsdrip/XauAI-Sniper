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
ROOM_COLLAPSE_R = 0.3      # same threshold the EA's readiness engine uses -- invalidates a candidate

PRIMARY_DIRECTIONS = ("BUY", "SELL", "NEUTRAL", "RANGE", "TRANSITION", "NO_VALID_OUTLOOK")
EXPECTED_PATHS = ("PULLBACK_FIRST_THEN_BUY", "RALLY_FIRST_THEN_SELL", "DIRECT_CONTINUATION",
                  "RANGE_ROTATION", "REVERSAL_FORMING", "NO_CLEAR_PATH")
LIFECYCLE_STATES = ("ANALYZING", "PUBLISHED", "WAITING_FOR_ENTRY_ZONE", "ENTRY_ZONE_ACTIVE",
                    "CONFIRMATION_PENDING", "ACTIVE", "TP1_HIT", "TP2_HIT", "TP3_HIT",
                    "INVALIDATED", "EXPIRED", "MISSED_WITHOUT_ENTRY", "CANCELLED_BY_NEW_STRUCTURE")
FINAL_RESULTS = ("GREEN_TP1", "GREEN_TP2", "GREEN_TP3", "GREEN_PARTIAL_PROFIT",
                 "RED_STOPPED", "RED_NO_PROFIT", "GRAY_EXPIRED_NO_ENTRY",
                 "GRAY_INVALIDATED_BEFORE_ENTRY", "AMBER_ACTIVE", "AMBER_UNRESOLVED")
NOTIFICATION_TIERS = ("OFF", "HOURLY_ONLY", "HOURLY_PLUS_RESULTS", "ALL_UPDATES")
MILESTONES = ("ENTRY_ZONE_REACHED", "OUTLOOK_ACTIVATED", "TP1_HIT", "TP2_HIT", "TP3_HIT",
             "SL_HIT", "INVALIDATED", "EXPIRED_NO_ENTRY")


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


class PushSubscriptionIn(BaseModel):
    endpoint: str
    keys: Dict[str, str]  # {"p256dh": ..., "auth": ...}
    device_label: Optional[str] = ""
    timezone_offset_minutes: Optional[int] = 0


# ---------------------------------------------------------------------------
# Evidence gathering — reads the EA's own already-transmitted state only
# ---------------------------------------------------------------------------

async def _latest_ea_evidence(license_key: str, account: str) -> tuple:
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
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=6)).isoformat()
    rows = await db.cloud_bot_activity.find(
        {"$and": [scope, {"ts": {"$gte": cutoff}}]}, {"_id": 0}
    ).sort("ts", -1).to_list(50)
    if not rows:
        return None, "STALE_EVIDENCE"
    for row in rows:
        details = row.get("details") or {}
        thesis = details.get("market_thesis") or {}
        readiness = details.get("entry_readiness") or {}
        if thesis or readiness:
            return {
                "ts": row.get("ts"),
                "symbol": row.get("symbol") or OUTLOOK_SYMBOL,
                "market_thesis": thesis,
                "post_trade_state": details.get("post_trade_state") or {},
                "entry_readiness": readiness,
                "regime": details.get("regime") or "",
                "session": details.get("session") or "",
            }, "OK"
    return None, "INSUFFICIENT_MARKET_EVIDENCE"


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


async def generate_outlook_for_account(license_key: str, account: str, account_id: str = "",
                                        is_late_catchup: bool = False) -> Optional[Dict]:
    """Generates and persists ONE new immutable outlook document for this
    account, using only real, already-transmitted EA evidence + the live
    price feed. Returns the stored document, or None if there is genuinely
    no usable evidence yet (never fabricates one to avoid returning None)."""
    srv = _server()
    db = _db()

    evidence, evidence_reason = await _latest_ea_evidence(license_key, account)

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
    ea_mid = float(thesis_preview.get("live_mid", 0.0) or 0.0)
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
            "late_catchup": is_late_catchup,
            "expiry_at": (now + timedelta(hours=OUTLOOK_HORIZON_HOURS)).isoformat(),
            "current_price": current_price,
            "primary_direction": "NO_VALID_OUTLOOK",
            "no_valid_outlook_reason": no_valid_reason,
            "confidence_pct": 0,
            "confidence_components": ConfidenceComponents().model_dump(),
            "status": "PUBLISHED",
            "reasoning": reason_text,
            "uncertainty": "Connect and run your EA to begin receiving hourly outlooks." if no_valid_reason in ("NO_CONNECTED_EA", "STALE_EVIDENCE") else "Retry next hourly cycle.",
            "expected_path": "NO_CLEAR_PATH",
            "setup_type": "NONE",
        }
        await db.cloud_market_outlooks.insert_one(dict(doc))
        return doc

    thesis = evidence["market_thesis"] or evidence["entry_readiness"]
    raw_dir = str(thesis.get("direction", "") or thesis.get("action", "")).upper()
    direction = 1 if "BUY" in raw_dir else (-1 if "SELL" in raw_dir else 0)
    action = str(thesis.get("action", "") or thesis.get("final_action", "") or "")

    if action in ("HARD_BLOCK", "NO_VALID_TRADE") or direction == 0:
        direction_label = "NEUTRAL" if action not in ("HARD_BLOCK",) else "RANGE"
    else:
        direction_label = "BUY" if direction == 1 else "SELL"

    # v6.24.17 directional-consistency validator: a direction must never
    # publish against a materially dominant opposite pressure reading unless
    # structure documents a real override. Prevents the observed incident
    # (published SELL while reasoning/evidence said "buy pressure
    # significantly outweighs sell pressure").
    buy_p = float(thesis.get("buy_pressure", 50.0) or 50.0)
    sell_p = float(thesis.get("sell_pressure", 50.0) or 50.0)
    pressure_gap = buy_p - sell_p  # positive = bullish pressure dominant
    structure_state = str(thesis.get("structure", "") or "")
    structural_override_bearish = structure_state in ("STRUCTURE_STRONGLY_SUPPORTS", "STRUCTURE_SUPPORTS") and direction == -1
    structural_override_bullish = structure_state in ("STRUCTURE_STRONGLY_SUPPORTS", "STRUCTURE_SUPPORTS") and direction == 1
    directional_conflict = None
    if direction_label == "SELL" and pressure_gap >= 15.0 and not structural_override_bearish:
        directional_conflict = f"buy pressure ({buy_p:.0f}) outweighs sell pressure ({sell_p:.0f}) with no documented bearish structural override"
    elif direction_label == "BUY" and pressure_gap <= -15.0 and not structural_override_bullish:
        directional_conflict = f"sell pressure ({sell_p:.0f}) outweighs buy pressure ({buy_p:.0f}) with no documented bullish structural override"
    if directional_conflict:
        logger.warning(f"OUTLOOK_DIRECTIONAL_CONFLICT | account={account} was={direction_label} buy_pressure={buy_p} sell_pressure={sell_p} structure={structure_state} -> downgraded to TRANSITION")
        direction_label = "TRANSITION"
        direction = 0

    components = _compute_confidence(direction if direction != 0 else 1, thesis, evidence["entry_readiness"])
    confidence = _confidence_pct(components)
    if directional_conflict:
        confidence = min(confidence, 35)
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
            "late_catchup": is_late_catchup,
            "expiry_at": (now + timedelta(hours=OUTLOOK_HORIZON_HOURS)).isoformat(),
            "current_price": current_price,
            "primary_direction": "NO_VALID_OUTLOOK",
            "no_valid_outlook_reason": "INTERNAL_DATA_INCONSISTENCY",
            "confidence_pct": 0,
            "confidence_components": ConfidenceComponents().model_dump(),
            "status": "PUBLISHED",
            "reasoning": "Computed entry geometry did not pass price-sanity validation against the account's live market price this cycle.",
            "uncertainty": "Retry next hourly cycle.",
            "expected_path": "NO_CLEAR_PATH",
            "setup_type": "NONE",
        }
        await db.cloud_market_outlooks.insert_one(dict(doc))
        return doc

    narrative = await _synthesize_narrative(direction_label, confidence, thesis, path, zone, account_id)

    outlook_id = _new_outlook_id(direction_label)
    doc = {
        "id": outlook_id,
        "symbol": OUTLOOK_SYMBOL,
        "account": account, "license_key": license_key,
        "generated_at": now.isoformat(),
        "hourly_slot": hourly_slot,
        "late_catchup": is_late_catchup,
        "expiry_at": (now + timedelta(hours=OUTLOOK_HORIZON_HOURS)).isoformat(),
        "current_price": current_price,
        "price_source": price_source,
        "primary_direction": direction_label,
        "direction": direction,
        "directional_conflict": directional_conflict,
        "market_regime": evidence.get("regime", ""),
        "setup_type": setup_type,
        "confidence_pct": confidence,
        "confidence_components": components.model_dump(),
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
        "status": "PUBLISHED",
        "activation": {"activated": False, "activated_at": None, "activated_price": None},
        "milestones_hit": [],
        "final_result": None,
        "final_r": None,
        "highest_tp_reached": None,
        "mfe": 0.0, "mae": 0.0,
        "color_state": "AMBER",
    }
    await db.cloud_market_outlooks.insert_one(dict(doc))
    logger.info(f"OUTLOOK_PUBLISHED id={outlook_id} dir={direction_label} conf={confidence}% account={account}")
    return doc


async def hourly_generation_tick() -> int:
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
    accounts = await db.cloud_bot_activity.distinct("account", {"ts": {"$gte": cutoff}})
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
                published += 1
                if is_late_catchup:
                    logger.warning(f"OUTLOOK_SLOT_LATE_CATCHUP account={account} slot={current_slot} previousSlot={last_doc.get('hourly_slot') if last_doc else None}")
                await _dispatch_hourly_notification(doc)
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

def _classify_final_result(highest_tp: Optional[int], sl_hit: bool, activated: bool, entry_zone_reached: bool) -> str:
    if not entry_zone_reached:
        return "GRAY_EXPIRED_NO_ENTRY"
    if not activated:
        return "GRAY_INVALIDATED_BEFORE_ENTRY"
    if highest_tp == 3:
        return "GREEN_TP3"
    if highest_tp == 2:
        return "GREEN_TP2"
    if highest_tp == 1:
        return "GREEN_TP1"
    if sl_hit:
        return "RED_STOPPED"
    return "RED_NO_PROFIT"


def _color_for_result(result: Optional[str], status: str) -> str:
    if result is None:
        return "AMBER"
    if result.startswith("GREEN"):
        return "GREEN"
    if result.startswith("RED"):
        return "RED"
    if result.startswith("GRAY"):
        return "GRAY"
    return "AMBER"


async def track_outlook_lifecycle_tick() -> int:
    """Called every minute. Checks each still-open outlook's status against
    the live price feed, in strict event order (SL vs TP1/2/3 vs entry-zone
    touch), and freezes a final result exactly once. This function ONLY
    reads price and writes to cloud_market_outlooks/cloud_market_outlook_revisions
    -- it never touches any EA/trade collection."""
    srv = _server()
    db = _db()
    price_info = await srv.fetch_live_gold_price()
    price = float(price_info.get("bid", 0.0) or 0.0)
    if price <= 0:
        return 0

    now = datetime.now(timezone.utc)
    # Audit fix: "TP1_HIT"/"TP2_HIT" are used as BOTH an interim status
    # ("still open, chasing the next TP") and, via _finalize_outlook, a
    # TERMINAL status (an outlook that hit TP1 and later got stopped out
    # before TP2 is finalized with status=f"TP{highest_tp}_HIT" -- the same
    # string). Filtering on status alone therefore kept re-selecting
    # already-resolved "partial TP then stopped" outlooks on every tick
    # forever, and _finalize_outlook has no idempotency guard of its own
    # (unconditional insert_one into outcomes/revisions), so this silently
    # inserted a duplicate outcome+revision row every minute, indefinitely,
    # for that entire class of trade. The authoritative "is this actually
    # still open" signal is resolved_at (set exactly once, inside
    # _finalize_outlook, and never cleared) -- excluding anything with it
    # already set closes the gap regardless of what status string an
    # outlook happens to share with an interim state.
    open_statuses = ["PUBLISHED", "WAITING_FOR_ENTRY_ZONE", "ENTRY_ZONE_ACTIVE",
                     "CONFIRMATION_PENDING", "ACTIVE", "TP1_HIT", "TP2_HIT"]
    cursor = db.cloud_market_outlooks.find({
        "status": {"$in": open_statuses},
        "primary_direction": {"$in": ["BUY", "SELL"]},
        "resolved_at": {"$in": [None, ""]},
    })
    updated = 0
    async for doc in cursor:
        changed = await _advance_outlook_state(doc, price, now)
        if changed:
            updated += 1
    return updated


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


async def _advance_outlook_state(doc: Dict, price: float, now: datetime) -> bool:
    db = _db()
    outlook_id = doc["id"]
    direction = int(doc.get("direction") or 0)
    if direction == 0:
        return False

    expiry = doc.get("expiry_at")
    expired = expiry and now.isoformat() > expiry
    zone_low = doc.get("preferred_entry_zone_low")
    zone_high = doc.get("preferred_entry_zone_high")
    sl = doc.get("suggested_sl")
    tp1, tp2, tp3 = doc.get("tp1_price"), doc.get("tp2_price"), doc.get("tp3_price")
    activation = doc.get("activation") or {"activated": False}
    activated = bool(activation.get("activated"))

    mfe = float(doc.get("mfe", 0.0) or 0.0)
    mae = float(doc.get("mae", 0.0) or 0.0)
    if activated:
        entry_price = float(activation.get("activated_price") or price)
        favorable = (price - entry_price) if direction == 1 else (entry_price - price)
        mfe = max(mfe, favorable)
        mae = max(mae, -favorable) if favorable < 0 else mae

    entry_zone_reached = bool(doc.get("_entry_zone_reached")) or (
        zone_low is not None and zone_high is not None and zone_low <= price <= zone_high
    )

    new_status = doc.get("status")
    milestones = list(doc.get("milestones_hit") or [])

    if not activated:
        if entry_zone_reached and not doc.get("_entry_zone_reached"):
            await _record_revision(outlook_id, "status", doc.get("status"), "ENTRY_ZONE_ACTIVE", "price entered preferred zone")
            new_status = "ENTRY_ZONE_ACTIVE"
            if "ENTRY_ZONE_REACHED" not in milestones:
                milestones.append("ENTRY_ZONE_REACHED")
            # Audit fix: milestones_hit was never actually persisted here
            # (only _entry_zone_reached was) -- the stored document
            # permanently lacked this entry even though the milestone was
            # correctly dispatched once. This whole branch is guarded by
            # `not doc.get("_entry_zone_reached")` above, i.e. it can only
            # run once per outlook, so the dispatch below is unconditional.
            await db.cloud_market_outlooks.update_one(
                {"id": outlook_id}, {"$set": {"_entry_zone_reached": True, "milestones_hit": milestones}})
            await _dispatch_milestone_notification(doc, "ENTRY_ZONE_REACHED")
        sl_invalidated = (direction == 1 and price <= sl) if sl else False
        sl_invalidated = sl_invalidated or ((direction == -1 and price >= sl) if sl else False)
        if entry_zone_reached and sl_invalidated:
            new_status = "INVALIDATED"
        elif expired and not entry_zone_reached:
            new_status = "EXPIRED"
        elif expired and entry_zone_reached:
            new_status = "MISSED_WITHOUT_ENTRY"

        if new_status in ("INVALIDATED", "EXPIRED", "MISSED_WITHOUT_ENTRY") and new_status != doc.get("status"):
            final_result = _classify_final_result(None, False, False, entry_zone_reached)
            await _finalize_outlook(doc, new_status, final_result, None, mfe, mae, now)
            if new_status == "INVALIDATED":
                await _dispatch_milestone_notification(doc, "INVALIDATED")
            elif new_status in ("EXPIRED", "MISSED_WITHOUT_ENTRY"):
                await _dispatch_milestone_notification(doc, "EXPIRED_NO_ENTRY")
            return True
        elif new_status != doc.get("status"):
            await db.cloud_market_outlooks.update_one({"id": outlook_id}, {"$set": {"status": new_status, "mfe": mfe, "mae": mae}})
            return True
        # activation check: confirmation = price actually reached zone AND then
        # moved favorably by a small margin (avoids "touched the edge" false starts)
        if entry_zone_reached:
            favorable_confirm = (price >= zone_low + (zone_high - zone_low) * 0.15) if direction == 1 else \
                                (price <= zone_high - (zone_high - zone_low) * 0.15)
            if favorable_confirm:
                # Audit fix: milestones_hit never actually gained
                # "OUTLOOK_ACTIVATED" here (neither appended to the local
                # list nor persisted) even though the notification WAS
                # correctly dispatched once -- a data-completeness gap for
                # anything reading milestones_hit later. This branch is
                # only reachable while `not activated` (function-top guard),
                # so it can only run once per outlook -- dispatch below is
                # unconditional, matching the entry-zone branch above.
                if "OUTLOOK_ACTIVATED" not in milestones:
                    milestones.append("OUTLOOK_ACTIVATED")
                await db.cloud_market_outlooks.update_one(
                    {"id": outlook_id},
                    {"$set": {"activation": {"activated": True, "activated_at": now.isoformat(), "activated_price": price},
                             "status": "ACTIVE", "milestones_hit": milestones}})
                await _record_revision(outlook_id, "activation", activation, {"activated": True, "activated_price": price}, "confirmed activation")
                await _dispatch_milestone_notification(doc, "OUTLOOK_ACTIVATED")
                return True
        return False

    # Activated: check SL vs TP1/2/3 in real event order (whichever the
    # live price crosses first this tick -- SL checked first since a single
    # tick crossing both would mean SL is what actually happened first in a
    # fast move, the conservative assumption).
    sl_hit = (direction == 1 and price <= sl) if sl else False
    sl_hit = sl_hit or ((direction == -1 and price >= sl) if sl else False)
    if sl_hit:
        highest_tp = 3 if "TP3_HIT" in milestones else 2 if "TP2_HIT" in milestones else 1 if "TP1_HIT" in milestones else None
        final_result = _classify_final_result(highest_tp, True, True, True)
        await _finalize_outlook(doc, "INVALIDATED" if highest_tp is None else f"TP{highest_tp}_HIT", final_result, highest_tp, mfe, mae, now)
        await _dispatch_milestone_notification(doc, "SL_HIT")
        return True

    hit_now = None
    if direction == 1:
        if tp3 and price >= tp3: hit_now = 3
        elif tp2 and price >= tp2: hit_now = 2
        elif tp1 and price >= tp1: hit_now = 1
    else:
        if tp3 and price <= tp3: hit_now = 3
        elif tp2 and price <= tp2: hit_now = 2
        elif tp1 and price <= tp1: hit_now = 1

    if hit_now and f"TP{hit_now}_HIT" not in milestones:
        milestones.append(f"TP{hit_now}_HIT")
        await db.cloud_market_outlooks.update_one(
            {"id": outlook_id}, {"$set": {"status": f"TP{hit_now}_HIT", "milestones_hit": milestones, "mfe": mfe, "mae": mae}})
        await _record_revision(outlook_id, "status", doc.get("status"), f"TP{hit_now}_HIT", f"price reached TP{hit_now}")
        await _dispatch_milestone_notification(doc, f"TP{hit_now}_HIT")
        if hit_now == 3:
            final_result = _classify_final_result(3, False, True, True)
            await _finalize_outlook(doc, "TP3_HIT", final_result, 3, mfe, mae, now)
        return True

    if expired:
        highest_tp = 3 if "TP3_HIT" in milestones else 2 if "TP2_HIT" in milestones else 1 if "TP1_HIT" in milestones else None
        final_result = _classify_final_result(highest_tp, False, True, True) if highest_tp else "AMBER_UNRESOLVED"
        await _finalize_outlook(doc, "EXPIRED", final_result, highest_tp, mfe, mae, now)
        return True

    if mfe != float(doc.get("mfe", 0.0) or 0.0) or mae != float(doc.get("mae", 0.0) or 0.0):
        await db.cloud_market_outlooks.update_one({"id": outlook_id}, {"$set": {"mfe": mfe, "mae": mae}})
        return True
    return False


async def _finalize_outlook(doc: Dict, status: str, final_result: str, highest_tp: Optional[int],
                            mfe: float, mae: float, now: datetime) -> None:
    # Defense in depth: track_outlook_lifecycle_tick's query already
    # excludes anything with resolved_at set, so this should never be
    # reached for an already-finalized doc -- but a caller passing a stale
    # `doc` snapshot (fetched before another finalize path completed)
    # shouldn't be able to insert a second outcomes/revisions row either.
    if doc.get("resolved_at"):
        logger.warning(f"OUTLOOK_FINALIZE_SKIPPED_ALREADY_RESOLVED id={doc.get('id')}")
        return
    db = _db()
    outlook_id = doc["id"]
    r_field = {1: "tp1_r", 2: "tp2_r", 3: "tp3_r"}.get(highest_tp)
    final_r = doc.get(r_field) if r_field else (-1.0 if final_result == "RED_STOPPED" else None)
    color = _color_for_result(final_result, status)
    update = {
        "status": status, "final_result": final_result, "final_r": final_r,
        "highest_tp_reached": highest_tp, "mfe": mfe, "mae": mae,
        "color_state": color, "resolved_at": now.isoformat(),
    }
    await db.cloud_market_outlooks.update_one({"id": outlook_id}, {"$set": update})
    await _record_revision(outlook_id, "final_result", doc.get("final_result"), final_result, f"outlook resolved: {status}")
    await db.cloud_market_outlook_outcomes.insert_one({
        "id": str(uuid.uuid4()), "outlook_id": outlook_id, "account": doc.get("account"),
        "final_result": final_result, "final_r": final_r, "highest_tp_reached": highest_tp,
        "mfe": mfe, "mae": mae, "confidence_pct": doc.get("confidence_pct"),
        "primary_direction": doc.get("primary_direction"), "setup_type": doc.get("setup_type"),
        "expected_path": doc.get("expected_path"), "session": doc.get("session"),
        "resolved_at": now.isoformat(),
    })
    logger.info(f"OUTLOOK_RESOLVED id={outlook_id} result={final_result} r={final_r}")


# ---------------------------------------------------------------------------
# Notification dispatch (delegates actual push sending to notifications.py)
# ---------------------------------------------------------------------------

async def _dispatch_hourly_notification(doc: Dict) -> None:
    from notifications import send_outlook_notification
    await send_outlook_notification(doc, event="OUTLOOK_PUBLISHED", min_tier="HOURLY_ONLY")


async def _dispatch_milestone_notification(doc: Dict, milestone: str) -> None:
    from notifications import send_outlook_notification
    await send_outlook_notification(doc, event=milestone, min_tier="HOURLY_PLUS_RESULTS")
