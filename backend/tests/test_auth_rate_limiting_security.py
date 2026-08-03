"""Real, executable tests for the v6.25.3 Phase 6 (P0) auth-hardening work
(final pre-launch hardening): dependency-free in-memory rate limiting and
login audit logging.

Root motivation: none of admin login, cloud signup, cloud login, license
linking, purchase initialize/verify, remote command requests, or the
Outlook "send test notification" endpoint had any brute-force/abuse
protection at all -- an attacker (or a buggy/compromised frontend build)
could hammer any of them without limit. This also deliberately avoids a
new pip dependency (slowapi/limits), since the earlier real production
outage this session traced back to `pywebpush` being declared in
requirements.txt but never actually installed in the deployed environment
-- one more "not actually installed in prod" package is exactly the wrong
fix for this codebase.

Covers:
- _rate_limit()/_client_ip() unit behavior (window expiry, independent
  keys, X-Forwarded-For preference)
- admin login: IP+email rate limiting, 429 after threshold, audit log
  entries written on both failure and success
- cloud signup: IP rate limiting
- cloud login: IP+email rate limiting, audit log entries
- cloud license link: per-user rate limiting
- cloud command request: per-user rate limiting
- Outlook "send test notification": per-user rate limiting

Calls the real async endpoint functions directly against a live local
MongoDB (skips cleanly if none reachable), the same pattern proven to work
in test_paystack_payment_security.py/test_license_binding_security.py --
NOT FastAPI's TestClient, which in this environment runs the ASGI app in a
separate thread/event loop that motor's AsyncIOMotorClient does not
reliably share (observed directly while writing this file: "Event loop is
closed" / "attached to a different loop" errors on the very first
DB-touching request via TestClient).
"""
import sys
import os
import time
import uuid
import asyncio
from unittest.mock import MagicMock

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


pytestmark = pytest.mark.skipif(not _mongo_available(), reason="no local MongoDB reachable for this live rate-limiting test")

TEST_DB = f"rate_limit_pytest_{uuid.uuid4().hex[:10]}"
os.environ["MONGO_URL"] = "mongodb://localhost:27017"
os.environ["DB_NAME"] = TEST_DB
os.environ.setdefault("JWT_SECRET", "test-secret-rate-limit")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")

import server as srv  # noqa: E402
from fastapi import HTTPException, Response  # noqa: E402
import market_outlook_routes as _mo_routes  # noqa: E402

_LOOP = asyncio.new_event_loop()


def _run(coro):
    return _LOOP.run_until_complete(coro)


class _FakeRequest:
    """Minimal stand-in for FastAPI's Request -- only headers/client are
    used by _client_ip()."""
    def __init__(self, ip: str = "1.2.3.4", forwarded_for: str = ""):
        self.headers = {"X-Forwarded-For": forwarded_for} if forwarded_for else {}
        self.client = MagicMock(host=ip)


_outlook_router = _mo_routes.build_router()
_send_test_notification_route = next(
    r.endpoint for r in _outlook_router.routes if r.path == "/outlook/notifications/test")


def _reset():
    srv._rate_limit_buckets.clear()


async def _clear_db():
    await srv.db.users.delete_many({})
    await srv.db.cloud_users.delete_many({})
    await srv.db.login_audit_log.delete_many({})


def setup_function(_fn):
    _reset()
    _run(_clear_db())


# ---------------------------------------------------------------------
# _rate_limit() / _client_ip() unit behavior
# ---------------------------------------------------------------------

def test_rate_limit_allows_up_to_max_then_raises_429():
    key = f"unit_test_{uuid.uuid4().hex[:8]}"
    for _ in range(5):
        srv._rate_limit(key, max_requests=5, window_seconds=60)
    with pytest.raises(HTTPException) as exc:
        srv._rate_limit(key, max_requests=5, window_seconds=60)
    assert exc.value.status_code == 429


def test_rate_limit_keys_are_independent():
    key_a = f"unit_a_{uuid.uuid4().hex[:8]}"
    key_b = f"unit_b_{uuid.uuid4().hex[:8]}"
    for _ in range(5):
        srv._rate_limit(key_a, max_requests=5, window_seconds=60)
    # key_b has never been touched -- must not be affected by key_a's bucket.
    srv._rate_limit(key_b, max_requests=5, window_seconds=60)


def test_rate_limit_window_expiry_allows_new_requests():
    key = f"unit_window_{uuid.uuid4().hex[:8]}"
    for _ in range(3):
        srv._rate_limit(key, max_requests=3, window_seconds=1)
    with pytest.raises(HTTPException):
        srv._rate_limit(key, max_requests=3, window_seconds=1)
    time.sleep(1.1)
    # Old timestamps are now outside the 1s window -- should succeed again.
    srv._rate_limit(key, max_requests=3, window_seconds=1)


def test_client_ip_prefers_x_forwarded_for():
    req = _FakeRequest(ip="9.9.9.9", forwarded_for="5.6.7.8, 9.9.9.9")
    assert srv._client_ip(req) == "5.6.7.8"


def test_client_ip_falls_back_to_request_client_host():
    req = _FakeRequest(ip="10.0.0.1")
    assert srv._client_ip(req) == "10.0.0.1"


# ---------------------------------------------------------------------
# Admin login (srv.login) -- POST /api/auth/login
# ---------------------------------------------------------------------

async def _seed_admin(email="admin-ratelimit@test.com", password="CorrectHorse123"):
    await srv.db.users.insert_one({
        "_id": str(uuid.uuid4()), "email": email,
        "password_hash": srv.hash_password(password), "name": "Admin", "role": "admin",
    })


def test_admin_login_rate_limited_by_email_after_threshold():
    _run(_seed_admin())
    email = "admin-ratelimit@test.com"
    req = srv.LoginRequest(email=email, password="wrong-pw")
    fake_req = _FakeRequest(ip="20.20.20.20")
    for i in range(5):
        with pytest.raises(HTTPException) as exc:
            _run(srv.login(req, fake_req))
        assert exc.value.status_code == 401, f"attempt {i}: expected 401"
    with pytest.raises(HTTPException) as exc:
        _run(srv.login(req, fake_req))
    assert exc.value.status_code == 429


def test_admin_login_audit_log_records_failures_and_stops_at_rate_limit():
    _run(_seed_admin())
    email = "admin-ratelimit@test.com"
    req = srv.LoginRequest(email=email, password="wrong-pw")
    fake_req = _FakeRequest(ip="21.21.21.21")
    for _ in range(6):  # 6th is rate-limited, never reaches the audit-log insert
        try:
            _run(srv.login(req, fake_req))
        except HTTPException:
            pass

    async def count():
        return await srv.db.login_audit_log.count_documents({"email": email, "ok": False})
    assert _run(count()) == 5


def test_admin_login_audit_log_records_success():
    _run(_seed_admin(email="admin-success@test.com", password="CorrectHorse123"))
    req = srv.LoginRequest(email="admin-success@test.com", password="CorrectHorse123")
    resp = _run(srv.login(req, _FakeRequest(ip="22.22.22.22")))
    assert resp.status_code == 200

    async def find():
        return await srv.db.login_audit_log.find_one({"email": "admin-success@test.com", "ok": True})
    doc = _run(find())
    assert doc is not None
    assert doc["role"] == "admin"


# ---------------------------------------------------------------------
# Cloud signup (srv.cloud_signup) -- POST /api/cloud/auth/signup
# ---------------------------------------------------------------------

def test_cloud_signup_rate_limited_by_ip_after_threshold():
    fake_req = _FakeRequest(ip="44.44.44.44")
    for i in range(10):
        req = srv.CloudSignupReq(email=f"signup{i}-{uuid.uuid4().hex[:6]}@test.com", password="Password123")
        resp = _run(srv.cloud_signup(req, Response(), fake_req))
        assert resp["ok"] is True, f"attempt {i}: expected success"
    over_req = srv.CloudSignupReq(email=f"signup-over-{uuid.uuid4().hex[:6]}@test.com", password="Password123")
    with pytest.raises(HTTPException) as exc:
        _run(srv.cloud_signup(over_req, Response(), fake_req))
    assert exc.value.status_code == 429


# ---------------------------------------------------------------------
# Cloud login (srv.cloud_login) -- POST /api/cloud/auth/login
# ---------------------------------------------------------------------

async def _seed_cloud_user(email="cloud-ratelimit@test.com", password="Password123"):
    uid = str(uuid.uuid4())
    await srv.db.cloud_users.insert_one({
        "id": uid, "email": email, "password_hash": srv.hash_password(password),
        "full_name": "Test", "country": "", "created_at": "2026-07-17T00:00:00Z",
        "last_login_at": "2026-07-17T00:00:00Z",
    })
    return uid


def test_cloud_login_rate_limited_by_email_after_threshold():
    _run(_seed_cloud_user())
    email = "cloud-ratelimit@test.com"
    fake_req = _FakeRequest(ip="30.30.30.30")
    for i in range(5):
        req = srv.CloudLoginReq(email=email, password="wrong-pw")
        with pytest.raises(HTTPException) as exc:
            _run(srv.cloud_login(req, Response(), fake_req))
        assert exc.value.status_code == 401, f"attempt {i}: expected 401"
    req = srv.CloudLoginReq(email=email, password="wrong-pw")
    with pytest.raises(HTTPException) as exc:
        _run(srv.cloud_login(req, Response(), fake_req))
    assert exc.value.status_code == 429


def test_cloud_login_audit_log_records_success():
    _run(_seed_cloud_user(email="cloud-success@test.com"))
    req = srv.CloudLoginReq(email="cloud-success@test.com", password="Password123")
    resp = _run(srv.cloud_login(req, Response(), _FakeRequest(ip="31.31.31.31")))
    assert resp["ok"] is True

    async def find():
        return await srv.db.login_audit_log.find_one({"email": "cloud-success@test.com", "ok": True})
    doc = _run(find())
    assert doc is not None
    assert doc["role"] == "cloud_user"


# ---------------------------------------------------------------------
# Cloud license link (srv.cloud_license_link) -- per-user rate limit
# ---------------------------------------------------------------------

def _make_user_dict(email):
    uid = _run(_seed_cloud_user(email=email))
    return {"id": uid, "email": email}


def test_cloud_license_link_rate_limited_per_user():
    user = _make_user_dict("license-link@test.com")
    req = srv.CloudLicenseLinkReq(license_key="NOT-A-REAL-KEY")
    for i in range(10):
        with pytest.raises(HTTPException) as exc:
            _run(srv.cloud_license_link(req, user))
        assert exc.value.status_code != 429, f"attempt {i}: unexpectedly rate-limited early"
    with pytest.raises(HTTPException) as exc:
        _run(srv.cloud_license_link(req, user))
    assert exc.value.status_code == 429


def test_cloud_license_link_rate_limit_is_per_user_not_global():
    user_a = _make_user_dict("license-link-a@test.com")
    user_b = _make_user_dict("license-link-b@test.com")
    req = srv.CloudLicenseLinkReq(license_key="NOT-A-REAL-KEY")
    for _ in range(10):
        try:
            _run(srv.cloud_license_link(req, user_a))
        except HTTPException:
            pass
    # user A is now at the limit; user B must be unaffected.
    with pytest.raises(HTTPException) as exc:
        _run(srv.cloud_license_link(req, user_b))
    assert exc.value.status_code != 429


# ---------------------------------------------------------------------
# Cloud command request (srv.cloud_command_request) -- per-user rate limit
# ---------------------------------------------------------------------

def test_cloud_command_request_rate_limited_per_user():
    user = _make_user_dict("command-request@test.com")
    req = srv.CloudCommandReq(action="NOT_A_REAL_ACTION", pin="x", confirm=True)
    for i in range(20):
        with pytest.raises(HTTPException) as exc:
            _run(srv.cloud_command_request(req, user))
        assert exc.value.status_code == 400, f"attempt {i}: expected 400 (unsupported action)"
    with pytest.raises(HTTPException) as exc:
        _run(srv.cloud_command_request(req, user))
    assert exc.value.status_code == 429


# ---------------------------------------------------------------------
# Outlook "send test notification" -- per-user rate limit
# ---------------------------------------------------------------------

def test_notification_test_rate_limited_per_user():
    user = _make_user_dict("notif-test@test.com")
    for i in range(5):
        result = _run(_send_test_notification_route(user))
        assert result is not None, f"attempt {i}: unexpectedly rate-limited early"
    with pytest.raises(HTTPException) as exc:
        _run(_send_test_notification_route(user))
    assert exc.value.status_code == 429


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
