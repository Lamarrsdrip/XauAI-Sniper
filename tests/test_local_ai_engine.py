from pathlib import Path
import time

from backend.local_ai.schema import Decision
from backend.local_ai.service import LocalAIEngine, _fail_closed_relationship, _set_below_normal_priority
from tests.test_local_ai_schema import snapshot_raw


def decision(confidence=79):
    return Decision.parse({
        "preferred_direction": "BUY", "candidate_allowed": True,
        "candidate_setup": "TREND_PULLBACK", "market_state": "PULLBACK",
        "structure_state": "CONFIRMED", "momentum_state": "IMPROVING",
        "location_quality": "GOOD", "confidence": confidence,
        "reason_codes": ["BUY_SCORE_LEADS"], "short_reason": "Confirmed pullback with room.",
    })


def engine(tmp_path: Path) -> LocalAIEngine:
    result = LocalAIEngine("http://127.0.0.1:1", tmp_path / "cache.sqlite3")
    result.probe.sample = lambda: {"cpu_percent": 1.0, "free_ram_gb": 8.0, "total_ram_gb": 16.0}
    return result


def test_valid_decision_is_cached_and_duplicate_cycle_does_not_call_model(tmp_path):
    service = engine(tmp_path)
    calls = 0

    def fake_call(_snapshot):
        nonlocal calls
        calls += 1
        return decision()

    service._call_runtime = fake_call
    first, first_status = service.decide(snapshot_raw())
    second, second_status = service.decide(snapshot_raw())
    assert first_status == second_status == 200
    assert first["status"] == second["status"] == "LOCAL_AI_TRUSTED"
    assert first["cache_hit"] is False
    assert second["cache_hit"] is True
    assert calls == 1


def test_below_70_confidence_is_deterministic_fallback_and_still_cached(tmp_path):
    service = engine(tmp_path)
    service._call_runtime = lambda _snapshot: decision(69)
    result, status = service.decide(snapshot_raw())
    assert status == 200
    assert result["status"] == "LOCAL_AI_LOW_CONFIDENCE"
    assert result["fallback"] == "DETERMINISTIC"
    cached, _ = service.decide(snapshot_raw())
    assert cached["cache_hit"] is True
    assert cached["fallback"] == "DETERMINISTIC"


def test_resource_guard_never_calls_model(tmp_path):
    service = engine(tmp_path)
    service.probe.sample = lambda: {"cpu_percent": 90.0, "free_ram_gb": 1.0, "total_ram_gb": 8.0}
    service._call_runtime = lambda _snapshot: (_ for _ in ()).throw(AssertionError("must not call"))
    result, status = service.decide(snapshot_raw())
    assert status == 200
    assert result["status"] == "LOCAL_AI_FALLBACK"
    assert result["reason"] == "RESOURCE_GUARD"
    assert service.stats()["load_skips"] == 1


def test_unavailable_runtime_returns_deterministic_fallback(tmp_path):
    service = engine(tmp_path)
    result, status = service.decide(snapshot_raw())
    assert status == 200
    assert result["status"] == "LOCAL_AI_FALLBACK"
    assert result["fallback"] == "DETERMINISTIC"


def test_async_submit_returns_immediately_then_exposes_cached_result(tmp_path):
    service = engine(tmp_path)
    service._call_runtime = lambda _snapshot: decision(81)
    started = time.perf_counter()
    submitted, status = service.submit(snapshot_raw())
    assert status == 202
    assert submitted["status"] == "LOCAL_AI_PENDING"
    assert time.perf_counter() - started < 0.2
    signature = submitted["signature"]
    for _ in range(100):
        result, result_status = service.result(signature)
        if result_status == 200:
            break
        time.sleep(0.01)
    assert result_status == 200
    assert result["status"] == "LOCAL_AI_TRUSTED"


def test_async_queue_never_accepts_second_inference(tmp_path):
    service = engine(tmp_path)
    release = False

    def slow(_snapshot):
        nonlocal release
        for _ in range(200):
            if release:
                break
            time.sleep(0.005)
        return decision()

    service._call_runtime = slow
    first, _ = service.submit(snapshot_raw())
    other = snapshot_raw()
    other["closed_m10_timestamp"] += 600
    second, _ = service.submit(other)
    release = True
    assert first["status"] == "LOCAL_AI_PENDING"
    assert second["status"] == "LOCAL_AI_FALLBACK"
    assert second["reason"] == "QUEUE_FULL"


def test_contradictory_model_candidate_is_normalized_fail_closed():
    raw = decision(91).as_dict()
    raw["candidate_setup"] = "NONE"
    normalized = _fail_closed_relationship(Decision.parse(raw))
    assert normalized.candidate_allowed is False
    assert normalized.candidate_setup == "NONE"
    assert "MODEL_CONTRADICTION_FAIL_CLOSED" in normalized.reason_codes


def test_consistent_model_candidate_is_not_changed():
    original = decision(91)
    assert _fail_closed_relationship(original) == original


def test_process_priority_helper_is_safe_off_windows():
    assert _set_below_normal_priority() is True
