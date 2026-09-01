"""Tests for the release-manifest integrity gates added on top of the
existing backend/ea_releases/ system (single authoritative release manifest,
token-gated compiled-EX5 download):

- _current_ea_release() must never surface a release that isn't explicitly
  stable_status=true, even if current_version points at it (a manifest
  editing mistake, or a mid-flight CI update, must fail closed rather than
  serve/display an unapproved build).
- GET /download/ea-release must re-check stable_status at serve time (not
  just at token-mint time) so disabling a release mid-flight (e.g. a
  critical bug found after a download token was already issued) actually
  blocks the download.
- GET /download/ea-release must recompute the served file's SHA-256 and
  refuse to serve on any mismatch against the manifest, rather than only
  trusting a one-time CI-time hash check.

Uses a live local MongoDB (skips cleanly if unreachable) and a temporary
copy of the manifest/EA_RELEASES_DIR so it never touches the real
checked-in release artifacts.
"""
import sys
import os
import json
import uuid
import asyncio
import shutil
import tempfile
from pathlib import Path

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


pytestmark = pytest.mark.skipif(not _mongo_available(), reason="no local MongoDB reachable for this test")

TEST_DB = f"ea_release_pytest_{uuid.uuid4().hex[:10]}"
os.environ["MONGO_URL"] = "mongodb://localhost:27017"
os.environ["DB_NAME"] = TEST_DB
os.environ.setdefault("JWT_SECRET", "test-secret-ea-release")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")

import server as srv  # noqa: E402
from fastapi import HTTPException  # noqa: E402

_LOOP = asyncio.new_event_loop()


def _run(coro):
    return _LOOP.run_until_complete(coro)


@pytest.fixture()
def sandbox_release(monkeypatch):
    """Points EA_RELEASES_DIR at a scratch directory with one fake release
    (version TESTv1) so tests never touch the real checked-in artifacts."""
    tmpdir = Path(tempfile.mkdtemp(prefix="ea_release_test_"))
    release_dir = tmpdir / "TESTv1"
    release_dir.mkdir(parents=True)
    ex5_path = release_dir / "test.ex5"
    content = b"fake compiled EA bytes for test"
    ex5_path.write_bytes(content)
    import hashlib
    real_hash = hashlib.sha256(content).hexdigest()

    manifest = {
        "current_version": "TESTv1",
        "releases": {
            "TESTv1": {
                "version": "TESTv1", "edition": "test edition",
                "ex5_filename": "test.ex5", "ex5_sha256": real_hash,
                "customer_filename": "XauCloud_TESTv1.ex5",
                "release_notes": "test release", "stable_status": True,
            }
        },
    }
    manifest_path = tmpdir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    monkeypatch.setattr(srv, "EA_RELEASES_DIR", tmpdir)

    def _fake_load_manifest():
        return json.loads(manifest_path.read_text(encoding="utf-8"))
    monkeypatch.setattr(srv, "_load_ea_release_manifest", _fake_load_manifest)

    yield {"tmpdir": tmpdir, "manifest_path": manifest_path, "manifest": manifest, "real_hash": real_hash, "ex5_path": ex5_path}
    shutil.rmtree(tmpdir, ignore_errors=True)


async def _clear():
    await srv.db.pin_licenses.delete_many({})
    await srv.db.ea_download_log.delete_many({})


def _mint_token(version: str, license_id: str = "lic-1", user_id: str = "user-1") -> str:
    from datetime import datetime, timedelta, timezone
    return srv.jwt.encode(
        {"sub": "ea_download", "user_id": user_id, "license_id": license_id, "version": version,
         "exp": datetime.now(timezone.utc) + timedelta(seconds=300)},
        srv.JWT_SECRET, algorithm=srv.JWT_ALGORITHM,
    )


async def _seed_active_license(license_id="lic-1"):
    await srv.db.pin_licenses.insert_one({"id": license_id, "pin": "ASE-TEST-0001", "is_active": True})


def test_current_release_none_when_manifest_empty(sandbox_release):
    async def go():
        await _clear()
        # point current_version at a version that doesn't exist in releases
        sandbox_release["manifest_path"].write_text(json.dumps({"current_version": "MISSING", "releases": {}}), encoding="utf-8")
        assert srv._current_ea_release() is None
    _run(go())


def test_current_release_none_when_not_stable(sandbox_release):
    async def go():
        await _clear()
        m = sandbox_release["manifest"]
        m["releases"]["TESTv1"]["stable_status"] = False
        sandbox_release["manifest_path"].write_text(json.dumps(m), encoding="utf-8")
        assert srv._current_ea_release() is None
    _run(go())


def test_current_release_returns_stable_release(sandbox_release):
    async def go():
        await _clear()
        release = srv._current_ea_release()
        assert release is not None
        assert release["version"] == "TESTv1"
    _run(go())


def test_download_succeeds_with_valid_token_and_matching_hash(sandbox_release):
    async def go():
        await _clear()
        await _seed_active_license()
        token = _mint_token("TESTv1")
        resp = await srv.download_ea_release(token=token)
        assert resp.filename == "XauCloud_TESTv1.ex5"
        log = await srv.db.ea_download_log.find_one({"license_id": "lic-1"})
        assert log["result"] == "SUCCESS"
    _run(go())


def test_download_rejects_when_license_inactive(sandbox_release):
    async def go():
        await _clear()
        await srv.db.pin_licenses.insert_one({"id": "lic-1", "pin": "ASE-TEST-0002", "is_active": False})
        token = _mint_token("TESTv1")
        with pytest.raises(HTTPException) as exc:
            await srv.download_ea_release(token=token)
        assert exc.value.status_code == 403
    _run(go())


def test_download_rejects_when_release_disabled_after_token_minted(sandbox_release):
    """The token was minted while the release was stable; an admin then
    disables it (e.g. a critical bug found) before the customer actually
    fetches the file -- the already-issued token must not still work."""
    async def go():
        await _clear()
        await _seed_active_license()
        token = _mint_token("TESTv1")
        m = sandbox_release["manifest"]
        m["releases"]["TESTv1"]["stable_status"] = False
        sandbox_release["manifest_path"].write_text(json.dumps(m), encoding="utf-8")
        with pytest.raises(HTTPException) as exc:
            await srv.download_ea_release(token=token)
        assert exc.value.status_code == 404
        log = await srv.db.ea_download_log.find_one({"license_id": "lic-1"})
        assert log["result"] == "REJECTED_RELEASE_NOT_AVAILABLE"
    _run(go())


def test_download_rejects_on_hash_mismatch(sandbox_release):
    """Simulates a corrupted/tampered artifact on disk not matching the
    manifest's recorded SHA-256 -- must never be served, even with a
    perfectly valid token and active license."""
    async def go():
        await _clear()
        await _seed_active_license()
        sandbox_release["ex5_path"].write_bytes(b"corrupted or tampered bytes")
        token = _mint_token("TESTv1")
        with pytest.raises(HTTPException) as exc:
            await srv.download_ea_release(token=token)
        assert exc.value.status_code == 503
        log = await srv.db.ea_download_log.find_one({"license_id": "lic-1"})
        assert log["result"] == "REJECTED_HASH_MISMATCH"
    _run(go())


def test_download_rejects_unknown_version_in_token(sandbox_release):
    async def go():
        await _clear()
        await _seed_active_license()
        token = _mint_token("DOES-NOT-EXIST")
        with pytest.raises(HTTPException) as exc:
            await srv.download_ea_release(token=token)
        assert exc.value.status_code == 404
    _run(go())


def test_download_rejects_expired_token(sandbox_release):
    async def go():
        await _clear()
        await _seed_active_license()
        from datetime import datetime, timedelta, timezone
        expired = srv.jwt.encode(
            {"sub": "ea_download", "user_id": "user-1", "license_id": "lic-1", "version": "TESTv1",
             "exp": datetime.now(timezone.utc) - timedelta(seconds=5)},
            srv.JWT_SECRET, algorithm=srv.JWT_ALGORITHM,
        )
        with pytest.raises(HTTPException) as exc:
            await srv.download_ea_release(token=expired)
        assert exc.value.status_code == 401
    _run(go())


def test_never_logs_raw_pin_on_download(sandbox_release):
    async def go():
        await _clear()
        await _seed_active_license()
        token = _mint_token("TESTv1")
        await srv.download_ea_release(token=token)
        log = await srv.db.ea_download_log.find_one({"license_id": "lic-1"})
        assert "pin" not in log
        assert "ASE-TEST-0001" not in json.dumps(log, default=str)
    _run(go())
