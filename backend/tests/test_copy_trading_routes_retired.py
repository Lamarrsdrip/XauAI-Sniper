"""Real, executable negative tests for the v6.25.3 Phase 5 (P0) copy-trading
deletion (final pre-launch hardening).

Proves at the real HTTP-routing level (via FastAPI's TestClient against the
actual `app` object, not just "the Python function is gone") that every
retired copy-trading route is genuinely unavailable in the running
application -- returns 404 (FastAPI's real "no such route" response, since
these paths are no longer registered at all) rather than merely being
unreachable from the frontend. Also proves the kept, still-needed routes
are still registered and reachable, so this is a real before/after
contrast, not a test that would pass on an empty app.
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


pytestmark = pytest.mark.skipif(not _mongo_available(), reason="no local MongoDB reachable for this live route-retirement test")

TEST_DB = f"routes_retired_pytest_{uuid.uuid4().hex[:10]}"
os.environ["MONGO_URL"] = "mongodb://localhost:27017"
os.environ["DB_NAME"] = TEST_DB
os.environ.setdefault("JWT_SECRET", "test-secret-routes-retired")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")

import server as srv  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

client = TestClient(srv.app)

RETIRED_ROUTES = [
    ("POST", "/api/cloud/mt5/connect"),
    ("GET",  "/api/cloud/mt5/brokers"),
    ("GET",  "/api/cloud/mt5/compatibility"),
    ("POST", "/api/cloud/mt5/test-connection"),
    ("GET",  "/api/cloud/mt5/logs"),
    ("POST", "/api/cloud/mt5/refresh-balance"),
    ("POST", "/api/cloud/mt5/disconnect"),
    ("POST", "/api/cloud/pause"),
    ("GET",  "/api/cloud/dashboard"),
    ("GET",  "/api/cloud/config"),
    ("POST", "/api/cloud/payments/submit"),
    ("GET",  "/api/cloud/payments/my"),
    ("GET",  "/api/admin/cloud/users"),
    ("GET",  "/api/admin/cloud/stats"),
    ("GET",  "/api/admin/cloud/payments"),
    ("POST", "/api/admin/cloud/payments/x/approve"),
    ("POST", "/api/admin/cloud/payments/x/reject"),
    ("GET",  "/api/admin/cloud/settings"),
    ("PUT",  "/api/admin/cloud/settings"),
    ("POST", "/api/admin/cloud/users/override"),
    ("GET",  "/api/admin/cloud/infrastructure"),
    ("POST", "/api/admin/cloud/infrastructure/workers"),
    ("DELETE", "/api/admin/cloud/infrastructure/workers/x"),
    ("POST", "/api/admin/cloud/infrastructure/rotate-token"),
    ("POST", "/api/admin/cloud/infrastructure/pair-code"),
    ("POST", "/api/admin/cloud/infrastructure/shadow-mode"),
    ("POST", "/api/admin/cloud/infrastructure/test-signal"),
    ("POST", "/api/cloud/agent/pair"),
    ("GET",  "/api/admin/cloud/bot-mode"),
    ("POST", "/api/admin/cloud/bot-mode"),
    ("GET",  "/api/cloud/master/config"),
    ("POST", "/api/cloud/master/reasoning"),
    ("GET",  "/api/cloud/me/reasoning"),
    ("GET",  "/api/cloud/agent/pending-users"),
    ("GET",  "/api/cloud/agent/pending-signals"),
    ("GET",  "/api/cloud/agent/verify-queue"),
    ("POST", "/api/cloud/agent/signal-status"),
    ("POST", "/api/admin/cloud/force-close-user"),
    ("GET",  "/api/cloud/agent/force-close-queue"),
    ("POST", "/api/cloud/agent/force-close-ack"),
    ("POST", "/api/cloud/agent/account-status"),
    ("POST", "/api/cloud/agent/verify-credentials"),
    ("GET",  "/api/cloud/agent/refresh-queue"),
    ("POST", "/api/cloud/agent/trade-close"),
    ("POST", "/api/cloud/agent/trade-partial"),
    ("POST", "/api/cloud/agent/trade-open"),
    ("GET",  "/api/admin/cloud/fanout-logs"),
    ("GET",  "/api/admin/cloud/diagnostics"),
    ("POST", "/api/cloud/agent/equity-snapshot"),
    ("GET",  "/api/admin/cloud/orphans"),
    ("POST", "/api/cloud/agent/heartbeat"),
]

# Routes that must still exist and be reachable -- proves this isn't a test
# that trivially "passes" because the whole app is broken/empty.
KEPT_ROUTES = [
    ("POST", "/api/cloud/auth/signup"),
    ("POST", "/api/cloud/auth/login"),
    ("GET",  "/api/cloud/auth/me"),
    ("POST", "/api/cloud/license/link"),
    ("GET",  "/api/cloud/license/status"),
    ("GET",  "/api/cloud/trading-universe"),
    ("POST", "/api/cloud/monitor/heartbeat"),
    ("POST", "/api/cloud/monitor/activity"),
    ("GET",  "/api/cloud/monitor/status"),
    ("POST", "/api/cloud/reservation/claim"),
    ("POST", "/api/cloud/reservation/release"),
    ("POST", "/api/pins/validate"),
    ("POST", "/api/webhook/paystack"),
    ("POST", "/api/download/request-token"),
    ("GET",  "/api/download/ea-release"),
]


@pytest.mark.parametrize("method,path", RETIRED_ROUTES)
def test_retired_copy_trading_route_returns_404(method, path):
    resp = client.request(method, path)
    assert resp.status_code == 404, f"{method} {path} still resolves (status={resp.status_code}) -- should be 404 (route removed)"


@pytest.mark.parametrize("method,path", KEPT_ROUTES)
def test_kept_local_ea_route_still_resolves(method, path):
    resp = client.request(method, path)
    # Not 404 -- the route exists and is handled (may be 401/403/422/400/200
    # depending on auth/validation, none of which is "route doesn't exist").
    assert resp.status_code != 404, f"{method} {path} unexpectedly returns 404 -- did a kept route get deleted too?"


def test_retired_download_ea_endpoint_returns_410_not_404():
    # download_ea_retired()/download_package_retired() are DEFINED (not
    # removed) specifically to return an explicit, permanent 410 Gone with
    # guidance, distinct from a route that was simply deleted (404).
    resp = client.get("/api/download/ea")
    assert resp.status_code == 410
    resp2 = client.get("/api/download/package")
    assert resp2.status_code == 410
    resp3 = client.get("/api/download/xauindex/ea")
    assert resp3.status_code == 410


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
