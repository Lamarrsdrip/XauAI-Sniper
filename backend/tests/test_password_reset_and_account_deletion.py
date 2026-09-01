"""Real, executable tests for the v6.25.3 Phase 6 (P0) password-reset,
account-deletion, and data-export flows (final pre-launch hardening).

Uses a live local MongoDB in an isolated database (skips cleanly if none
reachable). Email sending is not exercised against a real SMTP server --
_send_email() is mocked so these tests run offline, but the token
issuance/validation/single-use/rate-limit logic is real.
"""
import sys
import os
import uuid
import asyncio
from unittest.mock import AsyncMock, patch

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

TEST_DB = f"pwreset_pytest_{uuid.uuid4().hex[:10]}"
os.environ["MONGO_URL"] = "mongodb://localhost:27017"
os.environ["DB_NAME"] = TEST_DB
os.environ.setdefault("JWT_SECRET", "test-secret-pwreset")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")

import server as srv  # noqa: E402
from fastapi import HTTPException, Response  # noqa: E402
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
    await srv.db.cloud_users.delete_many({})
    await srv.db.used_password_reset_tokens.delete_many({})
    await srv.db.account_deletion_audit_log.delete_many({})
    await srv.db.login_audit_log.delete_many({})
    # Calling the route functions directly (this file's established pattern,
    # matching every other test file in this suite) never triggers FastAPI's
    # @app.on_event("startup") handler, which is where the real app creates
    # the used_password_reset_tokens.jti unique index. Without it, the
    # DuplicateKeyError-based single-use check in cloud_reset_password would
    # never actually be exercised. Idempotent -- safe to call every test.
    await srv.db.used_password_reset_tokens.create_index("jti", unique=True)


def setup_function(_fn):
    _reset()
    _run(_clear())


async def _seed_user(email="reset-target@test.com", password="OldPassword123"):
    uid = str(uuid.uuid4())
    await srv.db.cloud_users.insert_one({
        "id": uid, "email": email, "password_hash": srv.hash_password(password),
        "full_name": "Test", "country": "", "created_at": "2026-07-17T00:00:00Z",
        "last_login_at": "2026-07-17T00:00:00Z",
    })
    return uid


# ---------------------------------------------------------------------
# Forgot password
# ---------------------------------------------------------------------

def test_forgot_password_returns_generic_response_for_unknown_email():
    req = srv.CloudForgotPasswordReq(email="nobody-here@test.com")
    with patch.object(srv, "_send_email", new=AsyncMock(return_value=True)) as mock_send:
        result = _run(srv.cloud_forgot_password(req, _FakeRequest()))
    assert result["ok"] is True
    mock_send.assert_not_called()  # no account -- no email, but no error either


def test_forgot_password_sends_email_for_known_account():
    _run(_seed_user())
    req = srv.CloudForgotPasswordReq(email="reset-target@test.com")
    with patch.object(srv, "_send_email", new=AsyncMock(return_value=True)) as mock_send:
        result = _run(srv.cloud_forgot_password(req, _FakeRequest()))
    assert result["ok"] is True
    mock_send.assert_called_once()
    sent_html = mock_send.call_args[0][2]
    assert "token=" in sent_html


def test_forgot_password_rate_limited_by_email():
    _run(_seed_user())
    req = srv.CloudForgotPasswordReq(email="reset-target@test.com")
    with patch.object(srv, "_send_email", new=AsyncMock(return_value=True)):
        for _ in range(3):
            _run(srv.cloud_forgot_password(req, _FakeRequest(ip="9.9.9.9")))
        with pytest.raises(HTTPException) as exc:
            _run(srv.cloud_forgot_password(req, _FakeRequest(ip="9.9.9.9")))
    assert exc.value.status_code == 429


# ---------------------------------------------------------------------
# Reset password
# ---------------------------------------------------------------------

def _issue_reset_token(uid):
    jti = str(uuid.uuid4())
    return srv._password_reset_token(uid, jti)


def test_reset_password_succeeds_with_valid_token():
    uid = _run(_seed_user())
    token = _issue_reset_token(uid)
    req = srv.CloudResetPasswordReq(token=token, new_password="NewPassword456")
    result = _run(srv.cloud_reset_password(req, _FakeRequest()))
    assert result["ok"] is True

    async def find():
        return await srv.db.cloud_users.find_one({"id": uid})
    doc = _run(find())
    assert srv.verify_password("NewPassword456", doc["password_hash"])
    assert not srv.verify_password("OldPassword123", doc["password_hash"])


def test_reset_password_token_is_single_use():
    uid = _run(_seed_user())
    token = _issue_reset_token(uid)
    req = srv.CloudResetPasswordReq(token=token, new_password="NewPassword456")
    _run(srv.cloud_reset_password(req, _FakeRequest(ip="11.11.11.11")))
    req2 = srv.CloudResetPasswordReq(token=token, new_password="AnotherPassword789")
    with pytest.raises(HTTPException) as exc:
        _run(srv.cloud_reset_password(req2, _FakeRequest(ip="12.12.12.12")))
    assert exc.value.status_code == 400
    assert "already been used" in exc.value.detail


def test_reset_password_rejects_expired_token():
    import jwt as _jwt
    from datetime import datetime, timezone, timedelta
    uid = _run(_seed_user())
    expired = _jwt.encode(
        {"sub": uid, "type": "password_reset", "jti": str(uuid.uuid4()),
         "exp": datetime.now(timezone.utc) - timedelta(seconds=10)},
        srv.JWT_SECRET, algorithm=srv.JWT_ALGORITHM)
    req = srv.CloudResetPasswordReq(token=expired, new_password="NewPassword456")
    with pytest.raises(HTTPException) as exc:
        _run(srv.cloud_reset_password(req, _FakeRequest()))
    assert exc.value.status_code == 400


def test_reset_password_rejects_weak_password():
    uid = _run(_seed_user())
    token = _issue_reset_token(uid)
    req = srv.CloudResetPasswordReq(token=token, new_password="allletters")
    with pytest.raises(HTTPException) as exc:
        _run(srv.cloud_reset_password(req, _FakeRequest()))
    assert exc.value.status_code == 400


def test_reset_password_rejects_wrong_token_type():
    uid = _run(_seed_user())
    wrong_type_token = srv._cloud_token(uid, "reset-target@test.com")  # type=cloud, not password_reset
    req = srv.CloudResetPasswordReq(token=wrong_type_token, new_password="NewPassword456")
    with pytest.raises(HTTPException) as exc:
        _run(srv.cloud_reset_password(req, _FakeRequest()))
    assert exc.value.status_code == 400


# ---------------------------------------------------------------------
# Data export
# ---------------------------------------------------------------------

def test_account_export_returns_real_account_and_no_password_hash():
    uid = _run(_seed_user(email="export-me@test.com"))
    user = _run(srv.db.cloud_users.find_one({"id": uid}))
    result = _run(srv.cloud_account_export(user))
    assert result["account"]["email"] == "export-me@test.com"
    assert "password_hash" not in result["account"]
    assert "login_history" in result
    assert "exported_at" in result


# ---------------------------------------------------------------------
# Account deletion
# ---------------------------------------------------------------------

def test_account_delete_requires_confirm_flag():
    uid = _run(_seed_user())
    user = _run(srv.db.cloud_users.find_one({"id": uid}))
    req = srv.CloudDeleteAccountReq(password="OldPassword123", confirm=False)
    with pytest.raises(HTTPException) as exc:
        _run(srv.cloud_account_delete(req, Response(), user))
    assert exc.value.status_code == 400


def test_account_delete_requires_correct_password():
    uid = _run(_seed_user())
    user = _run(srv.db.cloud_users.find_one({"id": uid}))
    req = srv.CloudDeleteAccountReq(password="WrongPassword", confirm=True)
    with pytest.raises(HTTPException) as exc:
        _run(srv.cloud_account_delete(req, Response(), user))
    assert exc.value.status_code == 401


def test_account_delete_removes_account_and_writes_audit_log():
    uid = _run(_seed_user(email="delete-me@test.com"))
    user = _run(srv.db.cloud_users.find_one({"id": uid}))
    req = srv.CloudDeleteAccountReq(password="OldPassword123", confirm=True)
    result = _run(srv.cloud_account_delete(req, Response(), user))
    assert result["ok"] is True

    async def check():
        remaining = await srv.db.cloud_users.find_one({"id": uid})
        audit = await srv.db.account_deletion_audit_log.find_one({"user_id": uid})
        return remaining, audit
    remaining, audit = _run(check())
    assert remaining is None
    assert audit is not None
    assert audit["email"] == "delete-me@test.com"


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
