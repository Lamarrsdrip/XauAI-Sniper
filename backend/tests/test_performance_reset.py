"""Real, executable tests for the XauCloud Performance Reset
(forward-record) system.

Covers the owner's required test matrix for
audits/performance_reset/: eligibility/scope filtering, win/loss/BE
classification, profit factor edge cases, drawdown correctness, the
minimum-sample gate, period archival/immutability, historical
preservation, duplicate-close dedup, and admin-authorization on the
period-start endpoint.

Uses a live local MongoDB in an isolated database (skips cleanly if none
reachable), following this project's established live-test pattern
(see test_paystack_payment_security.py / test_admin_mfa.py).
"""
import sys
import os
import time
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


pytestmark = pytest.mark.skipif(not _mongo_available(), reason="no local MongoDB reachable for this live performance-reset test")

TEST_DB = f"perfreset_pytest_{uuid.uuid4().hex[:10]}"
os.environ["MONGO_URL"] = "mongodb://localhost:27017"
os.environ["DB_NAME"] = TEST_DB
os.environ.setdefault("JWT_SECRET", "test-secret-perfreset")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")

import server as srv  # noqa: E402
import performance_engine as pe  # noqa: E402
from fastapi import HTTPException  # noqa: E402

_LOOP = asyncio.new_event_loop()


def _run(coro):
    return _LOOP.run_until_complete(coro)


async def _clear():
    await srv.db.trade_journal.delete_many({})
    await srv.db.performance_periods.delete_many({})
    await srv.db.users.delete_many({})


def setup_function(_fn):
    _run(_clear())


async def _seed_admin(email="perf-admin@test.com", password="AdminPass123"):
    await srv.db.users.insert_one({
        "email": email, "password_hash": srv.hash_password(password),
        "name": "Admin", "role": "admin", "created_at": "2026-07-17T00:00:00Z",
    })
    return await srv.db.users.find_one({"email": email}, {"_id": 0, "password_hash": 0})


def _trade(ticket, opened_at, closed_at=None, profit=0.0, commission=0.0, swap=0.0,
           balance=1000.0, has_rich_ledger_data=True, direction="BUY", price=4000.0,
           ea_version="v6.25.24", account_login="1001", symbol="XAUUSD"):
    return {
        "ticket": ticket,
        "opened_at": opened_at,
        "closed_at": closed_at or (opened_at + 60),
        "profit": profit,
        "commission": commission,
        "swap": swap,
        "balance": balance,
        "has_rich_ledger_data": has_rich_ledger_data,
        "direction": direction,
        "price": price,
        "ea_version": ea_version,
        "account_login": account_login,
        "symbol": symbol,
        "result": "WIN" if profit > 0 else "LOSS",
    }


async def _start_period(admin_doc, name="Test Forward Period", reason="testing", password="AdminPass123", **kw):
    req = srv.StartPerformancePeriodRequest(
        name=name, reason=reason, current_password=password, confirm=True, **kw
    )
    return await srv.admin_start_performance_period(req, admin=admin_doc)


# ---------------------------------------------------------------------
# 1. Trade opened-before/closed-after the epoch is excluded
# ---------------------------------------------------------------------

def test_trade_opened_before_epoch_excluded_even_if_closed_after():
    admin = _run(_seed_admin())
    now = time.time()
    _run(srv.db.trade_journal.insert_one(_trade(1, now - 3600, closed_at=now - 10, profit=50)))
    result = _run(_start_period(admin, account_logins=["1001"]))
    period_id = result["period"]["id"]
    # a trade opened 100s before the epoch, closing after it, must not count
    late_close_before_open = _trade(2, now - 100, closed_at=now + 50, profit=100)
    _run(srv.db.trade_journal.insert_one(late_close_before_open))
    period = _run(srv.db.performance_periods.find_one({"id": period_id}, {"_id": 0}))
    trades = _run(srv._fetch_period_trades(period))
    tickets = [t["ticket"] for t in trades]
    assert 2 not in tickets


# ---------------------------------------------------------------------
# 2. Trade opened after the epoch is included
# ---------------------------------------------------------------------

def test_trade_opened_after_epoch_included():
    admin = _run(_seed_admin())
    result = _run(_start_period(admin, account_logins=["1001"]))
    period = _run(srv.db.performance_periods.find_one({"id": result["period"]["id"]}, {"_id": 0}))
    now = time.time()
    _run(srv.db.trade_journal.insert_one(_trade(10, now + 5, profit=17)))
    trades = _run(srv._fetch_period_trades(period))
    assert [t["ticket"] for t in trades] == [10]


# ---------------------------------------------------------------------
# 3. Open positions (no closed_at / not eligible) are excluded
# ---------------------------------------------------------------------

def test_trade_missing_ticket_or_rich_ledger_data_excluded():
    assert pe.is_eligible_trade(_trade(0, time.time())) is False  # ticket 0 = unreliable pre-v6.25.3
    assert pe.is_eligible_trade(_trade(5, time.time(), has_rich_ledger_data=False)) is False
    t = _trade(6, time.time())
    del t["opened_at"]
    assert pe.is_eligible_trade(t) is False


# ---------------------------------------------------------------------
# 4. Duplicate close events for the same ticket counted once
# ---------------------------------------------------------------------

def test_duplicate_ticket_deduped():
    trades = [_trade(100, time.time(), profit=17), _trade(100, time.time(), profit=17)]
    deduped = pe.dedupe_by_ticket(trades)
    assert len(deduped) == 1


# ---------------------------------------------------------------------
# 5/6. Win/loss classification correctness + break-even consistency
# ---------------------------------------------------------------------

def test_classify_trade_win_loss_be():
    assert pe.classify_trade(_trade(1, 0, profit=50)) == "WIN"
    assert pe.classify_trade(_trade(2, 0, profit=-50)) == "LOSS"
    assert pe.classify_trade(_trade(3, 0, profit=0.5)) == "BE"  # within default $1 tolerance
    assert pe.classify_trade(_trade(4, 0, profit=-0.5)) == "BE"


def test_break_even_excluded_from_win_rate_numerator_and_denominator():
    trades = [
        _trade(1, 1, profit=10),   # WIN
        _trade(2, 2, profit=-10),  # LOSS
        _trade(3, 3, profit=0.2),  # BE
    ]
    stats = pe.compute_period_stats(trades, minimum_sample=1)
    assert stats.wins == 1
    assert stats.losses == 1
    assert stats.break_even == 1
    # win_rate = 1 / (1 win + 1 loss) = 50%, BE excluded from both sides
    assert stats.win_rate == 50.0


# ---------------------------------------------------------------------
# 7. Commission/swap are included in the net result used everywhere
# ---------------------------------------------------------------------

def test_net_result_includes_commission_and_swap():
    t = _trade(1, 0, profit=10, commission=-2, swap=-1)
    assert pe.net_result(t) == 7
    assert pe.classify_trade(t) == "WIN"


# ---------------------------------------------------------------------
# 8. Profit factor uses the exact same dataset as win rate (no second query)
# ---------------------------------------------------------------------

def test_profit_factor_matches_same_trade_set_as_win_rate():
    trades = [_trade(1, 1, profit=100), _trade(2, 2, profit=-50)]
    stats = pe.compute_period_stats(trades, minimum_sample=1)
    assert stats.total_trades == 2
    assert stats.profit_factor_state == "ok"
    assert stats.profit_factor_value == pytest.approx(2.0)


# ---------------------------------------------------------------------
# 9. No-loss dataset never shows infinity -- "not established"
# ---------------------------------------------------------------------

def test_profit_factor_not_established_when_no_losses_yet():
    trades = [_trade(1, 1, profit=50)]
    stats = pe.compute_period_stats(trades, minimum_sample=1)
    assert stats.profit_factor_state == "not_established"
    assert stats.profit_factor_value is None


def test_profit_factor_no_data_when_zero_closed_trades():
    stats = pe.compute_period_stats([], minimum_sample=1)
    assert stats.profit_factor_state == "no_data"
    assert stats.total_trades == 0
    # must never crash on an empty dataset
    d = pe.period_stats_to_dict(stats)
    assert d["total_trades"] == 0


# ---------------------------------------------------------------------
# 10. Drawdown peak/trough correctness (percentage of balance, not $)
# ---------------------------------------------------------------------

def test_drawdown_percentage_computed_from_real_balance_series():
    trades = [
        _trade(1, 1, profit=100, balance=1100),
        _trade(2, 2, profit=-200, balance=900),   # trough: (1100-900)/1100 = 18.1818...%
        _trade(3, 3, profit=300, balance=1200),
    ]
    stats = pe.compute_period_stats(trades, minimum_sample=1)
    assert stats.max_balance_drawdown_pct == pytest.approx(18.1818, abs=0.01)
    assert stats.max_balance_drawdown_usd == pytest.approx(200.0)


# ---------------------------------------------------------------------
# 11. Drawdown starts at zero for a brand-new period with no losses yet
# ---------------------------------------------------------------------

def test_drawdown_zero_for_new_period_with_only_wins():
    trades = [_trade(1, 1, profit=50, balance=1050), _trade(2, 2, profit=25, balance=1075)]
    stats = pe.compute_period_stats(trades, minimum_sample=1)
    assert stats.max_balance_drawdown_pct == 0.0


# ---------------------------------------------------------------------
# 12/13. Minimum-sample gate: <20 shows "collecting", >=20 unlocks cards
# ---------------------------------------------------------------------

def test_below_minimum_sample_reports_insufficient_data():
    trades = [_trade(i, i, profit=10) for i in range(5)]
    stats = pe.compute_period_stats(trades, minimum_sample=20)
    assert stats.sufficient_data is False
    assert stats.total_trades == 5


def test_at_or_above_minimum_sample_reports_sufficient_data():
    trades = [_trade(i, i, profit=10) for i in range(20)]
    stats = pe.compute_period_stats(trades, minimum_sample=20)
    assert stats.sufficient_data is True


# ---------------------------------------------------------------------
# 14. Historical records remain unchanged when a new period starts
# ---------------------------------------------------------------------

def test_archiving_does_not_touch_trade_journal_or_prior_stats():
    admin = _run(_seed_admin())
    r1 = _run(_start_period(admin, account_logins=["1001"]))
    period1_id = r1["period"]["id"]
    now = time.time()
    _run(srv.db.trade_journal.insert_one(_trade(1, now, profit=17, account_login="1001")))
    before = _run(srv._period_summary_dict(_run(srv.db.performance_periods.find_one({"id": period1_id}, {"_id": 0}))))

    time.sleep(0.05)  # ensure period two's real start timestamp lands strictly after the trade above
    _run(_start_period(admin, name="Second Period", account_logins=["1001"]))

    archived = _run(srv.db.performance_periods.find_one({"id": period1_id}, {"_id": 0}))
    assert archived["status"] == "ARCHIVED"
    after = _run(srv._period_summary_dict(archived))
    assert after["total_trades"] == before["total_trades"] == 1
    assert after["win_rate"] == before["win_rate"]
    # the raw trade_journal row itself is untouched
    raw = _run(srv.db.trade_journal.find_one({"ticket": 1}, {"_id": 0}))
    assert raw["profit"] == 17


# ---------------------------------------------------------------------
# 15. New period never deletes the previous one -- it's ARCHIVED, not gone
# ---------------------------------------------------------------------

def test_starting_new_period_archives_not_deletes_previous():
    admin = _run(_seed_admin())
    _run(_start_period(admin))
    count_before = _run(srv.db.performance_periods.count_documents({}))
    _run(_start_period(admin, name="Second Period"))
    count_after = _run(srv.db.performance_periods.count_documents({}))
    assert count_after > count_before
    statuses = {p["status"] for p in _run(srv.db.performance_periods.find({}, {"_id": 0}).to_list(length=50))}
    assert "ARCHIVED" in statuses
    assert "ACTIVE" in statuses


# ---------------------------------------------------------------------
# 16. First-ever activation auto-creates an implicit "Historical EA
#     Journal" archived period spanning all pre-reset trades
# ---------------------------------------------------------------------

def test_first_activation_creates_historical_ea_journal_period():
    admin = _run(_seed_admin())
    old_time = time.time() - 10000
    _run(srv.db.trade_journal.insert_one(_trade(1, old_time, profit=17)))
    _run(_start_period(admin))
    periods = _run(srv.db.performance_periods.find({}, {"_id": 0}).to_list(length=50))
    names = {p["name"] for p in periods}
    assert "Historical EA Journal" in names
    legacy = next(p for p in periods if p["name"] == "Historical EA Journal")
    assert legacy["status"] == "ARCHIVED"
    assert legacy["epoch_started_at_unix"] == pytest.approx(old_time)


# ---------------------------------------------------------------------
# 17. Unauthorized/incorrect-password callers cannot start a new period
# ---------------------------------------------------------------------

def test_start_period_rejects_wrong_password():
    admin = _run(_seed_admin())
    req = srv.StartPerformancePeriodRequest(
        name="Hack Attempt", reason="x", current_password="WRONG", confirm=True,
    )
    with pytest.raises(HTTPException) as exc:
        _run(srv.admin_start_performance_period(req, admin=admin))
    assert exc.value.status_code == 401


def test_start_period_requires_explicit_confirm():
    admin = _run(_seed_admin())
    req = srv.StartPerformancePeriodRequest(
        name="No Confirm", reason="x", current_password="AdminPass123", confirm=False,
    )
    with pytest.raises(HTTPException) as exc:
        _run(srv.admin_start_performance_period(req, admin=admin))
    assert exc.value.status_code == 400


# ---------------------------------------------------------------------
# 18. Recalculation is deterministic and idempotent -- no stale cache
# ---------------------------------------------------------------------

def test_recalculation_idempotent_and_reflects_new_trades_immediately():
    admin = _run(_seed_admin())
    result = _run(_start_period(admin, account_logins=["1001"]))
    period = _run(srv.db.performance_periods.find_one({"id": result["period"]["id"]}, {"_id": 0}))
    now = time.time()
    _run(srv.db.trade_journal.insert_one(_trade(1, now + 1, profit=17, account_login="1001")))
    d1 = _run(srv._period_summary_dict(period))
    d2 = _run(srv._period_summary_dict(period))
    assert d1["total_trades"] == d2["total_trades"] == 1
    assert d1["win_rate"] == d2["win_rate"]
    _run(srv.db.trade_journal.insert_one(_trade(2, now + 2, profit=-5, account_login="1001")))
    d3 = _run(srv._period_summary_dict(period))
    assert d3["total_trades"] == 2


# ---------------------------------------------------------------------
# 19. Homepage endpoint never falls back to hardcoded/stale promotional
#     numbers on failure or when no period exists
# ---------------------------------------------------------------------

def test_summary_endpoint_unavailable_when_no_period_ever_started():
    result = _run(srv.get_performance_summary())
    assert result == {"status": "unavailable"}


def test_summary_endpoint_reports_collecting_below_minimum_sample():
    admin = _run(_seed_admin())
    _run(_start_period(admin, account_logins=["1001"], minimum_sample=20))
    _run(srv.db.trade_journal.insert_one(_trade(1, time.time() + 1, profit=17, account_login="1001")))
    result = _run(srv.get_performance_summary())
    assert result["status"] == "collecting"
    assert result["total_trades"] == 1


# ---------------------------------------------------------------------
# 20. Historical archive page never mixes trades across periods --
#     each archived period's stats come only from its own scoped query
# ---------------------------------------------------------------------

def test_historical_periods_never_mix_trades_across_scopes():
    admin = _run(_seed_admin())
    _run(_start_period(admin, name="Period One", account_logins=["1001"]))
    _run(srv.db.trade_journal.insert_one(_trade(1, time.time(), profit=17, account_login="1001")))
    time.sleep(0.05)  # ensure Period Two's real start timestamp lands strictly after trade 1
    _run(_start_period(admin, name="Period Two", account_logins=["2002"]))
    _run(srv.db.trade_journal.insert_one(_trade(2, time.time() + 5, profit=-5, account_login="2002")))

    hist = _run(srv.get_performance_historical())
    period_one = next(p for p in hist["periods"] if p["period_name"] == "Period One")
    assert period_one["total_trades"] == 1
    assert period_one["win_rate"] == 100.0


# ---------------------------------------------------------------------
# Extra: symbol/account/ea_version scope filters are honored (owner's
# explicit "do not mix accounts/bot versions" requirement)
# ---------------------------------------------------------------------

def test_account_scope_filter_excludes_other_accounts():
    admin = _run(_seed_admin())
    result = _run(_start_period(admin, account_logins=["1001"]))
    period = _run(srv.db.performance_periods.find_one({"id": result["period"]["id"]}, {"_id": 0}))
    now = time.time()
    _run(srv.db.trade_journal.insert_one(_trade(1, now + 1, profit=17, account_login="1001")))
    _run(srv.db.trade_journal.insert_one(_trade(2, now + 2, profit=17, account_login="9999")))
    trades = _run(srv._fetch_period_trades(period))
    assert [t["ticket"] for t in trades] == [1]


def test_ea_version_scope_filter_excludes_other_bot_versions():
    admin = _run(_seed_admin())
    result = _run(_start_period(admin, ea_versions=["v6.25.24"]))
    period = _run(srv.db.performance_periods.find_one({"id": result["period"]["id"]}, {"_id": 0}))
    now = time.time()
    _run(srv.db.trade_journal.insert_one(_trade(1, now + 1, profit=17, ea_version="v6.25.24")))
    _run(srv.db.trade_journal.insert_one(_trade(2, now + 2, profit=17, ea_version="v6.20.0")))
    trades = _run(srv._fetch_period_trades(period))
    assert [t["ticket"] for t in trades] == [1]
