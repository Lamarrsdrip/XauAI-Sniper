"""Real, executable tests for the v6.25.4 (URGENT P0) ML/hive route
security fixes (final pre-launch hardening).

Root vulnerability: POST /api/journal/log accepted ANY caller's win/loss
report with NO authentication at all, and fed it straight into
db.hive_signatures, which the (also unauthenticated) hive-score verdict
used to hard BOOST/VETO trades for EVERY user sharing that setup
signature -- anyone with no license at all could fabricate losses to
silently block real customers' live trades, or fabricate wins to force
over-trading. Also covers the retirement of five dead, orphaned ML
routes with no current EA caller (ml/submit-pattern, ml/get-confidence,
ml/stats, smart/check-trade, ai/memory/query).

Uses a live local MongoDB in an isolated database (skips cleanly if none
reachable).
"""
import sys
import os
import uuid
import asyncio

import pytest

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)


def _mongo_available() -> bool:
    try:
        from pymongo import MongoClient
        MongoClient("mongodb://localhost:27017", serverSelectionTimeoutMS=800).admin.command("ping")
        return True
    except Exception:
        return False


pytestmark = pytest.mark.skipif(not _mongo_available(), reason="no local MongoDB reachable for this live test")

TEST_DB = f"mlroutes_pytest_{uuid.uuid4().hex[:10]}"
os.environ["MONGO_URL"] = "mongodb://localhost:27017"
os.environ["DB_NAME"] = TEST_DB
os.environ.setdefault("JWT_SECRET", "test-secret-mlroutes")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")

import server as srv  # noqa: E402
from fastapi import HTTPException  # noqa: E402
from unittest.mock import MagicMock  # noqa: E402

_LOOP = asyncio.new_event_loop()


def _run(coro):
    return _LOOP.run_until_complete(coro)


class _FakeRequest:
    def __init__(self, ip="9.9.9.9"):
        self.headers = {}
        self.client = MagicMock(host=ip)


def _reset():
    srv._rate_limit_buckets.clear()


async def _clear():
    await srv.db.trade_journal.delete_many({})
    await srv.db.hive_signatures.delete_many({})
    await srv.db.pin_licenses.delete_many({})


def setup_function(_fn):
    _reset()
    _run(_clear())


def _make_entry(pin, signature="sig-target"):
    return srv.TradeJournalEntry(
        pin=pin, symbol="XAUUSD", direction="BUY", result="LOSS",
        price=2000.0, profit=-50.0, lots=0.1, hour=10, day_of_week=2,
        total_trades=1, wins=0, losses=1, balance=10000.0,
        signature=signature, setup="A_PLUS", regime="TREND",
    )


def test_journal_log_rejects_unlicensed_caller_no_pin_at_all():
    entry = _make_entry(pin="")
    result = _run(srv.log_trade_journal(entry, _FakeRequest()))
    assert result["status"] == "error"


def test_journal_log_rejects_fabricated_nonexistent_pin():
    entry = _make_entry(pin="ASE-TOTALLY-MADE-UP")
    result = _run(srv.log_trade_journal(entry, _FakeRequest()))
    assert result["status"] == "error"


def test_journal_log_unlicensed_caller_cannot_pollute_hive_signatures():
    """The exact exploit this closes: an attacker with no real license
    fabricating losses to VETO other customers' trades on a shared setup
    signature."""
    entry = _make_entry(pin="ASE-ATTACKER-NO-LICENSE", signature="victim-signature")
    _run(srv.log_trade_journal(entry, _FakeRequest()))

    async def check():
        return await srv.db.hive_signatures.count_documents({"signature": "victim-signature"})
    assert _run(check()) == 0


def test_journal_log_accepts_genuinely_active_licensed_pin():
    _run(srv.db.pin_licenses.insert_one({"pin": "ASE-REAL-LICENSE1", "is_active": True, "mt5_account": "12345"}))
    entry = _make_entry(pin="ASE-REAL-LICENSE1", signature="real-signature")
    result = _run(srv.log_trade_journal(entry, _FakeRequest()))
    assert result["status"] == "ok"

    async def check():
        return await srv.db.hive_signatures.count_documents({"signature": "real-signature"})
    assert _run(check()) == 1


def test_journal_log_rejects_inactive_license():
    _run(srv.db.pin_licenses.insert_one({"pin": "ASE-REVOKED1", "is_active": False, "mt5_account": "12345"}))
    entry = _make_entry(pin="ASE-REVOKED1")
    result = _run(srv.log_trade_journal(entry, _FakeRequest()))
    assert result["status"] == "error"


def test_journal_log_rate_limited_per_pin():
    _run(srv.db.pin_licenses.insert_one({"pin": "ASE-RATELIMIT1", "is_active": True, "mt5_account": "12345"}))
    fake_req = _FakeRequest()
    for i in range(60):
        entry = _make_entry(pin="ASE-RATELIMIT1", signature=f"sig-{i}")
        result = _run(srv.log_trade_journal(entry, fake_req))
        assert result["status"] == "ok", f"attempt {i} unexpectedly rejected"
    entry = _make_entry(pin="ASE-RATELIMIT1", signature="sig-over")
    with pytest.raises(HTTPException) as exc:
        _run(srv.log_trade_journal(entry, fake_req))
    assert exc.value.status_code == 429


# ---------------------------------------------------------------------
# Retired dead/orphaned ML routes (no current EA caller)
# ---------------------------------------------------------------------

def test_ml_submit_pattern_retired():
    with pytest.raises(HTTPException) as exc:
        _run(srv.ml_submit_pattern_retired())
    assert exc.value.status_code == 410


def test_ml_get_confidence_retired():
    with pytest.raises(HTTPException) as exc:
        _run(srv.ml_get_confidence_retired())
    assert exc.value.status_code == 410


def test_ml_stats_retired():
    with pytest.raises(HTTPException) as exc:
        _run(srv.ml_stats_retired())
    assert exc.value.status_code == 410


def test_smart_check_trade_retired():
    with pytest.raises(HTTPException) as exc:
        _run(srv.smart_check_trade_retired())
    assert exc.value.status_code == 410


def test_ai_memory_query_retired():
    with pytest.raises(HTTPException) as exc:
        _run(srv.ai_memory_query_retired())
    assert exc.value.status_code == 410


def test_admin_ml_stats_still_works_via_private_helper():
    """The admin-only detailed stats route must keep working even though
    the public /ml/stats route was retired -- it now calls the renamed
    private helper directly."""
    result = _run(srv._compute_ml_global_stats())
    assert "total_patterns" in result


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
