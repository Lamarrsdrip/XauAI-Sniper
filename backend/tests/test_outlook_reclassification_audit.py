"""Tests for audit_v2_signal_classifications (owner audit, 2026-08-04).

Proves the reclassification audit correctly finds signals that were
mis-recorded as LOSS by the old (pre-fix) SL-touch-locks-in-loss bug --
using the signal's OWN stored broker quote history, re-derived under
today's TP/SL priority rule via the exact same advance_persisted_signal
state machine live monitoring uses -- and that it never guesses when
evidence is insufficient, never writes anything on a dry run, and requires
a fresh password before applying any correction.
"""
import asyncio
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))


def _mongo_available():
    try:
        from pymongo import MongoClient
        MongoClient("mongodb://localhost:27017", serverSelectionTimeoutMS=800).admin.command("ping")
        return True
    except Exception:
        return False


pytestmark = pytest.mark.skipif(not _mongo_available(), reason="no local MongoDB reachable")

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "reclass_audit_route_pytest")
os.environ.setdefault("JWT_SECRET", "test-secret-reclass-audit")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")

import server as srv  # noqa: E402
import market_outlook as mo  # noqa: E402
from fastapi import HTTPException  # noqa: E402


class Harness:
    def __init__(self):
        from motor.motor_asyncio import AsyncIOMotorClient
        self.client = AsyncIOMotorClient("mongodb://localhost:27017")
        self.db = self.client[f"reclass_audit_pytest_{uuid.uuid4().hex[:10]}"]

    async def drop(self):
        await self.client.drop_database(self.db.name)


def _run(coro):
    return asyncio.run(coro)


def _activity(account, at, bid, ask):
    return {
        "account": account, "ts": at.isoformat(),
        "details": {"market_thesis": {"live_bid": bid, "live_ask": ask}},
    }


def _resolved_doc(signal_id, account, published, stored_outcome, stored_r=-1.0, direction="BUY"):
    return {
        "id": signal_id, "account": account, "primary_direction": direction,
        "published_at": published.isoformat(), "generated_at": published.isoformat(),
        "tracking_entry_price": 100.1, "original_sl": 99.1, "suggested_sl": 99.1,
        "risk_distance": 1.0, "evaluation_deadline": (published + timedelta(minutes=60)).isoformat(),
        "tp1_price": 101.1, "tp2_price": 102.1, "tp3_price": 103.1,
        "signal_tracking_version": 2,
        "analytics_outcome": stored_outcome, "analytics_r": stored_r,
        "highest_tp_reached": 0,
    }


def _dense_quotes(account, published, breakpoints):
    """breakpoints: list of (minute_threshold, bid, ask), later thresholds
    override earlier ones -- 5-second density, matching the existing
    backfill test suite's own pattern for 'reliable coverage'."""
    activity = []
    for seconds in range(0, 60 * 60 + 1, 5):
        minute = seconds / 60.0
        bid, ask = 100.0, 100.1
        for threshold, b, a in breakpoints:
            if minute >= threshold:
                bid, ask = b, a
        activity.append(_activity(account, published + timedelta(seconds=seconds), bid, ask))
    return activity


def test_signal_wrongly_locked_as_loss_by_old_sl_bug_is_found_and_corrected():
    """SL touched at minute 10 (old buggy code would have locked this in as
    an immediate LOSS and stopped watching), but TP1 is genuinely touched
    at minute 30 -- the current rule says this is a WIN. The stored record
    still says LOSS (simulating a record classified before the fix). The
    audit must find and correct this."""
    h = Harness()

    async def go():
        published = datetime.now(timezone.utc) - timedelta(hours=2)
        account = "RECLASS-WRONGLOSS"
        doc = _resolved_doc("wrongloss-1", account, published, mo.ANALYTICS_LOSS, stored_r=-1.0)
        await h.db.cloud_market_outlooks.insert_one(doc)
        # Entry 100.1 -- the audit replays under the owner-approved fixed TP
        # grid (entry +/- 5.00/10.00), not this record's stale stored
        # tp1_price, so a genuine TP1 touch here means reaching 105.1+.
        activity = _dense_quotes(account, published, [
            (10, 99.1, 99.2),    # SL touched -- old bug would have finalized LOSS here
            (30, 105.1, 105.2),  # genuine TP1 touch afterward -- current rule: this is a WIN
        ])
        await h.db.cloud_bot_activity.insert_many(activity)

        with patch.object(mo, "_db", return_value=h.db):
            report = await mo.audit_v2_signal_classifications(apply=False)

        assert report["examined"] == 1
        assert report["corrections_found"] == 1
        assert report["corrections_applied"] == 0  # dry run
        correction = report["corrections"][0]
        assert correction["id"] == "wrongloss-1"
        assert correction["stored_outcome"] == mo.ANALYTICS_LOSS
        assert correction["replayed_outcome"] == mo.ANALYTICS_WIN

        # Dry run must never write anything.
        still_stored = await h.db.cloud_market_outlooks.find_one({"id": "wrongloss-1"}, {"_id": 0})
        assert still_stored["analytics_outcome"] == mo.ANALYTICS_LOSS
        await h.drop()

    _run(go())


def test_apply_true_persists_the_correction_with_full_audit_trail():
    h = Harness()

    async def go():
        published = datetime.now(timezone.utc) - timedelta(hours=2)
        account = "RECLASS-APPLY"
        doc = _resolved_doc("apply-1", account, published, mo.ANALYTICS_LOSS, stored_r=-1.0)
        await h.db.cloud_market_outlooks.insert_one(doc)
        activity = _dense_quotes(account, published, [
            (10, 99.1, 99.2),
            (30, 105.1, 105.2),  # genuine fixed-grid TP1 touch (entry 100.1 + 5.00)
        ])
        await h.db.cloud_bot_activity.insert_many(activity)

        with patch.object(mo, "_db", return_value=h.db), \
             patch.object(mo, "_dispatch_signal_event", new=AsyncMock()):
            report = await mo.audit_v2_signal_classifications(apply=True)

        assert report["corrections_applied"] == 1
        updated = await h.db.cloud_market_outlooks.find_one({"id": "apply-1"}, {"_id": 0})
        assert updated["analytics_outcome"] == mo.ANALYTICS_WIN
        assert updated["legacy_classification_before_reclassification_audit"] == mo.ANALYTICS_LOSS
        assert updated["reclassification_audit_run_id"]
        assert updated["highest_tp_reached"] == 1

        revision = await h.db.cloud_market_outlook_revisions.find_one({"outlook_id": "apply-1"}, {"_id": 0})
        assert revision is not None
        assert revision["previous_value"] == mo.ANALYTICS_LOSS
        assert revision["new_value"] == mo.ANALYTICS_WIN

        run_doc = await h.db.cloud_market_outlook_reclassification_runs.find_one({"applied": True}, {"_id": 0})
        assert run_doc is not None
        assert run_doc["summary"]["corrections_applied"] == 1
        await h.drop()

    _run(go())


def test_correctly_classified_loss_is_confirmed_not_corrected():
    """SL touched, no TP ever touched -- both the old and new rule agree
    this is a genuine LOSS. Must be confirmed_correct, not a correction."""
    h = Harness()

    async def go():
        published = datetime.now(timezone.utc) - timedelta(hours=2)
        account = "RECLASS-REALLOSS"
        doc = _resolved_doc("realloss-1", account, published, mo.ANALYTICS_LOSS, stored_r=-1.0)
        await h.db.cloud_market_outlooks.insert_one(doc)
        activity = _dense_quotes(account, published, [
            (12, 99.1, 99.2),  # SL touched, never any TP for the rest of the window
        ])
        await h.db.cloud_bot_activity.insert_many(activity)

        with patch.object(mo, "_db", return_value=h.db):
            report = await mo.audit_v2_signal_classifications(apply=False)

        assert report["examined"] == 1
        assert report["confirmed_correct"] == 1
        assert report["corrections_found"] == 0
        await h.drop()

    _run(go())


def test_correctly_classified_win_is_confirmed_not_corrected():
    h = Harness()

    async def go():
        published = datetime.now(timezone.utc) - timedelta(hours=2)
        account = "RECLASS-REALWIN"
        doc = _resolved_doc("realwin-1", account, published, mo.ANALYTICS_WIN, stored_r=1.0)
        doc["highest_tp_reached"] = 1
        await h.db.cloud_market_outlooks.insert_one(doc)
        activity = _dense_quotes(account, published, [
            (15, 105.1, 105.2),  # genuine fixed-grid TP1 touch, no earlier SL
        ])
        await h.db.cloud_bot_activity.insert_many(activity)

        with patch.object(mo, "_db", return_value=h.db):
            report = await mo.audit_v2_signal_classifications(apply=False)

        assert report["confirmed_correct"] == 1
        assert report["corrections_found"] == 0
        await h.drop()

    _run(go())


def test_sparse_quote_coverage_is_insufficient_evidence_never_guessed():
    h = Harness()

    async def go():
        published = datetime.now(timezone.utc) - timedelta(hours=2)
        account = "RECLASS-SPARSE"
        doc = _resolved_doc("sparse-1", account, published, mo.ANALYTICS_LOSS, stored_r=-1.0)
        await h.db.cloud_market_outlooks.insert_one(doc)
        # Only two quotes in the whole 60-minute window -- far too sparse to
        # trust a re-derivation in either direction.
        await h.db.cloud_bot_activity.insert_many([
            _activity(account, published + timedelta(minutes=1), 100.0, 100.1),
            _activity(account, published + timedelta(minutes=45), 99.1, 99.2),
        ])

        with patch.object(mo, "_db", return_value=h.db):
            report = await mo.audit_v2_signal_classifications(apply=False)

        assert report["insufficient_evidence"] == 1
        assert report["confirmed_correct"] == 0
        assert report["corrections_found"] == 0
        still_stored = await h.db.cloud_market_outlooks.find_one({"id": "sparse-1"}, {"_id": 0})
        assert still_stored["analytics_outcome"] == mo.ANALYTICS_LOSS  # untouched
        await h.drop()

    _run(go())


def test_unresolved_and_legacy_records_are_never_examined():
    """Only signal_tracking_version=2 records with a final WIN/LOSS outcome
    are in scope -- a still-tracking record or a pre-v2 legacy record must
    never be touched by this audit (backfill_signal_outlook_history already
    owns pre-v2 records; a still-open signal has no final result yet)."""
    h = Harness()

    async def go():
        published = datetime.now(timezone.utc) - timedelta(hours=2)
        still_tracking = _resolved_doc("still-tracking", "RECLASS-OPEN", published, None)
        still_tracking["analytics_outcome"] = None
        legacy_v1 = _resolved_doc("legacy-v1", "RECLASS-LEGACY", published, mo.ANALYTICS_LOSS)
        legacy_v1["signal_tracking_version"] = 1
        await h.db.cloud_market_outlooks.insert_many([still_tracking, legacy_v1])
        with patch.object(mo, "_db", return_value=h.db):
            report = await mo.audit_v2_signal_classifications(apply=False)
        assert report["examined"] == 0
        await h.drop()

    _run(go())


def test_admin_endpoint_rejects_apply_without_a_password():
    async def go():
        req = srv.OutlookReclassificationAuditRequest(apply=True)
        with pytest.raises(HTTPException) as exc:
            await srv.admin_outlook_reclassification_audit(req, admin={"email": "admin@test.com"})
        assert exc.value.status_code == 401
    _run(go())


def test_admin_endpoint_dry_run_needs_no_password():
    async def go():
        req = srv.OutlookReclassificationAuditRequest(apply=False)
        assert req.current_password is None
        result = await srv.admin_outlook_reclassification_audit(req, admin={"email": "admin@test.com"})
        assert "examined" in result
    _run(go())


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
