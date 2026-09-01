"""Phase 2 (owner directive, 2026-08-05): turns a genuine, fresh, owner-
policy-approved Market Outlook signal into an EA execution candidate.

Deliberately a SEPARATE module from market_outlook.py, not a function
inside it. market_outlook.py has an explicit, tested architectural
boundary (see its own top-of-file STRICT SEPARATION docstring and
tests/test_market_outlook.py's test_no_trade_execution_calls_anywhere_in_outlook_module
/ test_outlook_module_only_writes_its_own_collections /
test_generate_outlook_never_calls_readiness_engine_mutating_functions):
that module never touches cloud_bot_commands or anything else that opens,
closes, blocks, delays, or sizes a trade, directly or indirectly. This
module is the integration layer server.py calls AFTER an outlook
generation call returns, never the other way around -- the advisory
engine stays pure; the decision to turn its output into a live order
lives entirely here.

No second execution engine, no second policy engine: this only enqueues
one normal cloud_bot_commands row (action=OUTLOOK_SIGNAL_OPEN), which the
EA's own existing BotMonitorPollCommands/OpenTrade path executes by
reusing XAU_TryManualOpenNow verbatim -- same hard broker/margin/spread/
position-limit checks, same isManualOverride semantics as every other
remote-command action already does.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Dict, Optional

from pymongo.errors import DuplicateKeyError

logger = logging.getLogger("outlook_execution")


def _db():
    import server as _srv
    return _srv.db


async def enqueue_if_actionable(doc: Optional[Dict]) -> Optional[str]:
    """Given an outlook document just returned by
    market_outlook.generate_outlook_for_account (or
    publish_m10_signal_from_activity, which wraps it), enqueues exactly one
    EA execution command if -- and only if -- it is a genuine, fresh,
    owner-policy-approved BUY/SELL signal.

    `primary_direction` is only ever "BUY"/"SELL" here if
    evaluate_owner_policy() already allowed it -- generate_outlook_for_account
    converts any blocked direction to "BLOCKED" before ever returning, so a
    second owner-policy check here would be a second, divergence-prone copy
    of the same gate, not an independent safeguard. NO_SIGNAL/NEUTRAL/
    RANGE/TRANSITION/BLOCKED/expired/informational documents are silently
    skipped, never enqueued.

    Idempotency: dedupe_key is unique on (account, OUTLOOK_SIGNAL_OPEN,
    signal_id) via cloud_bot_commands' existing unique index on dedupe_key
    (see server.py's startup index-creation block) -- the same "same signal
    can never open two trades" guarantee every other remote command
    action already relies on. A duplicate insert (backend retry, a caller
    invoking this twice for the same doc, EA reconnect re-triggering
    generation) is rejected at the database level and this function simply
    returns the already-queued command's id instead of creating a second
    one.
    """
    if not doc:
        return None
    account = str(doc.get("account") or "")
    direction = str(doc.get("primary_direction") or "").upper()
    signal_id = str(doc.get("id") or "")
    if not account or direction not in ("BUY", "SELL") or not signal_id:
        return None

    db = _db()
    command_id = str(uuid.uuid4())
    dedupe_key = f"{account}:OUTLOOK_SIGNAL_OPEN:{signal_id}"
    now_iso = datetime.now(timezone.utc).isoformat()
    command_doc = {
        "id": command_id,
        "user_id": None,
        "user_email": "SYSTEM_MARKET_OUTLOOK",
        "license_key": str(doc.get("license_key") or ""),
        "mt5_account": account,
        "action": "OUTLOOK_SIGNAL_OPEN",
        "label": "Market Outlook signal execution (owner-approved, automatic)",
        "status": "PENDING",
        "requested_at": now_iso,
        "payload": {"direction": direction, "signal_id": signal_id},
        "ack_at": "", "ack_status": "", "ack_message": "", "ack_details": {},
        "dedupe_key": dedupe_key,
        "source": "MARKET_OUTLOOK",
        "outlook_signal_id": signal_id,
    }
    try:
        await db.cloud_bot_commands.insert_one(command_doc.copy())
        logger.info(
            "OUTLOOK_SIGNAL_EXECUTION_QUEUED signal_id=%s account=%s direction=%s command_id=%s",
            signal_id, account, direction, command_id,
        )
        return command_id
    except DuplicateKeyError:
        existing = await db.cloud_bot_commands.find_one({"dedupe_key": dedupe_key}, {"_id": 0})
        logger.info(
            "OUTLOOK_SIGNAL_EXECUTION_ALREADY_QUEUED signal_id=%s account=%s existing_command_id=%s",
            signal_id, account, (existing or {}).get("id"),
        )
        return (existing or {}).get("id")
