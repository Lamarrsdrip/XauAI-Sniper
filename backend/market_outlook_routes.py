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


def compute_outlook_stats(rows: list) -> dict:
    """Derive performance only from persisted authoritative outcomes."""
    stats_rows = [o for o in rows if not o.get("excluded_from_stats")]
    unavailable = [o for o in stats_rows if o.get("historical_repair_status") == mo.ANALYTICS_UNAVAILABLE
                   or o.get("analytics_outcome") == mo.ANALYTICS_UNAVAILABLE]
    actionable = [o for o in stats_rows
                  if o.get("primary_direction") in ("BUY", "SELL")
                  and not o.get("excluded_from_signal_analytics")
                  and o not in unavailable]
    completed = [o for o in actionable if o.get("analytics_outcome") in (mo.ANALYTICS_WIN, mo.ANALYTICS_LOSS)]
    wins = [o for o in completed if o.get("analytics_outcome") == mo.ANALYTICS_WIN]
    losses = [o for o in completed if o.get("analytics_outcome") == mo.ANALYTICS_LOSS]
    active_unresolved = [o for o in actionable if o.get("analytics_outcome") is None]
    informational = [o for o in stats_rows if o.get("primary_direction") not in ("BUY", "SELL")]
    tp1_count = sum(1 for o in completed if int(o.get("highest_tp_reached") or 0) >= 1)
    tp2_count = sum(1 for o in completed if int(o.get("highest_tp_reached") or 0) >= 2)
    tp3_count = sum(1 for o in completed if int(o.get("highest_tp_reached") or 0) >= 3)
    resolved_rs = [float(o["analytics_r"]) for o in completed if o.get("analytics_r") is not None]
    win_rate = round(len(wins) / len(wins + losses), 3) if (wins or losses) else None
    win_rs = [float(o["analytics_r"]) for o in wins if o.get("analytics_r") is not None]
    loss_rs = [float(o["analytics_r"]) for o in losses if o.get("analytics_r") is not None]
    gross_win = sum(win_rs) if win_rs else 0.0
    gross_loss = abs(sum(loss_rs)) if loss_rs else 0.0
    return {
        "total_outlooks": len(stats_rows), "actionable_outlooks": len(actionable),
        "activated_outlooks": len(actionable), "informational_outlooks": len(informational),
        "green_results": len(wins), "red_results": len(losses), "no_entry_results": 0,
        "tp1_hit_rate": round(tp1_count / len(completed), 3) if completed else 0,
        "tp2_hit_rate": round(tp2_count / len(completed), 3) if completed else 0,
        "tp3_hit_rate": round(tp3_count / len(completed), 3) if completed else 0,
        "average_r": round(sum(resolved_rs) / len(resolved_rs), 3) if resolved_rs else None,
        "average_mfe": round(sum(float(o.get("mfe_r", 0) or 0) for o in actionable) / len(actionable), 3) if actionable else None,
        "average_mae": round(sum(float(o.get("mae_r", 0) or 0) for o in actionable) / len(actionable), 3) if actionable else None,
        "resolved_count": len(completed), "wins": len(wins), "losses": len(losses), "breakeven": 0,
        "no_entry_count": 0, "active_unresolved_count": len(active_unresolved),
        "unavailable_historical_count": len(unavailable), "win_rate": win_rate,
        "total_r": round(sum(resolved_rs), 3) if resolved_rs else 0.0,
        "average_win_r": round(sum(win_rs) / len(win_rs), 3) if win_rs else None,
        "average_loss_r": round(sum(loss_rs) / len(loss_rs), 3) if loss_rs else None,
        # JSON has no portable Infinity value. An all-win filtered subset
        # has an undefined/unbounded profit factor, so return null rather
        # than crashing the entire History endpoint during serialization.
        "profit_factor": round(gross_win / gross_loss, 3) if gross_loss > 0 else None,
        "best_result_r": max(resolved_rs) if resolved_rs else None,
        "worst_result_r": min(resolved_rs) if resolved_rs else None,
    }


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
        to_date: Optional[str] = Query(None), limit: int = Query(50, ge=1, le=200),
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
            # Filter the authoritative state-machine result, never display
            # text or a generic lifecycle label.
            conditions.append({"final_result": result})
        if min_confidence is not None:
            conditions.append({"confidence_pct": {"$gte": min_confidence}})
        if max_confidence is not None:
            conditions.append({"confidence_pct": {"$lte": max_confidence}})
        if from_date:
            conditions.append({"generated_at": {"$gte": from_date}})
        if to_date:
            conditions.append({"generated_at": {"$lte": to_date}})
        query = {"$and": conditions}
        rows = await db.cloud_market_outlooks.find(query, {"_id": 0}).sort("generated_at", -1).to_list(limit)

        # Cards are paged, but analytics must cover the full tenant-scoped
        # filtered history. Computing stats from only the newest 50/200 rows
        # silently changed win rate as older records fell off the page.
        stats_projection = {
            "_id": 0, "excluded_from_stats": 1, "historical_repair_status": 1,
            "analytics_outcome": 1, "primary_direction": 1,
            "excluded_from_signal_analytics": 1, "highest_tp_reached": 1,
            "analytics_r": 1, "mfe_r": 1, "mae_r": 1,
        }
        stats_rows = await db.cloud_market_outlooks.find(query, stats_projection).to_list(None)
        stats = compute_outlook_stats(stats_rows)
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

    # v6.25.3 owner directive 2026-07-17 -- OneSignal App ID is not secret;
    # the frontend SDK needs it directly to call OneSignal.init(). Replaces
    # the retired VAPID public-key endpoint.
    @r.get("/outlook/notifications/onesignal-app-id")
    async def get_onesignal_app_id():
        return await notif.get_onesignal_status()

    # v6.25.3 -- the frontend needs the authenticated caller's own user id to
    # pass to OneSignal.login(userId) client-side, tagging that browser's
    # OneSignal device registration with our internal identity so later
    # sends via include_aliases.external_id reach it.
    @r.get("/outlook/notifications/my-user-id")
    async def get_my_user_id(user: dict = Depends(srv.get_cloud_user)):
        return {"user_id": user["id"]}

    # v6.25.3 owner directive -- no more raw Web Push endpoint/keys stored
    # here. OneSignal's SDK manages actual device registration; this just
    # confirms the browser granted permission and was tagged via
    # OneSignal.login(), so this backend knows "opted_in" for status/dispatch
    # purposes. One record per user (not per device) since OneSignal fans a
    # single external_user_id out to every device tagged under it.
    @r.post("/outlook/notifications/subscribe")
    async def subscribe_push(body: mo.PushSubscriptionIn, user: dict = Depends(srv.get_cloud_user)):
        db = srv.db
        now_iso = datetime.now(timezone.utc).isoformat()
        existing = await db.cloud_push_subscriptions.find_one({"user_id": user["id"]})
        record = {
            "user_id": user["id"], "opted_in": True,
            "device_label": body.device_label or "", "timezone_offset_minutes": body.timezone_offset_minutes or 0,
            "updated_at": now_iso,
        }
        if existing:
            await db.cloud_push_subscriptions.update_one({"id": existing["id"]}, {"$set": record})
            return {"ok": True, "device_id": existing["id"], "already_subscribed": True, "refreshed": True}
        device_id = str(uuid.uuid4())
        record["id"] = device_id
        record["created_at"] = now_iso
        await db.cloud_push_subscriptions.insert_one(record)
        return {"ok": True, "device_id": device_id, "already_subscribed": False, "refreshed": False}

    @r.delete("/outlook/notifications/subscribe/{device_id}")
    async def unsubscribe_push(device_id: str, user: dict = Depends(srv.get_cloud_user)):
        db = srv.db
        result = await db.cloud_push_subscriptions.update_one(
            {"id": device_id, "user_id": user["id"]}, {"$set": {"opted_in": False}})
        return {"ok": True, "deleted": result.modified_count > 0}

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
        # Rate-limited per user -- prevents a compromised/scripted Command
        # Center session from hammering the OneSignal REST API (which is
        # billed/rate-limited by OneSignal itself) via repeated test sends.
        srv._rate_limit(f"notification_test_user:{user['id']}", max_requests=5, window_seconds=300)
        return await notif.send_test_notification(user["id"])

    return r
