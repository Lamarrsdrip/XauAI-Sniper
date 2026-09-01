import json

from backend.local_ai import build_replay_cache
from tests.test_local_ai_schema import snapshot_raw


def test_replay_builder_is_resumable_and_writes_exact_snapshot_pairs(tmp_path, monkeypatch):
    raw = json.dumps(snapshot_raw(), separators=(",", ":"))
    source = tmp_path / "snapshots.tsv"
    source.write_text(raw + "\n" + raw + "\n", encoding="utf-8")
    output = tmp_path / "cache.tsv"
    calls = []
    responses = [
        {"status": "LOCAL_AI_PENDING", "signature": "a" * 64, "fallback": "DETERMINISTIC"},
        {
            "status": "LOCAL_AI_TRUSTED",
            "signature": "a" * 64,
            "fallback": None,
            "decision": {
                "preferred_direction": "BUY",
                "candidate_allowed": True,
                "candidate_setup": "TREND_PULLBACK",
                "market_state": "PULLBACK",
                "structure_state": "CONFIRMED",
                "momentum_state": "IMPROVING",
                "location_quality": "GOOD",
                "confidence": 76,
                "reason_codes": ["BUY_SCORE_LEADS"],
                "short_reason": "Confirmed pullback.",
            },
        },
    ]

    def fake_request(request, _timeout):
        calls.append(request)
        return responses.pop(0)

    monkeypatch.setattr(build_replay_cache, "_request_json", fake_request)
    first = build_replay_cache.build_cache(
        [source], output, "http://127.0.0.1:8765", 1.0, 1.0, 0.0, False
    )
    assert first["unique_snapshots"] == 1
    assert first["new_rows"] == 1
    assert first["paid_ai_calls"] == 0
    snapshot, response = output.read_text(encoding="utf-8").rstrip("\n").split("\t", 1)
    assert snapshot == raw
    assert json.loads(response)["decision"]["confidence"] == 76

    monkeypatch.setattr(
        build_replay_cache,
        "_request_json",
        lambda *_args: (_ for _ in ()).throw(AssertionError("resumed row must not be called")),
    )
    second = build_replay_cache.build_cache(
        [source], output, "http://127.0.0.1:8765", 1.0, 1.0, 0.0, False
    )
    assert second["preexisting_cache_rows"] == 1
    assert second["new_rows"] == 0


def test_transport_failure_is_persisted_as_deterministic_fallback(tmp_path, monkeypatch):
    raw = json.dumps(snapshot_raw(), separators=(",", ":"))
    source = tmp_path / "snapshots.tsv"
    output = tmp_path / "cache.tsv"
    source.write_text(raw + "\n", encoding="utf-8")
    monkeypatch.setattr(
        build_replay_cache,
        "_request_json",
        lambda *_args: (_ for _ in ()).throw(OSError("offline")),
    )
    summary = build_replay_cache.build_cache(
        [source], output, "http://127.0.0.1:8765", 1.0, 1.0, 0.0, False
    )
    _, response = output.read_text(encoding="utf-8").rstrip("\n").split("\t", 1)
    result = json.loads(response)
    assert result["status"] == "LOCAL_AI_FALLBACK"
    assert result["fallback"] == "DETERMINISTIC"
    assert summary["paid_ai_calls"] == 0
