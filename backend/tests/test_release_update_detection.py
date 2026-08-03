"""Tests for the Command Center "update available" detection layered on top
of the release manifest: build_public_release_display() comparing the EA's
self-reported version against the manifest's current stable release, and
_resolve_update_status() computing the single customer-facing status string
(up_to_date / update_available / license_inactive / installed_version_unknown
/ download_unavailable / release_verification_failed).

build_public_release_display() reads _current_ea_release(), which reads the
manifest file fresh from disk on every call -- these tests point
EA_RELEASES_DIR at a temporary sandboxed manifest rather than the real
checked-in one, and don't need MongoDB at all (pure functions, no DB
access).
"""
import sys
import os
import json
import shutil
import tempfile
from pathlib import Path

import pytest

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "release_update_detection_pytest")
os.environ.setdefault("JWT_SECRET", "test-secret-release-update")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")

import server as srv  # noqa: E402


@pytest.fixture()
def sandbox(monkeypatch):
    tmpdir = Path(tempfile.mkdtemp(prefix="release_update_test_"))
    manifest = {
        "current_version": "v9.9.0",
        "releases": {
            "v9.9.0": {"version": "v9.9.0", "stable_status": True, "release_notes": "latest notes", "build_timestamp": "2026-09-01T00:00:00Z"},
            "v9.8.0": {"version": "v9.8.0", "stable_status": True, "release_notes": "old notes", "build_timestamp": "2026-08-01T00:00:00Z"},
        },
    }
    manifest_path = tmpdir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    monkeypatch.setattr(srv, "EA_RELEASES_DIR", tmpdir)

    def _load():
        return json.loads(manifest_path.read_text(encoding="utf-8"))
    monkeypatch.setattr(srv, "_load_ea_release_manifest", _load)
    yield {"tmpdir": tmpdir, "manifest_path": manifest_path, "manifest": manifest}
    shutil.rmtree(tmpdir, ignore_errors=True)


def test_installed_matches_latest_no_update(sandbox):
    display = srv.build_public_release_display("XauCloud-m10_v9.9.0_PURE_M10")
    assert display["installed_version"] == "9.9.0"
    assert display["latest_version"] == "9.9.0"
    assert display["update_available"] is False


def test_installed_behind_latest_update_available(sandbox):
    display = srv.build_public_release_display("XauCloud-m10_v9.8.0_PURE_M10")
    assert display["installed_version"] == "9.8.0"
    assert display["latest_version"] == "9.9.0"
    assert display["update_available"] is True
    assert display["latest_release_notes"] == "latest notes"


def test_no_heartbeat_no_installed_version(sandbox):
    display = srv.build_public_release_display("")
    assert display["installed_version"] is None
    assert display["update_available"] is False  # can't claim an update is available with no known installed version


def test_current_version_not_stable_no_latest_version(sandbox, monkeypatch):
    m = sandbox["manifest"]
    m["releases"]["v9.9.0"]["stable_status"] = False
    sandbox["manifest_path"].write_text(json.dumps(m), encoding="utf-8")
    display = srv.build_public_release_display("XauCloud-m10_v9.8.0_PURE_M10")
    assert display["latest_version"] is None
    assert display["update_available"] is False


class TestResolveUpdateStatus:
    def test_download_unavailable_when_no_manifest_pointer(self):
        assert srv._resolve_update_status(False, False, True, "1.0", False) == "download_unavailable"

    def test_release_verification_failed_when_pointer_but_not_servable(self):
        assert srv._resolve_update_status(True, False, True, "1.0", False) == "release_verification_failed"

    def test_license_inactive_takes_precedence_over_update_available(self):
        assert srv._resolve_update_status(True, True, False, "1.0", True) == "license_inactive"

    def test_installed_version_unknown(self):
        assert srv._resolve_update_status(True, True, True, None, False) == "installed_version_unknown"

    def test_update_available(self):
        assert srv._resolve_update_status(True, True, True, "1.0", True) == "update_available"

    def test_up_to_date(self):
        assert srv._resolve_update_status(True, True, True, "1.0", False) == "up_to_date"
