"""Tests for scripts/auto_promote_release.py's decide_promotion() -- the
core logic .github/workflows/ea.yml relies on to auto-move
manifest.json's current_version to the newest validated stable release on
every push to main, without ever promoting an unapproved or broken build.
"""
import sys
import os
import hashlib
import shutil
import tempfile
from pathlib import Path

import pytest

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS_DIR = os.path.join(ROOT_DIR, "scripts")
if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)

from auto_promote_release import decide_promotion  # noqa: E402


@pytest.fixture()
def releases_dir():
    tmpdir = Path(tempfile.mkdtemp(prefix="auto_promote_test_"))
    yield tmpdir
    shutil.rmtree(tmpdir, ignore_errors=True)


def _write_artifact(releases_dir: Path, version: str, filename: str, content: bytes) -> str:
    d = releases_dir / version
    d.mkdir(parents=True, exist_ok=True)
    (d / filename).write_bytes(content)
    return hashlib.sha256(content).hexdigest()


def test_no_candidate_when_nothing_newer(releases_dir):
    manifest = {
        "current_version": "v1",
        "releases": {"v1": {"version": "v1", "stable_status": True, "build_timestamp": "2026-01-01T00:00:00Z"}},
    }
    version, reason, problems = decide_promotion(manifest, releases_dir)
    assert version is None
    assert "no newer" in reason
    assert problems == []


def test_no_candidate_when_newer_release_not_stable(releases_dir):
    manifest = {
        "current_version": "v1",
        "releases": {
            "v1": {"version": "v1", "stable_status": True, "build_timestamp": "2026-01-01T00:00:00Z"},
            "v2": {"version": "v2", "stable_status": False, "build_timestamp": "2026-02-01T00:00:00Z"},
        },
    }
    version, reason, problems = decide_promotion(manifest, releases_dir)
    assert version is None
    assert "no newer" in reason


def test_promotes_valid_newer_stable_release(releases_dir):
    h = _write_artifact(releases_dir, "v2", "test.ex5", b"v2 bytes")
    manifest = {
        "current_version": "v1",
        "releases": {
            "v1": {"version": "v1", "stable_status": True, "build_timestamp": "2026-01-01T00:00:00Z"},
            "v2": {"version": "v2", "stable_status": True, "build_timestamp": "2026-02-01T00:00:00Z",
                   "ex5_filename": "test.ex5", "ex5_sha256": h},
        },
    }
    version, reason, problems = decide_promotion(manifest, releases_dir)
    assert version == "v2"
    assert reason is None
    assert problems == []


def test_rejects_candidate_with_hash_mismatch(releases_dir):
    _write_artifact(releases_dir, "v2", "test.ex5", b"v2 bytes")
    manifest = {
        "current_version": "v1",
        "releases": {
            "v1": {"version": "v1", "stable_status": True, "build_timestamp": "2026-01-01T00:00:00Z"},
            "v2": {"version": "v2", "stable_status": True, "build_timestamp": "2026-02-01T00:00:00Z",
                   "ex5_filename": "test.ex5", "ex5_sha256": "deadbeef" * 8},
        },
    }
    version, reason, problems = decide_promotion(manifest, releases_dir)
    assert version == "v2"
    assert reason is None
    assert any("SHA-256 mismatch" in p for p in problems)


def test_rejects_candidate_with_missing_artifact(releases_dir):
    manifest = {
        "current_version": "v1",
        "releases": {
            "v1": {"version": "v1", "stable_status": True, "build_timestamp": "2026-01-01T00:00:00Z"},
            "v2": {"version": "v2", "stable_status": True, "build_timestamp": "2026-02-01T00:00:00Z",
                   "ex5_filename": "test.ex5", "ex5_sha256": "abc123"},
        },
    }
    version, reason, problems = decide_promotion(manifest, releases_dir)
    assert version == "v2"
    assert any("not found" in p for p in problems)


def test_rejects_candidate_with_version_key_mismatch(releases_dir):
    h = _write_artifact(releases_dir, "v2", "test.ex5", b"v2 bytes")
    manifest = {
        "current_version": "v1",
        "releases": {
            "v1": {"version": "v1", "stable_status": True, "build_timestamp": "2026-01-01T00:00:00Z"},
            "v2": {"version": "v2-typo", "stable_status": True, "build_timestamp": "2026-02-01T00:00:00Z",
                   "ex5_filename": "test.ex5", "ex5_sha256": h},
        },
    }
    version, reason, problems = decide_promotion(manifest, releases_dir)
    assert version == "v2"
    assert any("does not match its own manifest key" in p for p in problems)


def test_picks_newest_by_build_timestamp_not_by_dict_order(releases_dir):
    h2 = _write_artifact(releases_dir, "v2", "test.ex5", b"v2 bytes")
    h3 = _write_artifact(releases_dir, "v3", "test.ex5", b"v3 bytes")
    manifest = {
        "current_version": "v1",
        "releases": {
            "v3": {"version": "v3", "stable_status": True, "build_timestamp": "2026-03-01T00:00:00Z",
                   "ex5_filename": "test.ex5", "ex5_sha256": h3},
            "v1": {"version": "v1", "stable_status": True, "build_timestamp": "2026-01-01T00:00:00Z"},
            "v2": {"version": "v2", "stable_status": True, "build_timestamp": "2026-02-01T00:00:00Z",
                   "ex5_filename": "test.ex5", "ex5_sha256": h2},
        },
    }
    version, reason, problems = decide_promotion(manifest, releases_dir)
    assert version == "v3"
    assert problems == []


def test_no_current_version_pointer_still_finds_a_candidate(releases_dir):
    """A brand-new manifest with no current_version at all -- e.g. the very
    first release ever added -- must still be promotable."""
    h = _write_artifact(releases_dir, "v1", "test.ex5", b"v1 bytes")
    manifest = {
        "current_version": None,
        "releases": {"v1": {"version": "v1", "stable_status": True, "build_timestamp": "2026-01-01T00:00:00Z",
                             "ex5_filename": "test.ex5", "ex5_sha256": h}},
    }
    version, reason, problems = decide_promotion(manifest, releases_dir)
    assert version == "v1"
    assert problems == []
