"""Outlook/Manual-Intelligence -> Aurum integration layer (redesigned
2026-09-03, Outlook+Aurum Unified Coordination fix -- ported from the
already-fixed backend_node/src/services/outlookExecution.ts; see that
file's own doc comment for the full root-cause writeup).

PRIOR BEHAVIOR (root cause fixed here): this module used to turn a fresh,
owner-policy-approved Market Outlook signal directly into an
OUTLOOK_SIGNAL_OPEN row in cloud_bot_commands -- the exact same channel
used for owner remote commands (MANUAL_OPEN_NOW etc). An EA that still
understands that action would arm a timer off it and fire OpenTrade() on
its own lighter-weight gate, bypassing the EA's real candidate ->
structure -> freshness -> timing -> XAU_FinalEntryArbiter pipeline. That
made Outlook a second, independent trade-execution source instead of
directional intelligence feeding the EA's own entry timing.

NEW BEHAVIOR: a fresh actionable Outlook/M10 doc no longer enqueues any
command. It upserts a passive `cloud_outlook_thesis` row -- directional
context (direction, confidence, entry zone, invalidation price, targets,
freshness window) with no execution authority of its own. This matches
the Node backend_node/src/routes/cloud/outlookThesis.ts contract exactly
(same collection, same field names), since both the Python (legacy,
xauaisniper.com) and Node (current, xaucloud.io) backends may in
principle serve an EA that reads this collection.

Deliberately a SEPARATE module from market_outlook.py (see that module's
own STRICT SEPARATION docstring): it never touches cloud_bot_commands or
anything else that opens, closes, blocks, delays, or sizes a trade,
directly or indirectly. This module is the integration layer server.py
calls AFTER an outlook generation call returns, never the other way
around -- the advisory engine stays pure.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional

logger = logging.getLogger("outlook_execution")

# Default freshness window for a thesis with no explicit expiry (matches
# the EA's pre-existing ~1h Outlook opportunity window).
DEFAULT_THESIS_TTL_SECONDS = 3600


def _db():
    import server as _srv
    return _srv.db


async def publish_outlook_thesis(doc: Optional[Dict], source_label: str = "MARKET_OUTLOOK") -> Optional[str]:
    """Builds and upserts an OUTLOOK_THESIS row from a fresh actionable
    Outlook or M10 doc. Returns the thesis id, or None if the doc is not
    actionable (missing account/direction/signal id, or no usable SL/entry
    context -- this never fabricates missing thesis data).

    `primary_direction` is only ever "BUY"/"SELL" here if
    evaluate_owner_policy() already allowed it -- generate_outlook_for_account
    converts any blocked direction to "BLOCKED" before ever returning, so a
    second owner-policy check here would be a second, divergence-prone copy
    of the same gate, not an independent safeguard. NO_SIGNAL/NEUTRAL/
    RANGE/TRANSITION/BLOCKED/expired/informational documents are silently
    skipped, never published.
    """
    if not doc:
        return None
    account = str(doc.get("account") or "")
    direction = str(doc.get("primary_direction") or "").upper()
    signal_id = str(doc.get("id") or doc.get("candidate_id") or "")
    if not account or direction not in ("BUY", "SELL") or not signal_id:
        return None

    entry_low = float(doc.get("preferred_entry_zone_low") or 0.0)
    entry_high = float(doc.get("preferred_entry_zone_high") or 0.0)
    if entry_low <= 0.0 or entry_high <= 0.0:
        return None
    entry_ref = round((entry_low + entry_high) / 2.0, 2)

    suggested_sl = float(
        doc.get("suggested_sl") or doc.get("invalidation_price") or doc.get("final_structural_sl") or 0.0
    )
    if suggested_sl <= 0.0:
        return None

    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    generated_at = str(doc.get("generated_at") or now_iso)
    expiry_at = str(doc.get("expiry_at") or "")
    if not expiry_at:
        try:
            generated_dt = datetime.fromisoformat(generated_at.replace("Z", "+00:00"))
        except ValueError:
            generated_dt = now
        expiry_at = (generated_dt + timedelta(seconds=DEFAULT_THESIS_TTL_SECONDS)).isoformat()

    confidence = doc.get("confidence_pct", doc.get("confidence"))
    symbol = str(doc.get("symbol") or "XAUUSD")

    thesis = {
        "id": str(uuid.uuid4()),
        "outlook_id": signal_id,
        "account": account,
        "license_key": str(doc.get("license_key") or ""),
        "symbol": symbol,
        "source": source_label,
        "direction": direction,
        "confidence": float(confidence) if confidence is not None else None,
        "regime": doc.get("market_regime") or doc.get("regime"),
        "setup_type": doc.get("setup_type"),
        "generated_at": generated_at,
        "expires_at": expiry_at,
        "reference_price": entry_ref,
        "preferred_entry_zone_low": entry_low,
        "preferred_entry_zone_high": entry_high,
        "invalidation_price": float(doc.get("invalidation_price") or suggested_sl),
        "suggested_sl": suggested_sl,
        "chase_limit": float(doc.get("chase_limit") or 0.0),
        "tp1_price": doc.get("tp1_price"),
        "tp2_price": doc.get("tp2_price"),
        "tp3_price": doc.get("tp3_price"),
        "status": "ACTIVE",
        "created_at": now_iso,
        "updated_at": now_iso,
    }

    db = _db()
    collection = db.cloud_outlook_thesis

    # One active thesis per (account, symbol): a fresh actionable doc
    # supersedes whatever thesis was previously active for that account,
    # but never erases history -- the prior active row is marked
    # SUPERSEDED rather than deleted.
    await collection.update_many(
        {"account": account, "symbol": symbol, "status": "ACTIVE", "outlook_id": {"$ne": signal_id}},
        {"$set": {"status": "SUPERSEDED", "updated_at": now_iso}},
    )
    await collection.update_one(
        {"account": account, "symbol": symbol, "outlook_id": signal_id},
        {"$set": thesis},
        upsert=True,
    )
    logger.info(
        "OUTLOOK_THESIS_PUBLISHED outlook_id=%s account=%s direction=%s source=%s",
        signal_id, account, direction, source_label,
    )
    return thesis["id"]


async def enqueue_if_actionable(doc: Optional[Dict]) -> Optional[str]:
    """Back-compat alias for existing callers (server.py) -- see
    publish_outlook_thesis's own doc comment. No longer enqueues a command."""
    return await publish_outlook_thesis(doc)


async def retire_stale_outlook_signal_open_commands(now: Optional[datetime] = None) -> int:
    """Outlook+Aurum Unified Coordination fix (2026-09-03): OUTLOOK_SIGNAL_OPEN
    is no longer emitted by this module. Any command still sitting in
    cloud_bot_commands with that action and PENDING status is a leftover
    from the OLD code path -- a still-connected EA that understands
    OUTLOOK_SIGNAL_OPEN would otherwise poll it and self-execute a trade
    the new architecture never intended to authorize. Call once at startup
    (mirrors backend_node/src/services/commandStateMachine.ts's
    retireStaleOutlookSignalOpenCommands)."""
    now = now or datetime.now(timezone.utc)
    db = _db()
    result = await db.cloud_bot_commands.update_many(
        {"status": "PENDING", "action": "OUTLOOK_SIGNAL_OPEN"},
        {
            "$set": {
                "status": "SKIPPED",
                "ack_status": "SKIPPED",
                "ack_at": now.isoformat(),
                "ack_message": (
                    "Retired: OUTLOOK_SIGNAL_OPEN is no longer an execution command "
                    "(Outlook+Aurum Unified Coordination fix, 2026-09-03). See cloud_outlook_thesis."
                ),
            }
        },
    )
    return result.modified_count
