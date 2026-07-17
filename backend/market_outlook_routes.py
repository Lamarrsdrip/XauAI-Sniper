"""API routes for the AI Market Outlook feature. Included into server.py's
existing api_router. All endpoints are scoped to the authenticated
cloud_users identity via the existing get_cloud_user dependency -- same
pattern as every other /cloud/monitor/* endpoint.

STRICT SEPARATION: no endpoint here can open/close/block/delay a trade --
every handler only reads/writes this feature's own collections
(cloud_market_outlooks, cloud_market_outlook_revisions,
cloud_market_outlook_outcomes, cloud_notification_prefs,
cloud_push_subscriptions, cloud_notification_log).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

import market_outlook as mo
import notifications as notif


def build_router() -> APIRouter:
    """Called from server.py AFTER server.py's own globals exist, so the
    real get_cloud_user dependency can be bound here without circularity."""
    import server as srv

    r = APIRouter()

    @r.get("/outlook/current")
    async def get_current_outlook(user: dict = Depends(srv.get_cloud_user)):
        db = srv.db
        lic = await srv._get_user_license(user)
        account = str((lic or {}).get("mt5_account") or "").strip()
        license_key = srv._normalize_license_key((lic or {}).get("pin", "")) if lic else ""
        if not account and not license_key:
            return {"outlook": None, "reason": "license_not_linked"}
        scope = {"$or": [{"account": account}, {"license_key": license_key}]} if account and license_key \
            else ({"account": account} if account else {"license_key": license_key})
        doc = await db.cloud_market_outlooks.find_one(scope, {"_id": 0}, sort=[("generated_at", -1)])
        # Phase 9 diagnostics: lets the frontend show real evidence/generation
        # state instead of guessing from the outlook doc alone -- in
        # particular so it never renders "connect your EA" while recent
        # canonical evidence actually exists (evidence_status == "OK").
        evidence, evidence_reason = await mo._latest_ea_evidence(license_key, account)
        now = datetime.now(timezone.utc)
        evidence_age_seconds = None
        if evidence and evidence.get("ts"):
            try:
                evidence_age_seconds = (now - datetime.fromisoformat(str(evidence["ts"]).replace("Z", "+00:00"))).total_seconds()
            except Exception:
                evidence_age_seconds = None
        next_slot = now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
        diagnostics = {
            "last_ea_evidence_at": evidence.get("ts") if evidence else None,
            "evidence_age_seconds": evidence_age_seconds,
            "evidence_symbol": evidence.get("symbol") if evidence else None,
            "evidence_status": evidence_reason,
            "last_outlook_generated_at": doc.get("generated_at") if doc else None,
            "next_outlook_at": next_slot.isoformat(),
            "generation_status": "OK" if evidence else evidence_reason,
        }
        return {"outlook": doc, "diagnostics": diagnostics}

    @r.get("/outlook/history")
    async def get_outlook_history(
        direction: Optional[str] = Query(None), color: Optional[str] = Query(None),
        tp: Optional[str] = Query(None), result: Optional[str] = Query(None),
        min_confidence: Optional[int] = Query(None),
        max_confidence: Optional[int] = Query(None), from_date: Optional[str] = Query(None),
        to_date: Optional[str] = Query(None), limit: int = Query(50),
        user: dict = Depends(srv.get_cloud_user),
    ):
        db = srv.db
        lic = await srv._get_user_license(user)
        account = str((lic or {}).get("mt5_account") or "").strip()
        license_key = srv._normalize_license_key((lic or {}).get("pin", "")) if lic else ""
        if not account and not license_key:
            return {"outlooks": [], "stats": {}, "reason": "license_not_linked"}
        scope = {"$or": [{"account": account}, {"license_key": license_key}]} if account and license_key \
            else ({"account": account} if account else {"license_key": license_key})
        conditions = [scope]
        if direction and direction != "All":
            conditions.append({"primary_direction": direction})
        if color and color != "All":
            conditions.append({"color_state": color})
        if tp:
            # Audit fix: was an exact match on highest_tp_reached, which
            # disagreed with the "at least N" semantics the stats block
            # right above the filter uses for tp1_hit_rate/tp2_hit_rate
            # (see get_outlook_history's own stats computation below) --
            # clicking "TP2" used to show a strict subset of what "TP2
            # rate" counted (excluded outlooks that continued on to TP3).
            # Now $gte, matching the displayed rate's own definition.
            conditions.append({"highest_tp_reached": {"$gte": int(tp.replace("TP", ""))}} if tp.startswith("TP") else {"status": tp})
        if result:
            # Audit fix: "Stopped" used to be sent as tp="INVALIDATED",
            # which the branch above turned into {"status": "INVALIDATED"} --
            # but that literal status string is shared by TWO unrelated
            # outcomes (see market_outlook.py's _advance_outlook_state):
            # a setup invalidating BEFORE any entry was ever taken
            # (GRAY_INVALIDATED_BEFORE_ENTRY, a "no entry" result) and a
            # real trade that activated and then hit SL with no TP reached
            # (RED_STOPPED). "Stopped" was silently including never-entered
            # setups. This new `result` param filters on the precise,
            # unambiguous final_result field instead of the lifecycle
            # status string.
            conditions.append({"final_result": result})
        if min_confidence is not None:
            conditions.append({"confidence_pct": {"$gte": min_confidence}})
        if max_confidence is not None:
            conditions.append({"confidence_pct": {"$lte": max_confidence}})
        if from_date:
            conditions.append({"generated_at": {"$gte": from_date}})
        if to_date:
            conditions.append({"generated_at": {"$lte": to_date}})
        rows = await db.cloud_market_outlooks.find({"$and": conditions}, {"_id": 0}).sort("generated_at", -1).to_list(min(limit, 200))

        # v6.24.17 price-integrity repair: a record marked excluded_from_stats
        # (see market_outlook.repair_price_integrity_incidents) stays visible
        # in the returned `outlooks` list for audit, but must never count
        # toward win/loss/no-entry/TP-rate/confidence stats.
        stats_rows = [o for o in rows if not o.get("excluded_from_stats")]

        activated = [o for o in stats_rows if (o.get("activation") or {}).get("activated")]
        greens = [o for o in stats_rows if o.get("color_state") == "GREEN"]
        reds = [o for o in stats_rows if o.get("color_state") == "RED"]
        grays = [o for o in stats_rows if o.get("color_state") == "GRAY"]
        tp1_count = sum(1 for o in stats_rows if o.get("highest_tp_reached") and o["highest_tp_reached"] >= 1)
        tp2_count = sum(1 for o in stats_rows if o.get("highest_tp_reached") and o["highest_tp_reached"] >= 2)
        tp3_count = sum(1 for o in stats_rows if o.get("highest_tp_reached") and o["highest_tp_reached"] >= 3)
        resolved_rs = [o.get("final_r") for o in stats_rows if o.get("final_r") is not None]

        # v6.24.18 owner directive 2026-07-16 -- genuine win-rate system.
        # "Resolved" = activated AND has a final_r (a real, closed outcome).
        # No-entry/invalidated-before-entry/still-active/invalid-data rows
        # never appear in this set, so they cannot dilute or fabricate a
        # win rate. wins/losses/breakeven are mutually exclusive partitions
        # of resolved_rows by the SIGN of the real final_r, not by the
        # color_state label (color_state can legitimately diverge from the
        # raw sign once a protected-floor exit policy is defined -- see the
        # win_rate computation below, which is deliberately sign-of-final_r
        # based, the one definition that can never be gamed by a display
        # color).
        resolved_rows = [o for o in stats_rows if (o.get("activation") or {}).get("activated") and o.get("final_r") is not None]
        wins = [o for o in resolved_rows if o["final_r"] > 0]
        losses = [o for o in resolved_rows if o["final_r"] < 0]
        breakeven = [o for o in resolved_rows if o["final_r"] == 0]
        no_entry = [o for o in stats_rows if (o.get("final_result") or "").startswith("GRAY")]
        # v6.25.2 owner directive 2026-07-17 -- "Active" must count only
        # genuinely unresolved DIRECTIONAL (BUY/SELL) campaigns. It used to
        # count any non-GRAY row with no final_result, which silently
        # included every non-directional hourly update (TRANSITION/NEUTRAL/
        # RANGE/NO_VALID_OUTLOOK) as if it were its own active signal -- the
        # exact live-evidence bug (one real BUY + two TRANSITION updates
        # showing "Active=3" instead of the true directional count of 1). A
        # TRANSITION is informational only and must never appear here.
        active_unresolved = [o for o in stats_rows
                              if o.get("primary_direction") in ("BUY", "SELL")
                              and o.get("final_result") is None]
        win_rate = round(len(wins) / len(wins + losses), 3) if (wins or losses) else None
        win_rs = [o["final_r"] for o in wins]
        loss_rs = [o["final_r"] for o in losses]
        gross_win = sum(win_rs) if win_rs else 0.0
        gross_loss = abs(sum(loss_rs)) if loss_rs else 0.0

        stats = {
            "total_outlooks": len(stats_rows), "activated_outlooks": len(activated),
            "green_results": len(greens), "red_results": len(reds), "no_entry_results": len(grays),
            "tp1_hit_rate": round(tp1_count / max(1, len(activated)), 3) if activated else 0,
            "tp2_hit_rate": round(tp2_count / max(1, len(activated)), 3) if activated else 0,
            "tp3_hit_rate": round(tp3_count / max(1, len(activated)), 3) if activated else 0,
            "average_r": round(sum(resolved_rs) / len(resolved_rs), 3) if resolved_rs else None,
            "average_mfe": round(sum(o.get("mfe", 0) for o in stats_rows) / len(stats_rows), 3) if stats_rows else None,
            "average_mae": round(sum(o.get("mae", 0) for o in stats_rows) / len(stats_rows), 3) if stats_rows else None,
            # Genuine win-rate block -- wins/(wins+losses), never wins/total.
            "resolved_count": len(resolved_rows),
            "wins": len(wins), "losses": len(losses), "breakeven": len(breakeven),
            "no_entry_count": len(no_entry), "active_unresolved_count": len(active_unresolved),
            "win_rate": win_rate,  # None (display "—") when no resolved signals exist yet
            "total_r": round(sum(resolved_rs), 3) if resolved_rs else 0.0,
            "average_win_r": round(sum(win_rs) / len(win_rs), 3) if win_rs else None,
            "average_loss_r": round(sum(loss_rs) / len(loss_rs), 3) if loss_rs else None,
            "profit_factor": round(gross_win / gross_loss, 3) if gross_loss > 0 else (None if gross_win == 0 else float("inf")),
            "best_result_r": max(resolved_rs) if resolved_rs else None,
            "worst_result_r": min(resolved_rs) if resolved_rs else None,
        }
        return {"outlooks": rows, "stats": stats}

    @r.get("/outlook/{outlook_id}")
    async def get_outlook_by_id(outlook_id: str, user: dict = Depends(srv.get_cloud_user)):
        # Audit fix: this endpoint required AUTHENTICATION (any signed-up
        # user) but never checked AUTHORIZATION (whether this outlook
        # belongs to the caller) -- any logged-in user could fetch any
        # other user's outlook (confidence components, thesis evidence,
        # entry/SL/TP, account regime/session) just by knowing/guessing an
        # outlook_id, which isn't secret (it appears in push-notification
        # deep links and log lines). Every other data-returning endpoint in
        # this file already scopes by the caller's own account/license_key
        # -- this one is now brought in line with that same pattern.
        db = srv.db
        lic = await srv._get_user_license(user)
        account = str((lic or {}).get("mt5_account") or "").strip()
        license_key = srv._normalize_license_key((lic or {}).get("pin", "")) if lic else ""
        if not account and not license_key:
            raise HTTPException(status_code=404, detail="outlook not found")
        scope = {"$or": [{"account": account}, {"license_key": license_key}]} if account and license_key \
            else ({"account": account} if account else {"license_key": license_key})
        doc = await db.cloud_market_outlooks.find_one({"$and": [{"id": outlook_id}, scope]}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="outlook not found")
        revisions = await db.cloud_market_outlook_revisions.find({"outlook_id": outlook_id}, {"_id": 0}).sort("revision_time", 1).to_list(200)
        return {"outlook": doc, "revisions": revisions}

    @r.get("/outlook/notifications/prefs")
    async def get_notification_prefs(user: dict = Depends(srv.get_cloud_user)):
        db = srv.db
        prefs = await db.cloud_notification_prefs.find_one({"user_id": user["id"]}, {"_id": 0})
        return {"prefs": prefs or {"user_id": user["id"], "tier": "OFF", "notify_all_devices": True}}

    @r.post("/outlook/notifications/prefs")
    async def set_notification_prefs(body: mo.NotificationPrefsUpdate, user: dict = Depends(srv.get_cloud_user)):
        db = srv.db
        if body.tier not in mo.NOTIFICATION_TIERS:
            raise HTTPException(status_code=400, detail=f"tier must be one of {mo.NOTIFICATION_TIERS}")
        lic = await srv._get_user_license(user)
        account = str((lic or {}).get("mt5_account") or "").strip()
        doc = {
            "user_id": user["id"], "account": account, "tier": body.tier,
            "quiet_hours_start": body.quiet_hours_start, "quiet_hours_end": body.quiet_hours_end,
            "notify_all_devices": body.notify_all_devices,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.cloud_notification_prefs.update_one({"user_id": user["id"]}, {"$set": doc}, upsert=True)
        return {"ok": True, "prefs": doc}

    # v6.25.2 owner directive 2026-07-17 -- returns the initialized canonical
    # key state, never the module-import-time (possibly-empty) globals.
    # Never includes the private key.
    @r.get("/outlook/notifications/vapid-public-key")
    async def get_vapid_public_key():
        return await notif.get_vapid_status()

    # v6.25.2 owner directive -- an existing endpoint record must REFRESH
    # (keys/device_label/timezone/vapid key fingerprint/updated_at/sw
    # version), not early-return stale data. If the stored subscription's
    # VAPID key fingerprint no longer matches the currently active key (a
    # real admin rotation happened since this device last subscribed), it
    # is marked KEY_ROTATED_OR_MISMATCHED so the frontend knows to drop the
    # old browser-side PushManager subscription and create a fresh one.
    @r.post("/outlook/notifications/subscribe")
    async def subscribe_push(body: mo.PushSubscriptionIn, user: dict = Depends(srv.get_cloud_user)):
        db = srv.db
        vapid_status = await notif.get_vapid_status()
        now_iso = datetime.now(timezone.utc).isoformat()
        record = {
            "user_id": user["id"], "endpoint": body.endpoint, "keys": body.keys,
            "device_label": body.device_label or "", "timezone_offset_minutes": body.timezone_offset_minutes or 0,
            "sw_version": body.sw_version or "",
            "vapid_key_fingerprint": vapid_status["key_fingerprint"],
            "updated_at": now_iso,
        }
        existing = await db.cloud_push_subscriptions.find_one({"user_id": user["id"], "endpoint": body.endpoint})
        if existing:
            await db.cloud_push_subscriptions.update_one({"id": existing["id"]}, {"$set": record})
            key_rotated = bool(existing.get("vapid_key_fingerprint")) and existing.get("vapid_key_fingerprint") != vapid_status["key_fingerprint"]
            return {"ok": True, "device_id": existing["id"], "already_subscribed": True,
                    "refreshed": True, "key_rotated_or_mismatched": key_rotated}
        device_id = str(uuid.uuid4())
        record["id"] = device_id
        record["created_at"] = now_iso
        await db.cloud_push_subscriptions.insert_one(record)
        return {"ok": True, "device_id": device_id, "already_subscribed": False,
                "refreshed": False, "key_rotated_or_mismatched": False}

    @r.delete("/outlook/notifications/subscribe/{device_id}")
    async def unsubscribe_push(device_id: str, user: dict = Depends(srv.get_cloud_user)):
        db = srv.db
        result = await db.cloud_push_subscriptions.delete_one({"id": device_id, "user_id": user["id"]})
        return {"ok": True, "deleted": result.deleted_count > 0}

    @r.get("/outlook/notifications/history")
    async def get_notification_history(limit: int = Query(30), user: dict = Depends(srv.get_cloud_user)):
        db = srv.db
        rows = await db.cloud_notification_log.find({"user_id": user["id"]}, {"_id": 0}).sort("scheduled_time", -1).to_list(min(limit, 100))
        return {"log": rows}

    # v6.24.18 owner directive 2026-07-16 -- the frontend must never show ON
    # from the saved preference tier alone. This is the real, authenticated
    # source of truth: browser permission is a client-side fact the frontend
    # already knows: everything else (device registration, push-server
    # readiness, most recent delivery) is server-authoritative and can only
    # come from here.
    @r.get("/outlook/notifications/status")
    async def get_notification_status(user: dict = Depends(srv.get_cloud_user)):
        return await notif.get_notification_status(user["id"])

    # Real production dispatcher -- uses the exact same _send_webpush() every
    # hourly/milestone event uses. Never creates an Outlook, never touches
    # trading state.
    @r.post("/outlook/notifications/test")
    async def send_test_notification_route(user: dict = Depends(srv.get_cloud_user)):
        return await notif.send_test_notification(user["id"])

    return r
