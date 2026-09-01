import json

import pytest

from backend.local_ai.schema import Decision, SCHEMA_VERSION, SchemaError, Snapshot, snapshot_signature


def snapshot_raw():
    return {
        "symbol": "XAUUSD", "closed_m10_timestamp": 1785000000,
        "recent_m10_ohlc": [[3300, 3305, 3298, 3302]], "atr": 4.2,
        "volatility_state": "NORMAL", "ema_state": "FAST_ABOVE_SLOW", "rsi": 55,
        "momentum_score": 71, "buy_score": 74, "sell_score": 42,
        "preferred_direction": "BUY", "setup": "TREND_PULLBACK", "grade": "A",
        "session": "LONDON", "regime": "TRENDING", "location": "GOOD",
        "structure_state": "CONFIRMED", "breakout_state": "NONE",
        "pullback_state": "COMPLETE", "reset_state": "CLEAR", "reward_room_r": 2.3,
        "higher_timeframe_context": "M15=BUY M30=BUY H1=NEUTRAL",
        "open_position_state": "FLAT",
        "allowed_candidate_setups": ["TREND_PULLBACK", "BREAKOUT", "M10_ORIGINATED_CANDIDATE"],
        "model_name": "qwen3-0.6b-q8",
    }


def test_snapshot_signature_is_stable_and_schema_versioned():
    first = Snapshot.parse(snapshot_raw())
    reordered = Snapshot.parse(dict(reversed(list(snapshot_raw().items()))))
    assert first.prompt_schema_version == SCHEMA_VERSION
    assert snapshot_signature(first) == snapshot_signature(reordered)


def test_signature_changes_for_required_cache_inputs():
    baseline = snapshot_signature(Snapshot.parse(snapshot_raw()))
    for field, value in {
        "closed_m10_timestamp": 1785000600, "buy_score": 75, "sell_score": 43,
        "preferred_direction": "SELL", "setup": "BREAKOUT", "grade": "A+",
        "session": "ASIA", "regime": "RANGE", "location": "LATE",
        "momentum_score": 22, "structure_state": "DEVELOPING",
        "reward_room_r": 1.2, "open_position_state": "BUY_OPEN",
        "model_name": "qwen3-1.7b-q8",
    }.items():
        changed = snapshot_raw()
        changed[field] = value
        assert snapshot_signature(Snapshot.parse(changed)) != baseline, field


def test_decision_is_exact_and_strict():
    raw = {
        "preferred_direction": "BUY", "candidate_allowed": True,
        "candidate_setup": "TREND_PULLBACK", "market_state": "PULLBACK",
        "structure_state": "CONFIRMED", "momentum_state": "IMPROVING",
        "location_quality": "GOOD", "confidence": 79,
        "reason_codes": ["BUY_SCORE_LEADS"], "short_reason": "Confirmed pullback with room.",
    }
    assert Decision.parse(json.loads(json.dumps(raw))).confidence == 79
    raw["unexpected"] = True
    with pytest.raises(SchemaError):
        Decision.parse(raw)


def test_malformed_or_out_of_range_decision_fails_closed():
    raw = {
        "preferred_direction": "BUY", "candidate_allowed": True,
        "candidate_setup": "TREND_PULLBACK", "market_state": "PULLBACK",
        "structure_state": "CONFIRMED", "momentum_state": "IMPROVING",
        "location_quality": "GOOD", "confidence": 101,
        "reason_codes": [], "short_reason": "No.",
    }
    with pytest.raises(SchemaError):
        Decision.parse(raw)
