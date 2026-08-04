"""Tests for the indicative-currency display layer on top of the NGN
purchase flow: _detect_display_currency(), _get_fx_rates(), and
_build_price_display(). NGN 300,000 (admin-configured pin_price_kobo)
remains the sole commercial source of truth and the sole currency Nomba
actually charges -- everything here is a convenience conversion shown to
the visitor, never something that changes what they're billed.
"""
import sys
import os
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "currency_display_pytest")
os.environ.setdefault("JWT_SECRET", "test-secret-currency")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")

import server as srv  # noqa: E402

_LOOP = asyncio.new_event_loop()


def _run(coro):
    return _LOOP.run_until_complete(coro)


def _fake_request(headers: dict):
    req = MagicMock()
    req.headers = {k.lower(): v for k, v in headers.items()}
    return req


class TestDetectDisplayCurrency:
    def test_explicit_request_wins(self):
        req = _fake_request({})
        assert srv._detect_display_currency(req, "EUR") == "EUR"

    def test_explicit_request_uppercased(self):
        req = _fake_request({})
        assert srv._detect_display_currency(req, "eur") == "EUR"

    def test_cf_ipcountry_nigeria_maps_to_ngn(self):
        req = _fake_request({"cf-ipcountry": "NG"})
        assert srv._detect_display_currency(req) == "NGN"

    def test_cf_ipcountry_us_maps_to_usd(self):
        req = _fake_request({"cf-ipcountry": "US"})
        assert srv._detect_display_currency(req) == "USD"

    def test_cf_ipcountry_germany_maps_to_eur(self):
        req = _fake_request({"cf-ipcountry": "DE"})
        assert srv._detect_display_currency(req) == "EUR"

    def test_unknown_country_defaults_to_usd(self):
        req = _fake_request({"cf-ipcountry": "ZZ"})
        assert srv._detect_display_currency(req) == "USD"

    def test_accept_language_fallback_when_no_country_header(self):
        req = _fake_request({"accept-language": "en-NG,en;q=0.9"})
        assert srv._detect_display_currency(req) == "NGN"

    def test_no_signal_at_all_defaults_to_usd(self):
        req = _fake_request({})
        assert srv._detect_display_currency(req) == "USD"

    def test_x_vercel_ip_country_used_if_cf_header_absent(self):
        req = _fake_request({"x-vercel-ip-country": "GB"})
        assert srv._detect_display_currency(req) == "GBP"


class TestBuildPriceDisplay:
    def test_ngn_display_is_exact_not_indicative(self):
        async def go():
            result = await srv._build_price_display("NGN")
            assert result["fx_rate_indicative"] is False
            assert result["display_amount"] == result["price_naira"]
            assert result["charge_currency"] == "NGN"
        _run(go())

    def test_non_ngn_without_configured_api_key_has_no_conversion(self):
        async def go():
            with patch.object(srv, "EXCHANGE_RATE_API_KEY", ""):
                with patch.object(srv, "_fx_rate_cache", {}):
                    result = await srv._build_price_display("USD")
                    assert result["display_amount"] is None
                    assert result["display_currency"] == "USD"
                    assert result["charge_currency"] == "NGN"  # always NGN regardless of display currency
        _run(go())

    def test_non_ngn_with_cached_rate_converts(self):
        async def go():
            with patch.object(srv, "_fx_rate_cache", {"USD": 0.00065}):
                with patch.object(srv, "_fx_rate_cache_time", srv.time.time()):
                    result = await srv._build_price_display("USD")
                    assert result["display_amount"] is not None
                    assert result["fx_rate"] == 0.00065
                    assert result["fx_rate_indicative"] is True
                    assert result["charge_currency"] == "NGN"
        _run(go())

    def test_charge_currency_always_ngn_regardless_of_display(self):
        async def go():
            for currency in ("NGN", "USD", "EUR", "GBP"):
                result = await srv._build_price_display(currency)
                assert result["charge_currency"] == "NGN"
                assert result["currency"] == "NGN"
        _run(go())


class TestGetFxRates:
    def test_returns_empty_dict_when_no_api_key(self):
        async def go():
            with patch.object(srv, "EXCHANGE_RATE_API_KEY", ""):
                with patch.object(srv, "_fx_rate_cache", {}):
                    with patch.object(srv, "_fx_rate_cache_time", 0):
                        rates = await srv._get_fx_rates()
                        assert rates == {}
        _run(go())

    def test_uses_cache_within_ttl(self):
        async def go():
            fake_rates = {"USD": 0.00065}
            with patch.object(srv, "_fx_rate_cache", fake_rates):
                with patch.object(srv, "_fx_rate_cache_time", srv.time.time()):
                    rates = await srv._get_fx_rates()
                    assert rates == fake_rates
        _run(go())

    def test_fetches_fresh_when_configured_and_cache_stale(self):
        async def go():
            mock_resp = MagicMock()
            mock_resp.status_code = 200
            mock_resp.json.return_value = {"result": "success", "conversion_rates": {"USD": 0.0007}}
            mock_client = AsyncMock()
            mock_client.get = AsyncMock(return_value=mock_resp)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            with patch.object(srv, "EXCHANGE_RATE_API_KEY", "fake-key"):
                with patch.object(srv, "_fx_rate_cache", {}):
                    with patch.object(srv, "_fx_rate_cache_time", 0):
                        with patch.object(srv.httpx, "AsyncClient", return_value=mock_client):
                            rates = await srv._get_fx_rates()
                            assert rates == {"USD": 0.0007}
        _run(go())

    def test_never_fabricates_a_rate_on_fetch_failure(self):
        async def go():
            mock_client = AsyncMock()
            mock_client.get = AsyncMock(side_effect=Exception("network error"))
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            with patch.object(srv, "EXCHANGE_RATE_API_KEY", "fake-key"):
                with patch.object(srv, "_fx_rate_cache", {}):
                    with patch.object(srv, "_fx_rate_cache_time", 0):
                        with patch.object(srv.httpx, "AsyncClient", return_value=mock_client):
                            rates = await srv._get_fx_rates()
                            assert rates == {}
        _run(go())
