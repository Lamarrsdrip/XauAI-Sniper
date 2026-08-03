"""Real, executable tests for the v6.25.3 Phase 3 (P0) download security fix
(final pre-launch hardening).

Root vulnerability fixed: GET /api/download/ea and /api/download/package
served the FULL MQ5 SOURCE CODE to any anonymous visitor -- no auth, no
license check, one click and the entire strategy's IP was gone. Required
flow now: authenticated Command Center user -> active paid license
belonging to that user -> short-lived signed download token -> compiled EX5
release artifact. Source and the admin master EX5 remain admin-only.

Uses a live local MongoDB in an isolated database (skips cleanly if none
reachable). Calls the real endpoint functions directly (not over HTTP),
same convention as test_reservation_endpoint_authentication.py.
"""
import sys
import os
import asyncio
import uuid
from datetime import datetime, timedelta, timezone

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


pytestmark = pytest.mark.skipif(not _mongo_available(), reason="no local MongoDB reachable for this live download-security test")

TEST_DB = f"download_pytest_{uuid.uuid4().hex[:10]}"
os.environ["MONGO_URL"] = "mongodb://localhost:27017"
os.environ["DB_NAME"] = TEST_DB
os.environ.setdefault("JWT_SECRET", "test-secret-download")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")

import server as srv  # noqa: E402
import jwt  # noqa: E402
from fastapi import HTTPException  # noqa: E402

_LOOP = asyncio.new_event_loop()


def _run(coro):
    return _LOOP.run_until_complete(coro)


async def _clear():
    await srv.db.pin_licenses.delete_many({})
    await srv.db.cloud_users.delete_many({})
    await srv.db.ea_download_log.delete_many({})


async def _seed_license(pin="ASE-TESTLIC1", active=True, email="buyer@example.com"):
    doc = {"id": str(uuid.uuid4()), "pin": pin, "buyer_email": email, "is_active": active, "is_used": True}
    await srv.db.pin_licenses.insert_one(doc)
    return doc


async def _seed_cloud_user(license_key=None, email="buyer@example.com"):
    doc = {"id": str(uuid.uuid4()), "email": email, "license_key": license_key or ""}
    await srv.db.cloud_users.insert_one(doc)
    return doc


def test_public_mq5_endpoint_retired_returns_410():
    async def go():
        with pytest.raises(HTTPException) as exc:
            await srv.download_ea_retired()
        assert exc.value.status_code == 410
    _run(go())


def test_public_package_endpoint_retired_returns_410():
    async def go():
        with pytest.raises(HTTPException) as exc:
            await srv.download_package_retired()
        assert exc.value.status_code == 410
    _run(go())


def test_xauindex_mq5_endpoint_retired_returns_410():
    async def go():
        with pytest.raises(HTTPException) as exc:
            await srv.download_xauindex_ea_retired()
        assert exc.value.status_code == 410
    _run(go())


def test_xauindex_package_endpoint_retired_returns_410():
    async def go():
        with pytest.raises(HTTPException) as exc:
            await srv.download_xauindex_package_retired()
        assert exc.value.status_code == 410
    _run(go())


def test_public_info_endpoint_never_exposes_source_code():
    async def go():
        result = await srv.download_info()
        # No raw MQ5 content, no filesystem paths, no secrets -- metadata only.
        assert "input " not in str(result)  # a literal MQL5 `input` declaration would leak if source were embedded
        assert "InpCloudAgentToken" not in str(result)
        assert result.get("available") is True
        assert "version" in result
        assert "checksum_sha256_12" in result
    _run(go())


def test_request_token_requires_active_license():
    async def go():
        await _clear()
        user = await _seed_cloud_user()  # no license linked at all
        with pytest.raises(HTTPException) as exc:
            await srv.request_ea_download_token(user=user)
        assert exc.value.status_code == 403
        await _clear()
    _run(go())


def test_request_token_succeeds_for_user_with_active_license():
    async def go():
        await _clear()
        await _seed_license(pin="ASE-ACTIVE1", active=True)
        user = await _seed_cloud_user(license_key="ASE-ACTIVE1")
        result = await srv.request_ea_download_token(user=user)
        assert "download_token" in result
        assert result["expires_in"] == srv.DOWNLOAD_TOKEN_TTL_SECONDS
        # token must decode to the expected claims
        payload = jwt.decode(result["download_token"], srv.JWT_SECRET, algorithms=[srv.JWT_ALGORITHM])
        assert payload["sub"] == "ea_download"
        assert payload["user_id"] == user["id"]
        await _clear()
    _run(go())


def test_request_token_rejects_revoked_license():
    async def go():
        await _clear()
        await _seed_license(pin="ASE-REVOKED1", active=False)
        user = await _seed_cloud_user(license_key="ASE-REVOKED1")
        with pytest.raises(HTTPException) as exc:
            await srv.request_ea_download_token(user=user)
        assert exc.value.status_code == 403
        await _clear()
    _run(go())


def test_download_release_with_valid_token_succeeds_and_logs():
    async def go():
        await _clear()
        await _seed_license(pin="ASE-ACTIVE2", active=True)
        user = await _seed_cloud_user(license_key="ASE-ACTIVE2")
        token_result = await srv.request_ea_download_token(user=user)
        response = await srv.download_ea_release(token=token_result["download_token"])
        assert response is not None  # FileResponse, not an exception
        log = await srv.db.ea_download_log.find_one({"user_id": user["id"]})
        assert log is not None
        # Compare against the manifest's actual current_version rather than a
        # hardcoded string -- this test shouldn't need editing every release.
        assert log["version"] == srv._current_ea_release()["version"]
        await _clear()
    _run(go())


def test_download_release_rejects_expired_token():
    async def go():
        await _clear()
        expired_token = jwt.encode({
            "sub": "ea_download", "user_id": "user-x", "license_id": "lic-x", "version": "v6.25.2",
            "exp": datetime.now(timezone.utc) - timedelta(seconds=10),
        }, srv.JWT_SECRET, algorithm=srv.JWT_ALGORITHM)
        with pytest.raises(HTTPException) as exc:
            await srv.download_ea_release(token=expired_token)
        assert exc.value.status_code == 401
        await _clear()
    _run(go())


def test_download_release_rejects_tampered_token():
    async def go():
        await _clear()
        with pytest.raises(HTTPException) as exc:
            await srv.download_ea_release(token="not.a.valid.jwt")
        assert exc.value.status_code == 401
        await _clear()
    _run(go())


def test_download_release_rejects_token_for_now_revoked_license():
    # Real-time revocation check: even a time-valid, correctly-signed token
    # must be rejected if the license it was minted for has since been
    # deactivated -- the license state is rechecked at download time, not
    # just at token-mint time.
    async def go():
        await _clear()
        lic = await _seed_license(pin="ASE-WILLREVOKE", active=True)
        user = await _seed_cloud_user(license_key="ASE-WILLREVOKE")
        token_result = await srv.request_ea_download_token(user=user)
        await srv.db.pin_licenses.update_one({"id": lic["id"]}, {"$set": {"is_active": False}})
        with pytest.raises(HTTPException) as exc:
            await srv.download_ea_release(token=token_result["download_token"])
        assert exc.value.status_code == 403
        await _clear()
    _run(go())


def test_download_token_cannot_be_reused_for_a_different_users_license():
    # A stolen/observed token is bound to the license_id it was minted for
    # (server-side, inside the signed JWT) -- decoding it never trusts a
    # client-supplied license identifier.
    async def go():
        await _clear()
        lic_a = await _seed_license(pin="ASE-USERA", active=True, email="a@example.com")
        user_a = await _seed_cloud_user(license_key="ASE-USERA", email="a@example.com")
        token_result = await srv.request_ea_download_token(user=user_a)
        payload = jwt.decode(token_result["download_token"], srv.JWT_SECRET, algorithms=[srv.JWT_ALGORITHM])
        assert payload["license_id"] == lic_a["id"]  # bound to the real owner's license, not forgeable client-side
        await _clear()
    _run(go())


def test_admin_master_endpoint_still_requires_admin_auth():
    import inspect
    src = inspect.getsource(srv.admin_download_ea_master)
    # the route decorator (not the function body) is what actually enforces
    # this -- confirm the dependency is present in source.
    full_src = open(os.path.join(BACKEND_DIR, "server.py")).read()
    idx = full_src.index("async def admin_download_ea_master")
    preceding = full_src[max(0, idx - 300):idx]
    assert "Depends(get_current_admin)" in preceding


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
