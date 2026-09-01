"""Tests for the admin release-management API layered on top of
backend/ea_releases/manifest.json: GET /admin/releases, POST
/admin/releases/promote, POST /admin/releases/rollback, POST
/admin/releases/disable, GET /admin/releases/audit-log, GET
/admin/downloads.

Uses a live local MongoDB (skips cleanly if unreachable) and a temporary
sandboxed manifest/EA_RELEASES_DIR so it never touches the real checked-in
release artifacts, following the same pattern as
test_ea_release_integrity.py.
"""
import sys
import os
import json
import uuid
import asyncio
import shutil
import tempfile
import hashlib
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

TEST_DB = f"admin_release_pytest_{uuid.uuid4().hex[:10]}"
os.environ["MONGO_URL"] = "mongodb://localhost:27017"
os.environ["DB_NAME"] = TEST_DB
os.environ.setdefault("JWT_SECRET", "test-secret-admin-release")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")

import server as srv  # noqa: E402
from fastapi import HTTPException  # noqa: E402

_LOOP = asyncio.new_event_loop()


def _run(coro):
    return _LOOP.run_until_complete(coro)


ADMIN = {"email": "admin@test.com", "role": "admin"}


def _write_release(tmpdir: Path, version: str, content: bytes, stable: bool, build_ts: str):
    release_dir = tmpdir / version
    release_dir.mkdir(parents=True)
    (release_dir / "test.ex5").write_bytes(content)
    return {
        "version": version, "edition": "test", "ex5_filename": "test.ex5",
        "ex5_sha256": hashlib.sha256(content).hexdigest(),
        "customer_filename": f"XauCloud_{version}.ex5",
        "release_notes": f"notes for {version}", "stable_status": stable,
        "build_timestamp": build_ts,
    }


@pytest.fixture()
def sandbox(monkeypatch):
    tmpdir = Path(tempfile.mkdtemp(prefix="admin_release_test_"))
    releases = {
        "v1": _write_release(tmpdir, "v1", b"v1 bytes", True, "2026-01-01T00:00:00Z"),
        "v2": _write_release(tmpdir, "v2", b"v2 bytes", True, "2026-02-01T00:00:00Z"),
        "v3_unstable": _write_release(tmpdir, "v3_unstable", b"v3 bytes", False, "2026-03-01T00:00:00Z"),
    }
    manifest = {"current_version": "v1", "releases": releases}
    manifest_path = tmpdir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    monkeypatch.setattr(srv, "EA_RELEASES_DIR", tmpdir)

    def _load():
        return json.loads(manifest_path.read_text(encoding="utf-8"))
    monkeypatch.setattr(srv, "_load_ea_release_manifest", _load)

    yield {"tmpdir": tmpdir, "manifest_path": manifest_path}
    shutil.rmtree(tmpdir, ignore_errors=True)


async def _clear():
    await srv.db.release_audit_log.delete_many({})
    await srv.db.ea_download_log.delete_many({})


def _manifest(sandbox):
    return json.loads(sandbox["manifest_path"].read_text(encoding="utf-8"))


def test_promote_to_stable_version_succeeds(sandbox):
    async def go():
        await _clear()
        result = await srv.admin_promote_release(srv.ReleasePromoteRequest(version="v2"), admin=ADMIN)
        assert result["promoted"] is True
        assert result["previous_version"] == "v1"
        assert _manifest(sandbox)["current_version"] == "v2"
        entry = await srv.db.release_audit_log.find_one({"action": "promote"})
        assert entry["version"] == "v2" and entry["admin_email"] == "admin@test.com"
    _run(go())


def test_promote_unstable_version_rejected(sandbox):
    async def go():
        await _clear()
        with pytest.raises(HTTPException) as exc:
            await srv.admin_promote_release(srv.ReleasePromoteRequest(version="v3_unstable"), admin=ADMIN)
        assert exc.value.status_code == 400
        assert _manifest(sandbox)["current_version"] == "v1"
    _run(go())


def test_promote_unknown_version_rejected(sandbox):
    async def go():
        await _clear()
        with pytest.raises(HTTPException) as exc:
            await srv.admin_promote_release(srv.ReleasePromoteRequest(version="does-not-exist"), admin=ADMIN)
        assert exc.value.status_code == 404
    _run(go())


def test_promote_same_version_is_idempotent_no_op(sandbox):
    async def go():
        await _clear()
        result = await srv.admin_promote_release(srv.ReleasePromoteRequest(version="v1"), admin=ADMIN)
        assert result["no_op"] is True
        count = await srv.db.release_audit_log.count_documents({})
        assert count == 0  # no-op must not write a spurious audit entry
    _run(go())


def test_promote_rejects_hash_mismatch(sandbox):
    async def go():
        await _clear()
        # corrupt the v2 artifact so its hash no longer matches the manifest
        (sandbox["tmpdir"] / "v2" / "test.ex5").write_bytes(b"tampered")
        with pytest.raises(HTTPException) as exc:
            await srv.admin_promote_release(srv.ReleasePromoteRequest(version="v2"), admin=ADMIN)
        assert exc.value.status_code == 422
        assert _manifest(sandbox)["current_version"] == "v1"
    _run(go())


def test_rollback_restores_previous_version(sandbox):
    async def go():
        await _clear()
        await srv.admin_promote_release(srv.ReleasePromoteRequest(version="v2"), admin=ADMIN)
        result = await srv.admin_rollback_release(admin=ADMIN)
        assert result["rolled_back"] is True
        assert result["version"] == "v1"
        assert _manifest(sandbox)["current_version"] == "v1"
    _run(go())


def test_rollback_with_no_history_returns_404(sandbox):
    async def go():
        await _clear()
        with pytest.raises(HTTPException) as exc:
            await srv.admin_rollback_release(admin=ADMIN)
        assert exc.value.status_code == 404
    _run(go())


def test_disable_release_marks_unstable(sandbox):
    async def go():
        await _clear()
        result = await srv.admin_disable_release(srv.ReleaseDisableRequest(version="v2", reason="found a bug"), admin=ADMIN)
        assert result["disabled"] is True
        assert _manifest(sandbox)["releases"]["v2"]["stable_status"] is False
        entry = await srv.db.release_audit_log.find_one({"action": "disable"})
        assert entry["detail"] == "found a bug"
    _run(go())


def test_disable_then_promote_disabled_version_fails(sandbox):
    async def go():
        await _clear()
        await srv.admin_disable_release(srv.ReleaseDisableRequest(version="v2", reason="bad build"), admin=ADMIN)
        with pytest.raises(HTTPException) as exc:
            await srv.admin_promote_release(srv.ReleasePromoteRequest(version="v2"), admin=ADMIN)
        assert exc.value.status_code == 400
    _run(go())


def test_disable_current_version_leaves_it_unservable(sandbox):
    """Disabling the CURRENT version must fail closed -- _current_ea_release()
    must return None afterward, not silently keep serving the now-disabled
    build."""
    async def go():
        await _clear()
        await srv.admin_disable_release(srv.ReleaseDisableRequest(version="v1", reason="critical bug"), admin=ADMIN)
        assert srv._current_ea_release() is None
    _run(go())


def test_disable_idempotent_no_op(sandbox):
    async def go():
        await _clear()
        await srv.admin_disable_release(srv.ReleaseDisableRequest(version="v2"), admin=ADMIN)
        result = await srv.admin_disable_release(srv.ReleaseDisableRequest(version="v2"), admin=ADMIN)
        assert result["no_op"] is True
    _run(go())


def test_admin_list_releases_shape(sandbox):
    async def go():
        await _clear()
        result = await srv.admin_list_releases()
        assert result["current_version"] == "v1"
        by_version = {r["version"]: r for r in result["releases"]}
        assert by_version["v1"]["is_current"] is True
        assert by_version["v2"]["is_current"] is False
        assert by_version["v1"]["artifact_ok"] is True
    _run(go())


def test_admin_download_log_read_path(sandbox):
    async def go():
        await _clear()
        await srv.db.ea_download_log.insert_one({
            "id": "d1", "user_id": "u1", "license_id": "lic1", "version": "v1",
            "downloaded_at": "2026-01-01T00:00:00Z", "result": "SUCCESS",
        })
        result = await srv.admin_download_log()
        assert result["total"] == 1
        assert "pin" not in result["entries"][0]
    _run(go())
