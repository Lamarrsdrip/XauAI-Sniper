"""Tests for the authoritative customer-facing release identity and
production-timeframe reconciliation (backend/server.py).

Root problem fixed: the Command Center header used to render
heartbeat.ea_version and heartbeat.timeframe directly -- raw, unvalidated
telemetry self-reported by whatever EA build is currently attached. An
internal experiment build (e.g. "V6.25.24_M10_FIXED10SL_EXPERIMENT") or a
stray M5 test bot connected to the same account/license would overwrite the
customer-facing status with no cross-check against the published release
manifest or the product's M10-only policy. These pure functions are the
fix: build_public_release_display() derives a short "XauCloud-<version>"
name only from the release manifest, never from live EA telemetry;
reconcile_production_timeframe() prevents an unrecognized/mismatched build
from ever overwriting the customer-facing production timeframe.

Uses a live local MongoDB in an isolated database (skips cleanly if none
reachable), same convention as test_download_security.py.
"""
import sys
import os
import uuid

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


pytestmark = pytest.mark.skipif(not _mongo_available(), reason="no local MongoDB reachable for this live server.py import")

TEST_DB = f"release_pytest_{uuid.uuid4().hex[:10]}"
os.environ["MONGO_URL"] = "mongodb://localhost:27017"
os.environ["DB_NAME"] = TEST_DB
os.environ.setdefault("JWT_SECRET", "test-secret-release")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")

import server as srv  # noqa: E402


# ---------------------------------------------------------------------------
# publicVersion / publicDisplayName -- single authoritative source
# ---------------------------------------------------------------------------

def test_public_display_name_is_short_xaucloud_format_not_internal_build_string():
    release = srv.build_public_release_display("V6.25.24_M10_FIXED10SL_EXPERIMENT")
    assert release["public_product_name"] == "XauCloud"
    assert release["public_display_name"].startswith("XauCloud-")
    # never the raw internal experiment string
    assert "FIXED10SL" not in release["public_display_name"]
    assert "EXPERIMENT" not in release["public_display_name"]


def test_public_version_comes_from_manifest_not_reported_ea_version():
    manifest_version = srv._normalize_release_version((srv._current_ea_release() or {}).get("version") or "")
    release_from_matching_build = srv.build_public_release_display(manifest_version)
    release_from_bogus_build = srv.build_public_release_display("totally-different-string-9999")
    # the manifest-derived public version must be identical regardless of
    # what the live EA happens to report -- it never reads ea_version for
    # the version number itself, only to classify recognized/unrecognized
    assert release_from_matching_build["public_version"] == release_from_bogus_build["public_version"]


def test_future_manifest_versions_render_automatically():
    # No frontend/backend code should hardcode a version string -- proven
    # here by confirming the format function is purely a string transform
    # of whatever _current_ea_release() returns, with no version literals
    # inside build_public_release_display itself.
    import inspect
    src = inspect.getsource(srv.build_public_release_display)
    for literal in ("6.25.24", "6.25.25", "6.26.0", "7.0.0"):
        assert literal not in src


def test_unrecognized_build_is_not_marked_recognized():
    release = srv.build_public_release_display("some-internal-experiment-build-tag")
    assert release["reported_build_recognized"] is False


def test_recognized_build_matching_manifest_is_marked_recognized():
    known_version = next(iter((srv._load_ea_release_manifest().get("releases") or {}).keys()), None)
    if not known_version:
        pytest.skip("no releases in manifest to test against")
    release = srv.build_public_release_display(known_version)
    assert release["reported_build_recognized"] is True


def test_product_qualified_xaucloud_build_is_recognized():
    release = srv.build_public_release_display("XauCloud-m10_v6.25.31")
    assert srv._normalize_release_version("XauCloud-m10_v6.25.31") == "6.25.31"
    assert release["reported_build_recognized"] is True


def test_empty_ea_version_is_not_recognized_but_still_has_a_public_display_name():
    release = srv.build_public_release_display("")
    assert release["reported_build_recognized"] is False
    assert release["public_display_name"].startswith("XauCloud")


# ---------------------------------------------------------------------------
# Production timeframe reconciliation -- M5 must never overwrite M10 status
# ---------------------------------------------------------------------------

def test_production_timeframe_constant_is_m10():
    assert srv.PRODUCTION_TIMEFRAME == "M10"


def test_matching_recognized_build_timeframe_is_trusted():
    result = srv.reconcile_production_timeframe("M10", build_recognized=True)
    assert result["display_timeframe"] == "M10"
    assert result["timeframe_mismatch"] is False


def test_m5_from_unrecognized_build_never_overwrites_customer_facing_m10():
    # This is the exact regression: an experimental M5 bot attached to the
    # account must never cause the customer-facing header to show M5.
    result = srv.reconcile_production_timeframe("M5", build_recognized=False)
    assert result["display_timeframe"] == "M10"
    assert result["reported_timeframe"] == "M5"
    assert result["timeframe_mismatch"] is True


def test_m5_from_recognized_build_still_flagged_as_mismatch_not_hidden():
    # Even if the build IS a known manifest release, a non-M10 report is
    # real signal (fix root cause, don't hardcode away the evidence) -- it
    # must still be surfaced as a mismatch, and the customer-facing value
    # still falls back to the authoritative M10 policy.
    result = srv.reconcile_production_timeframe("M5", build_recognized=True)
    assert result["display_timeframe"] == "M10"
    assert result["timeframe_mismatch"] is True


def test_missing_timeframe_is_not_reported_as_a_mismatch():
    result = srv.reconcile_production_timeframe("", build_recognized=False)
    assert result["timeframe_mismatch"] is False
    assert result["reported_timeframe"] is None
    assert result["display_timeframe"] == "M10"


def test_case_insensitive_timeframe_match():
    result = srv.reconcile_production_timeframe("m10", build_recognized=True)
    assert result["display_timeframe"] == "M10"
    assert result["timeframe_mismatch"] is False


# ---------------------------------------------------------------------------
# /cloud/monitor/status wiring -- source-level check that the endpoint uses
# the reconciled values, not raw heartbeat fields, for customer identity
# ---------------------------------------------------------------------------

def test_monitor_status_endpoint_returns_release_and_production_status_blocks():
    import re
    src = open(os.path.join(BACKEND_DIR, "server.py"), encoding="utf-8").read()
    fn = src[src.index("async def cloud_monitor_status("):]
    fn_body = fn[:fn.index("\n@api_router.get(\"/cloud/monitor/activity\")")]
    assert "build_public_release_display((hb or {}).get(\"ea_version\", \"\"))" in fn_body
    assert "reconcile_production_timeframe(" in fn_body
    assert '"release": release_display' in fn_body
    assert '"production_status": production_status' in fn_body
