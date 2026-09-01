"""Tests for the customer email & admin notification redesign (owner spec,
2026-08-04): every branding/link field is admin-editable via
GET/PUT /admin/settings, resolves to a sane default when unset
(_email_branding), and none of the new fields are ever treated as secrets
(no masking, unlike paystack_secret_key/smtp_password/onesignal_api_key).
"""
import sys
import os
import uuid
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


pytestmark = pytest.mark.skipif(not _mongo_available(), reason="no local MongoDB reachable for this test")

TEST_DB = f"email_branding_pytest_{uuid.uuid4().hex[:10]}"
os.environ["MONGO_URL"] = "mongodb://localhost:27017"
os.environ["DB_NAME"] = TEST_DB
os.environ.setdefault("JWT_SECRET", "test-secret-email-branding")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")

import server as srv  # noqa: E402

_LOOP = asyncio.new_event_loop()


def _run(coro):
    return _LOOP.run_until_complete(coro)


ADMIN = {"email": "admin@test.com", "role": "admin"}


async def _clear():
    await srv.db.admin_settings.delete_many({})


def setup_function(_fn):
    _run(_clear())


def test_email_branding_defaults_when_nothing_configured():
    result = _run(srv._email_branding())
    assert result["sender_name"] == "XauCloud"
    assert result["admin_notification_email"] == ""
    assert result["mt5_download_url"] == "https://www.metatrader5.com/en/download"
    assert result["command_center_url"] == f"{srv.PUBLIC_SITE_URL}/command"
    assert result["vps_guide_url"] == f"{srv.PUBLIC_SITE_URL}/command"
    assert result["installation_guide_url"] == f"{srv.PUBLIC_SITE_URL}/command"
    assert result["community_link"] == ""


def test_admin_settings_put_persists_and_get_reflects_new_fields():
    async def go():
        await srv.update_admin_settings(
            srv.AdminSettingsUpdate(
                email_sender_name="XauCloud Support",
                admin_notification_email="Owner@XauCloud.com",
                support_email="Help@XauCloud.com",
                support_phone="+234 800 111 2222",
                community_link="https://t.me/xaucloud",
                mt5_download_url="https://example.com/mt5",
                vps_guide_url="https://example.com/vps",
                installation_guide_url="https://example.com/install",
                command_center_url="https://example.com/command",
            ),
            admin=ADMIN,
        )
        result = await srv.get_admin_settings(admin=ADMIN)
        assert result["email_sender_name"] == "XauCloud Support"
        # admin_notification_email and support_email are lowercased on write
        assert result["admin_notification_email"] == "owner@xaucloud.com"
        assert result["support_email"] == "help@xaucloud.com"
        assert result["support_phone"] == "+234 800 111 2222"
        assert result["community_link"] == "https://t.me/xaucloud"
        assert result["mt5_download_url"] == "https://example.com/mt5"
        assert result["vps_guide_url"] == "https://example.com/vps"
        assert result["installation_guide_url"] == "https://example.com/install"
        assert result["command_center_url"] == "https://example.com/command"
        # None of these are ever masked -- unlike paystack_secret_key etc,
        # they are meant to be visible/editable, not secret.
        assert "paystack_configured" in result
    _run(go())


def test_email_branding_reflects_admin_overrides():
    async def go():
        await srv.update_admin_settings(
            srv.AdminSettingsUpdate(email_sender_name="Acme Trading", admin_notification_email="owner@acme.com",
                                     mt5_download_url="https://acme.com/mt5"),
            admin=ADMIN,
        )
        result = await srv._email_branding()
        assert result["sender_name"] == "Acme Trading"
        assert result["admin_notification_email"] == "owner@acme.com"
        assert result["mt5_download_url"] == "https://acme.com/mt5"
        # unset fields still fall back to their defaults
        assert result["command_center_url"] == f"{srv.PUBLIC_SITE_URL}/command"
    _run(go())


def test_support_email_falls_back_to_smtp_email_when_unset():
    async def go():
        await srv.update_admin_settings(srv.AdminSettingsUpdate(smtp_email="ops@xaucloud.com"), admin=ADMIN)
        result = await srv._email_branding()
        assert result["support_email"] == "ops@xaucloud.com"
    _run(go())


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
