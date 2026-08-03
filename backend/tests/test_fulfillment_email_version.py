"""Tests that the fulfillment email (send_pin_email) resolves the current
approved version from the release manifest at SEND time rather than using
a hardcoded version, and includes the required onboarding elements
(Telegram support link, Command Center link, changelog).

Uses a sandboxed manifest (never touches the real checked-in one) and
monkeypatches _send_email to capture the rendered HTML instead of actually
sending it over SMTP.
"""
import sys
import os
import json
import shutil
import tempfile
import asyncio
from pathlib import Path

import pytest

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "fulfillment_email_pytest")
os.environ.setdefault("JWT_SECRET", "test-secret-fulfillment-email")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")

import server as srv  # noqa: E402

_LOOP = asyncio.new_event_loop()


def _run(coro):
    return _LOOP.run_until_complete(coro)


@pytest.fixture()
def sandbox(monkeypatch):
    tmpdir = Path(tempfile.mkdtemp(prefix="fulfillment_email_test_"))
    manifest = {
        "current_version": "v7.1.0",
        "releases": {
            "v7.1.0": {"version": "v7.1.0", "stable_status": True, "release_notes": "Fixed the exit-timing bug."},
        },
    }
    manifest_path = tmpdir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    monkeypatch.setattr(srv, "EA_RELEASES_DIR", tmpdir)

    def _load():
        return json.loads(manifest_path.read_text(encoding="utf-8"))
    monkeypatch.setattr(srv, "_load_ea_release_manifest", _load)

    captured = {}

    async def _fake_send(to_email, subject, html):
        captured["to_email"] = to_email
        captured["subject"] = subject
        captured["html"] = html
        return True
    monkeypatch.setattr(srv, "_send_email", _fake_send)

    yield captured
    shutil.rmtree(tmpdir, ignore_errors=True)


def test_email_includes_current_version(sandbox):
    _run(srv.send_pin_email("buyer@example.com", "Test Buyer", "ASE-TEST-0001"))
    assert "v7.1.0" in sandbox["html"]


def test_email_includes_changelog(sandbox):
    _run(srv.send_pin_email("buyer@example.com", "Test Buyer", "ASE-TEST-0001"))
    assert "Fixed the exit-timing bug." in sandbox["html"]


def test_email_includes_pin(sandbox):
    _run(srv.send_pin_email("buyer@example.com", "Test Buyer", "ASE-TEST-0002"))
    assert "ASE-TEST-0002" in sandbox["html"]


def test_email_includes_telegram_support_link(sandbox):
    _run(srv.send_pin_email("buyer@example.com", "Test Buyer", "ASE-TEST-0003"))
    assert "t.me/emrizeth" in sandbox["html"]


def test_email_includes_command_center_link(sandbox):
    _run(srv.send_pin_email("buyer@example.com", "Test Buyer", "ASE-TEST-0004"))
    assert "/command" in sandbox["html"]


def test_email_does_not_hardcode_a_different_version(sandbox, monkeypatch):
    """Promote a second version and confirm the email picks up the NEW
    current version, not whatever was baked in when this code was written."""
    manifest = {
        "current_version": "v8.0.0",
        "releases": {
            "v7.1.0": {"version": "v7.1.0", "stable_status": True, "release_notes": "old"},
            "v8.0.0": {"version": "v8.0.0", "stable_status": True, "release_notes": "new release notes"},
        },
    }
    p = srv.EA_RELEASES_DIR / "manifest.json"
    p.write_text(json.dumps(manifest), encoding="utf-8")
    _run(srv.send_pin_email("buyer@example.com", "Test Buyer", "ASE-TEST-0005"))
    assert "v8.0.0" in sandbox["html"]
    assert "new release notes" in sandbox["html"]


def test_email_handles_no_release_published_gracefully(sandbox):
    p = srv.EA_RELEASES_DIR / "manifest.json"
    p.write_text(json.dumps({"current_version": None, "releases": {}}), encoding="utf-8")
    result = _run(srv.send_pin_email("buyer@example.com", "Test Buyer", "ASE-TEST-0006"))
    assert result is True
    assert "check Command Center" in sandbox["html"]
