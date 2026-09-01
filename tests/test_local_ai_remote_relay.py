from copy import deepcopy
import base64
import hashlib
import urllib.parse

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from backend.local_ai.remote_relay import sanitize_worker_result
from backend.local_ai.remote_worker import RelayClient
from backend.local_ai.schema import Snapshot, snapshot_signature
from tests.test_local_ai_schema import snapshot_raw


def trusted_result(confidence=82):
    snapshot = Snapshot.parse(snapshot_raw())
    return snapshot, {
        "status": "LOCAL_AI_TRUSTED",
        "fallback": None,
        "signature": snapshot_signature(snapshot),
        "cache_hit": False,
        "latency_ms": 1234.5,
        "confidence_threshold": 70,
        "decision": {
            "preferred_direction": "BUY",
            "candidate_allowed": True,
            "candidate_setup": "TREND_PULLBACK",
            "market_state": "PULLBACK",
            "structure_state": "CONFIRMED",
            "momentum_state": "IMPROVING",
            "location_quality": "GOOD",
            "confidence": confidence,
            "reason_codes": ["BUY_SCORE_LEADS"],
            "short_reason": "M10 structure agrees with the existing setup.",
        },
    }


def test_worker_result_is_strictly_validated_and_minimized():
    snapshot, raw = trusted_result()
    raw["untrusted_extra"] = "discard me"
    result = sanitize_worker_result(raw, snapshot_signature(snapshot), snapshot)
    assert result["status"] == "LOCAL_AI_TRUSTED"
    assert result["decision"]["confidence"] == 82
    assert "untrusted_extra" not in result


def test_worker_cannot_mark_below_70_as_trusted():
    snapshot, raw = trusted_result(69)
    result = sanitize_worker_result(raw, snapshot_signature(snapshot), snapshot)
    assert result["status"] == "LOCAL_AI_LOW_CONFIDENCE"
    assert result["fallback"] == "DETERMINISTIC"


def test_worker_signature_mismatch_is_rejected():
    snapshot, raw = trusted_result()
    raw["signature"] = "0" * 64
    with pytest.raises(ValueError, match="signature mismatch"):
        sanitize_worker_result(raw, snapshot_signature(snapshot), snapshot)


def test_worker_cannot_invent_a_setup_outside_existing_engine():
    snapshot, raw = trusted_result()
    bad = deepcopy(raw)
    bad["decision"]["candidate_setup"] = "INVENTED_STRATEGY"
    with pytest.raises(ValueError, match="allowed setup"):
        sanitize_worker_result(bad, snapshot_signature(snapshot), snapshot)


def test_terminal_fallback_stays_deterministic_and_is_bounded():
    snapshot, raw = trusted_result()
    result = sanitize_worker_result({
        "status": "LOCAL_AI_FALLBACK", "fallback": "DETERMINISTIC",
        "signature": snapshot_signature(snapshot), "reason": "RESOURCE_GUARD",
    }, snapshot_signature(snapshot), snapshot)
    assert result == {
        "status": "LOCAL_AI_FALLBACK", "fallback": "DETERMINISTIC",
        "signature": snapshot_signature(snapshot), "reason": "RESOURCE_GUARD",
    }


def test_pending_worker_result_cannot_be_persisted_as_complete():
    snapshot, raw = trusted_result()
    raw["status"] = "LOCAL_AI_PENDING"
    with pytest.raises(ValueError, match="not terminal"):
        sanitize_worker_result(raw, snapshot_signature(snapshot), snapshot)


def test_worker_claim_is_signed_over_exact_method_path_timestamp_nonce_and_body(tmp_path, monkeypatch):
    private_key = Ed25519PrivateKey.generate()
    key_path = tmp_path / "worker.pem"
    key_path.write_bytes(private_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ))
    captured = {}

    class Response:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self):
            return b'{"status":"IDLE"}'

    def fake_urlopen(request, timeout):
        captured["request"] = request
        captured["timeout"] = timeout
        return Response()

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    client = RelayClient("https://xauaisniper.com", "http://127.0.0.1:8765", "",
                         "test-worker", str(key_path))
    assert client.claim()["status"] == "IDLE"
    request = captured["request"]
    timestamp = request.get_header("X-xau-worker-timestamp")
    nonce = request.get_header("X-xau-worker-nonce")
    signature = base64.b64decode(request.get_header("X-xau-worker-signature"))
    canonical = (
        f"POST\n{urllib.parse.urlparse(request.full_url).path}\n{timestamp}\n{nonce}\n"
        f"{hashlib.sha256(request.data).hexdigest()}"
    ).encode()
    private_key.public_key().verify(signature, canonical)
