"""Real, executable tests for the v6.25.3 Phase 6 (P0) admin MFA/TOTP flow
(final pre-launch hardening).

RFC 6238 TOTP implemented with stdlib hmac/hashlib/base64/struct only --
no new pip dependency (see server.py's own comment on why: a package
declared in requirements.txt but never actually installed in production
caused a real outage earlier in this project).

Uses a live local MongoDB in an isolated database (skips cleanly if none
reachable).
"""
import sys
import os
import uuid
import time
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

TEST_DB = f"mfa_pytest_{uuid.uuid4().hex[:10]}"
os.environ["MONGO_URL"] = "mongodb://localhost:27017"
os.environ["DB_NAME"] = TEST_DB
os.environ.setdefault("JWT_SECRET", "test-secret-mfa")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")

import server as srv  # noqa: E402
from fastapi import HTTPException  # noqa: E402
from unittest.mock import MagicMock  # noqa: E402

_LOOP = asyncio.new_event_loop()


def _run(coro):
    return _LOOP.run_until_complete(coro)


class _FakeRequest:
    def __init__(self, ip="1.2.3.4"):
        self.headers = {}
        self.client = MagicMock(host=ip)


def _reset():
    srv._rate_limit_buckets.clear()


async def _clear():
    await srv.db.users.delete_many({})
    await srv.db.login_audit_log.delete_many({})


def setup_function(_fn):
    _reset()
    _run(_clear())


async def _seed_admin(email="mfa-admin@test.com", password="AdminPass123"):
    await srv.db.users.insert_one({
        "email": email, "password_hash": srv.hash_password(password),
        "name": "Admin", "role": "admin", "created_at": "2026-07-17T00:00:00Z",
    })


async def _get_current_admin_dict(email):
    return await srv.db.users.find_one({"email": email}, {"_id": 0, "password_hash": 0})


# ---------------------------------------------------------------------
# TOTP math itself
# ---------------------------------------------------------------------

def test_totp_code_is_deterministic_for_a_given_time():
    secret = srv._generate_totp_secret()
    now = time.time()
    code_a = srv._totp_code(secret, now)
    code_b = srv._totp_code(secret, now)
    assert code_a == code_b
    assert len(code_a) == 6
    assert code_a.isdigit()


def test_totp_code_changes_across_periods():
    secret = srv._generate_totp_secret()
    now = time.time()
    code_now = srv._totp_code(secret, now)
    code_far_future = srv._totp_code(secret, now + 3600)
    assert code_now != code_far_future


def test_verify_totp_accepts_current_code():
    secret = srv._generate_totp_secret()
    code = srv._totp_code(secret, time.time())
    assert srv._verify_totp(secret, code) is True


def test_verify_totp_rejects_wrong_code():
    secret = srv._generate_totp_secret()
    assert srv._verify_totp(secret, "000000") is False


def test_verify_totp_rejects_non_numeric():
    secret = srv._generate_totp_secret()
    assert srv._verify_totp(secret, "abcdef") is False


def test_verify_totp_tolerates_one_period_clock_skew():
    secret = srv._generate_totp_secret()
    code_one_period_ago = srv._totp_code(secret, time.time() - 30)
    assert srv._verify_totp(secret, code_one_period_ago, window=1) is True


# ---------------------------------------------------------------------
# Setup / enable / disable
# ---------------------------------------------------------------------

def test_mfa_setup_returns_secret_and_otpauth_uri():
    _run(_seed_admin())
    admin = _run(_get_current_admin_dict("mfa-admin@test.com"))
    result = _run(srv.admin_mfa_setup(admin))
    assert "secret" in result
    assert result["otpauth_uri"].startswith("otpauth://totp/")
    assert result["secret"] in result["otpauth_uri"]


def test_mfa_enable_requires_prior_setup():
    _run(_seed_admin())
    admin = _run(_get_current_admin_dict("mfa-admin@test.com"))
    req = srv.AdminMfaEnableReq(code="123456")
    with pytest.raises(HTTPException) as exc:
        _run(srv.admin_mfa_enable(req, admin))
    assert exc.value.status_code == 400


def test_mfa_enable_rejects_wrong_code():
    _run(_seed_admin())
    admin = _run(_get_current_admin_dict("mfa-admin@test.com"))
    _run(srv.admin_mfa_setup(admin))
    admin_after_setup = _run(_get_current_admin_dict("mfa-admin@test.com"))
    req = srv.AdminMfaEnableReq(code="000000")
    with pytest.raises(HTTPException) as exc:
        _run(srv.admin_mfa_enable(req, admin_after_setup))
    assert exc.value.status_code == 400


def test_mfa_enable_succeeds_with_correct_code():
    _run(_seed_admin())
    admin = _run(_get_current_admin_dict("mfa-admin@test.com"))
    setup_result = _run(srv.admin_mfa_setup(admin))
    admin_after_setup = _run(_get_current_admin_dict("mfa-admin@test.com"))
    code = srv._totp_code(setup_result["secret"], time.time())
    req = srv.AdminMfaEnableReq(code=code)
    result = _run(srv.admin_mfa_enable(req, admin_after_setup))
    assert result["ok"] is True

    async def check():
        return await srv.db.users.find_one({"email": "mfa-admin@test.com"})
    doc = _run(check())
    assert doc["mfa_enabled"] is True
    assert "mfa_pending_secret_enc" not in doc


def test_mfa_disable_requires_correct_password_and_code():
    _run(_seed_admin())
    admin = _run(_get_current_admin_dict("mfa-admin@test.com"))
    setup_result = _run(srv.admin_mfa_setup(admin))
    admin_after_setup = _run(_get_current_admin_dict("mfa-admin@test.com"))
    code = srv._totp_code(setup_result["secret"], time.time())
    _run(srv.admin_mfa_enable(srv.AdminMfaEnableReq(code=code), admin_after_setup))
    admin_enabled = _run(_get_current_admin_dict("mfa-admin@test.com"))

    wrong_pw_req = srv.AdminMfaDisableReq(password="WrongPassword", code=code)
    with pytest.raises(HTTPException) as exc:
        _run(srv.admin_mfa_disable(wrong_pw_req, admin_enabled))
    assert exc.value.status_code == 401

    new_code = srv._totp_code(setup_result["secret"], time.time())
    right_req = srv.AdminMfaDisableReq(password="AdminPass123", code=new_code)
    result = _run(srv.admin_mfa_disable(right_req, admin_enabled))
    assert result["ok"] is True

    async def check():
        return await srv.db.users.find_one({"email": "mfa-admin@test.com"})
    doc = _run(check())
    assert doc.get("mfa_enabled") is not True
    assert "mfa_secret_enc" not in doc


# ---------------------------------------------------------------------
# Full login flow with MFA enabled
# ---------------------------------------------------------------------

def _enable_mfa_for(email, password):
    admin = _run(_get_current_admin_dict(email))
    setup_result = _run(srv.admin_mfa_setup(admin))
    admin_after_setup = _run(_get_current_admin_dict(email))
    code = srv._totp_code(setup_result["secret"], time.time())
    _run(srv.admin_mfa_enable(srv.AdminMfaEnableReq(code=code), admin_after_setup))
    return setup_result["secret"]


def test_login_with_mfa_enabled_returns_mfa_required_not_a_session():
    _run(_seed_admin(email="mfa-login@test.com"))
    _enable_mfa_for("mfa-login@test.com", "AdminPass123")
    req = srv.LoginRequest(email="mfa-login@test.com", password="AdminPass123")
    result = _run(srv.login(req, _FakeRequest(ip="20.20.20.20")))
    assert result["mfa_required"] is True
    assert "mfa_token" in result


def test_login_mfa_completes_session_with_correct_code():
    _run(_seed_admin(email="mfa-complete@test.com"))
    secret = _enable_mfa_for("mfa-complete@test.com", "AdminPass123")
    login_req = srv.LoginRequest(email="mfa-complete@test.com", password="AdminPass123")
    login_result = _run(srv.login(login_req, _FakeRequest(ip="21.21.21.21")))
    code = srv._totp_code(secret, time.time())
    mfa_req = srv.AdminMfaLoginReq(mfa_token=login_result["mfa_token"], code=code)
    response = _run(srv.login_mfa(mfa_req, _FakeRequest(ip="21.21.21.21")))
    assert response.status_code == 200


def test_login_mfa_rejects_wrong_code():
    _run(_seed_admin(email="mfa-wrong@test.com"))
    _enable_mfa_for("mfa-wrong@test.com", "AdminPass123")
    login_req = srv.LoginRequest(email="mfa-wrong@test.com", password="AdminPass123")
    login_result = _run(srv.login(login_req, _FakeRequest(ip="22.22.22.22")))
    mfa_req = srv.AdminMfaLoginReq(mfa_token=login_result["mfa_token"], code="000000")
    with pytest.raises(HTTPException) as exc:
        _run(srv.login_mfa(mfa_req, _FakeRequest(ip="22.22.22.22")))
    assert exc.value.status_code == 401


def test_login_without_mfa_enabled_still_issues_session_directly():
    _run(_seed_admin(email="no-mfa@test.com"))
    req = srv.LoginRequest(email="no-mfa@test.com", password="AdminPass123")
    result = _run(srv.login(req, _FakeRequest(ip="23.23.23.23")))
    assert result.status_code == 200


# ---------------------------------------------------------------------
# Bug fix regression (Command Center admin audit, 2026-08-04): the frontend
# had no MFA UI at all -- an admin who completed MFA setup (via direct API
# call, since setup itself also had no UI) could pass the code challenge
# and still render as "logged in" with mfa_enabled missing from the session
# payload, so the newly-added Account tab MFA panel would incorrectly show
# "NOT ENABLED" right after a real MFA login until the next page load.
# Both session-issuing paths must carry mfa_enabled explicitly.
# ---------------------------------------------------------------------
import json  # noqa: E402


def test_direct_login_session_reports_mfa_enabled_false():
    _run(_seed_admin(email="mfa-flag-off@test.com"))
    req = srv.LoginRequest(email="mfa-flag-off@test.com", password="AdminPass123")
    response = _run(srv.login(req, _FakeRequest(ip="24.24.24.24")))
    body = json.loads(response.body)
    assert body["mfa_enabled"] is False


def test_mfa_completed_login_session_reports_mfa_enabled_true():
    _run(_seed_admin(email="mfa-flag-on@test.com"))
    secret = _enable_mfa_for("mfa-flag-on@test.com", "AdminPass123")
    login_req = srv.LoginRequest(email="mfa-flag-on@test.com", password="AdminPass123")
    login_result = _run(srv.login(login_req, _FakeRequest(ip="25.25.25.25")))
    code = srv._totp_code(secret, time.time())
    mfa_req = srv.AdminMfaLoginReq(mfa_token=login_result["mfa_token"], code=code)
    response = _run(srv.login_mfa(mfa_req, _FakeRequest(ip="25.25.25.25")))
    body = json.loads(response.body)
    assert body["mfa_enabled"] is True


def test_auth_me_never_leaks_encrypted_mfa_secrets():
    _run(_seed_admin(email="mfa-secret-leak@test.com"))
    secret = _enable_mfa_for("mfa-secret-leak@test.com", "AdminPass123")
    assert secret  # sanity: MFA really is enabled with a real secret on the doc
    admin_doc = _run(_get_current_admin_dict("mfa-secret-leak@test.com"))
    result = _run(srv.auth_me(admin=admin_doc))
    assert result == {"email": "mfa-secret-leak@test.com", "name": "Admin", "role": "admin", "mfa_enabled": True}
    assert "mfa_secret_enc" not in result
    assert "mfa_pending_secret_enc" not in result


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
