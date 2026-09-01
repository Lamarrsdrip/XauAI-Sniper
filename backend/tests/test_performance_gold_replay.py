"""Tests for GET /performance/gold-replay (owner spec, 2026-08-05) -- the
real 30-day MT5 Strategy Tester replay snapshot, served as-is from the
checked-in backend/data/gold_replay_current.json file that was generated
directly from a real MT5 report (see
audits/xaucloud/30day_gold_replay_20260805/). No DB dependency -- this is a
static, periodically-refreshed snapshot, not a live query.
"""
import json
import os
import sys

import pytest

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "gold_replay_pytest")
os.environ.setdefault("JWT_SECRET", "test-secret-gold-replay")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")

import asyncio

import server as srv  # noqa: E402

_LOOP = asyncio.new_event_loop()


def _run(coro):
    return _LOOP.run_until_complete(coro)


DATA_PATH = os.path.join(BACKEND_DIR, "data", "gold_replay_current.json")


def test_snapshot_file_exists_and_is_real_looking():
    assert os.path.exists(DATA_PATH), "gold_replay_current.json must exist"
    with open(DATA_PATH) as f:
        data = json.load(f)
    assert data["meta"]["history_quality"] == "100% real ticks"
    assert data["summary"]["total_trades"] == len(data["trades"])
    assert data["summary"]["wins"] + data["summary"]["losses"] <= data["summary"]["total_trades"]
    assert data["summary"]["net_profit_usd"] == 9968.01
    assert data["summary"]["profit_factor"] == 2.12
    assert data["summary"]["total_trades"] == 44
    assert data["summary"]["wins"] == 31
    assert data["summary"]["losses"] == 13
    assert data["summary"]["equity_relative_drawdown_pct"] == 16.21
    assert data["summary"]["max_balance_drawdown_pct"] == 13.35


def test_endpoint_returns_the_snapshot_with_ok_status():
    async def go():
        result = await srv.get_performance_gold_replay()
        assert result["status"] == "ok"
        assert result["summary"]["total_trades"] > 0
        assert len(result["trades"]) == result["summary"]["total_trades"]
        assert result["meta"]["symbol"] == "XAUUSD"
    _run(go())


def test_every_trade_has_real_computed_pip_and_gold_move_fields():
    async def go():
        result = await srv.get_performance_gold_replay()
        for t in result["trades"]:
            assert t["pips"] == round(t["gold_moves"] * 10, 1)
            assert t["result"] in ("WIN", "LOSS", "BE")
            assert t["entry_price"] > 0
            assert t["exit_price"] > 0
    _run(go())


def test_missing_snapshot_file_returns_unavailable_not_error():
    async def go():
        backup = DATA_PATH + ".bak"
        os.rename(DATA_PATH, backup)
        try:
            result = await srv.get_performance_gold_replay()
            assert result["status"] == "unavailable"
        finally:
            os.rename(backup, DATA_PATH)
    _run(go())


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
