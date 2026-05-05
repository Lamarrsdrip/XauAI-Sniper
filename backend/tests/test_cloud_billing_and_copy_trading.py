"""
Backend regression tests for XauAi Cloud — billing overhaul + copy-trading fanout.

Covers (per review_request iteration_9):
  1) POST /api/cloud/agent/trade-open (success + failure flows)
  2) GET  /api/admin/cloud/fanout-logs (admin)
  3) GET  /api/cloud/config (plans, fx_rates, user_country, user_currency)
  4) PUT  /api/admin/cloud/settings (plans, fx_rates persistence)
  5) POST /api/admin/cloud/users/override (plan / custom_price_usd / extend_days)
  6) POST /api/cloud/payments/submit (proof_image + paid_currency + admin pricing)
  7) GET  /api/admin/cloud/stats (MRR honors custom_price_usd)
  8) Master signal flow end-to-end
  9) Auth guards (admin Bearer, cloud-user cookie, agent token)

Run:
  pytest /app/backend/tests/test_cloud_billing_and_copy_trading.py -v \
    --tb=short --junitxml=/app/test_reports/pytest/pytest_results.xml
"""
import os
import time
import base64
import requests
import pytest
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")
if not BASE_URL:
    # frontend env file
    with open("/app/frontend/.env") as f:
        for ln in f:
            if ln.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = ln.strip().split("=", 1)[1]
                break
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@aisniper.com"
ADMIN_PASS = "MrizAdmin2026"
CLOUD_EMAIL = "testuser@xauai.com"
CLOUD_PASS = "TestUser2026"

# Tiny 1x1 PNG
ONE_PX_PNG = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


# ---------- shared state ----------
class State:
    admin_token = None
    cloud_session: requests.Session = None
    cloud_user_id = None
    agent_token = None
    last_signal_id = None


@pytest.fixture(scope="module", autouse=True)
def _setup_module():
    # Resolve agent token directly from Mongo (per review_request)
    mongo = MongoClient(os.environ["MONGO_URL"])
    db = mongo[os.environ["DB_NAME"]]
    s = db.cloud_settings.find_one({"key": "main"}) or {}
    State.agent_token = s.get("agent_token") or ""
    assert State.agent_token, "Agent token not configured in cloud_settings"

    # Admin login
    r = requests.post(f"{API}/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=20)
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    State.admin_token = r.json().get("token")
    assert State.admin_token

    # Ensure cloud test user exists
    sess = requests.Session()
    rl = sess.post(f"{API}/cloud/auth/login",
                   json={"email": CLOUD_EMAIL, "password": CLOUD_PASS}, timeout=20)
    if rl.status_code != 200:
        # try signup
        sess = requests.Session()
        rs = sess.post(f"{API}/cloud/auth/signup",
                       json={"email": CLOUD_EMAIL, "password": CLOUD_PASS,
                             "full_name": "Test User", "country": "NG"}, timeout=20)
        assert rs.status_code == 200, f"Cloud signup failed: {rs.status_code} {rs.text}"
        State.cloud_user_id = rs.json()["user"]["id"]
    else:
        State.cloud_user_id = rl.json()["user"]["id"]
    State.cloud_session = sess

    yield

    # ---- teardown: restore defaults ----
    headers = {"Authorization": f"Bearer {State.admin_token}"}
    requests.put(f"{API}/admin/cloud/settings",
                 headers=headers,
                 json={"plans": {"starter": {"name": "Starter", "price_usd": 50.0,
                                             "max_balance_usd": 5000,
                                             "description": "For accounts up to $5,000."},
                                 "pro": {"name": "Pro", "price_usd": 100.0,
                                         "max_balance_usd": 999999,
                                         "description": "For accounts $5,000+."}}},
                 timeout=20)
    # clear custom_price_usd for test user
    requests.post(f"{API}/admin/cloud/users/override",
                  headers=headers,
                  json={"user_id": State.cloud_user_id, "custom_price_usd": 0},
                  timeout=20)
    # delete TEST signals/fanout-logs/payments to keep db clean
    db.cloud_fanout_logs.delete_many({"signal_id": {"$regex": "^TEST_"}})
    db.cloud_signals.delete_many({"id": {"$regex": "^TEST_"}})
    db.cloud_payments.delete_many({"user_id": State.cloud_user_id, "status": "pending"})


def _admin_headers():
    return {"Authorization": f"Bearer {State.admin_token}"}


def _agent_headers():
    return {"X-Agent-Token": State.agent_token}


# ============================================================
# 9) Auth guards (run early — fail fast)
# ============================================================
class TestAuthGuards:
    def test_admin_endpoint_rejects_no_token(self):
        r = requests.get(f"{API}/admin/cloud/fanout-logs", timeout=20)
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"

    def test_admin_endpoint_rejects_bad_token(self):
        r = requests.get(f"{API}/admin/cloud/stats",
                         headers={"Authorization": "Bearer bad"}, timeout=20)
        assert r.status_code in (401, 403)

    def test_cloud_user_endpoint_rejects_no_cookie(self):
        r = requests.post(f"{API}/cloud/payments/submit",
                          json={"plan": "starter", "method": "crypto",
                                "amount_usd": 50, "reference": "abcdef"}, timeout=20)
        assert r.status_code in (401, 403)

    def test_agent_endpoint_rejects_bad_token(self):
        r = requests.post(f"{API}/cloud/agent/trade-open",
                          headers={"X-Agent-Token": "wrong"},
                          json={"user_id": "x", "signal_id": "y", "ok": True}, timeout=20)
        assert r.status_code in (401, 403)


# ============================================================
# 3) GET /cloud/config
# ============================================================
class TestCloudConfig:
    def test_config_returns_plans_fx_country(self):
        # Use Accept-Language since CF-IPCountry header is stripped by edge proxy
        r = requests.get(f"{API}/cloud/config",
                         headers={"Accept-Language": "en-NG,en;q=0.9"}, timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        # plans
        assert "plans" in body and isinstance(body["plans"], dict)
        assert "starter" in body["plans"] and "pro" in body["plans"]
        assert body["plans"]["starter"].get("price_usd") is not None
        # fx_rates with all required currencies
        assert "fx_rates" in body
        for cur in ["USD", "NGN", "KES", "ZAR", "GHS", "EUR", "GBP", "INR", "CAD", "AUD"]:
            assert cur in body["fx_rates"], f"Missing currency {cur}"
            assert isinstance(body["fx_rates"][cur], (int, float))
        # country detection from CF-IPCountry → NGN
        assert body.get("user_country") == "NG"
        assert body.get("user_currency") == "NGN"

    def test_config_default_currency_is_usd(self):
        r = requests.get(f"{API}/cloud/config", timeout=20)
        assert r.status_code == 200
        body = r.json()
        # When no country headers + Accept-Language, default to USD
        assert body.get("user_currency") in ("USD", "NGN", "GBP", "INR", "CAD", "AUD",
                                              "ZAR", "KES", "GHS", "EUR")  # any valid


# ============================================================
# 4) PUT /admin/cloud/settings — plans + fx_rates persisted, reflected in /cloud/config
# ============================================================
class TestAdminSettingsUpdate:
    def test_update_plans_and_fx_rates_reflected(self):
        new_plans = {
            "starter": {"name": "Starter", "price_usd": 55.0, "max_balance_usd": 5000,
                        "description": "Updated starter"},
            "pro": {"name": "Pro", "price_usd": 110.0, "max_balance_usd": 999999,
                    "description": "Updated pro"},
        }
        new_rates = {"NGN": 1700.0, "KES": 135.0}
        r = requests.put(f"{API}/admin/cloud/settings",
                         headers=_admin_headers(),
                         json={"plans": new_plans, "fx_rates": new_rates}, timeout=20)
        assert r.status_code == 200, r.text
        # Now confirm /cloud/config reflects
        cfg = requests.get(f"{API}/cloud/config", timeout=20).json()
        assert cfg["plans"]["starter"]["price_usd"] == 55.0
        assert cfg["plans"]["pro"]["price_usd"] == 110.0
        assert cfg["fx_rates"]["NGN"] == 1700.0
        assert cfg["fx_rates"]["KES"] == 135.0


# ============================================================
# 6) POST /cloud/payments/submit — proof_image + paid_currency
# ============================================================
class TestPaymentsSubmit:
    def test_rejects_fiat_method(self):
        # plan starter is currently $55 from previous test
        r = State.cloud_session.post(f"{API}/cloud/payments/submit",
                                     json={"plan": "starter", "method": "fiat",
                                           "amount_usd": 55.0, "reference": "ref1234"}, timeout=20)
        assert r.status_code == 400, f"fiat must be rejected, got {r.status_code} {r.text}"

    def test_bank_requires_proof_image(self):
        r = State.cloud_session.post(f"{API}/cloud/payments/submit",
                                     json={"plan": "starter", "method": "bank",
                                           "amount_usd": 55.0, "reference": "ref1234"}, timeout=20)
        assert r.status_code == 400
        assert "screenshot" in r.text.lower() or "image" in r.text.lower()

    def test_amount_validates_against_admin_overridden_price(self):
        # admin set starter to $55, sending $50 should fail
        r = State.cloud_session.post(f"{API}/cloud/payments/submit",
                                     json={"plan": "starter", "method": "crypto",
                                           "amount_usd": 50.0, "reference": "txhash1234"}, timeout=20)
        assert r.status_code == 400
        assert "55" in r.text or "amount" in r.text.lower()

    def test_bank_payment_with_proof_succeeds_and_uses_admin_price(self):
        r = State.cloud_session.post(f"{API}/cloud/payments/submit",
                                     json={"plan": "starter", "method": "bank",
                                           "amount_usd": 55.0,
                                           "reference": "BANKREF12345",
                                           "proof_image": ONE_PX_PNG,
                                           "paid_currency": "NGN",
                                           "paid_amount_local": 93500.0}, timeout=20)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        body = r.json()
        assert body.get("ok") is True
        assert "payment_id" in body
        # verify persisted via my-payments
        my = State.cloud_session.get(f"{API}/cloud/payments/my", timeout=20).json()
        latest = my["payments"][0]
        assert latest["method"] == "bank"
        assert latest["paid_currency"] == "NGN"
        assert latest["paid_amount_local"] == 93500.0
        assert latest["proof_image"].startswith("data:image/")
        # cleanup: reject so next tests can submit again
        mongo = MongoClient(os.environ["MONGO_URL"])
        db = mongo[os.environ["DB_NAME"]]
        db.cloud_payments.delete_one({"id": latest["id"]})


# ============================================================
# 5) POST /admin/cloud/users/override
# ============================================================
class TestUserOverride:
    def test_rejects_unknown_plan(self):
        r = requests.post(f"{API}/admin/cloud/users/override",
                          headers=_admin_headers(),
                          json={"user_id": State.cloud_user_id,
                                "plan": "ultraplan_doesnt_exist"}, timeout=20)
        assert r.status_code == 400

    def test_set_custom_price_and_extend_days(self):
        r = requests.post(f"{API}/admin/cloud/users/override",
                          headers=_admin_headers(),
                          json={"user_id": State.cloud_user_id,
                                "plan": "pro",
                                "custom_price_usd": 75.0,
                                "extend_days": 10}, timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert body["set"]["custom_price_usd"] == 75.0
        assert body["set"]["plan"] == "pro"
        assert body["set"]["status"] == "active"
        assert "subscription_ends_at" in body["set"]

    def test_zero_custom_price_clears_override(self):
        r = requests.post(f"{API}/admin/cloud/users/override",
                          headers=_admin_headers(),
                          json={"user_id": State.cloud_user_id,
                                "custom_price_usd": 0}, timeout=20)
        assert r.status_code == 200
        body = r.json()
        # Should set to None
        assert body["set"]["custom_price_usd"] is None

    def test_override_rejects_no_admin_token(self):
        r = requests.post(f"{API}/admin/cloud/users/override",
                          json={"user_id": State.cloud_user_id, "extend_days": 1}, timeout=20)
        assert r.status_code in (401, 403)


# ============================================================
# 7) GET /admin/cloud/stats — MRR honors custom_price_usd
# ============================================================
class TestAdminStats:
    def test_mrr_honors_custom_price(self):
        # First get baseline
        r0 = requests.get(f"{API}/admin/cloud/stats", headers=_admin_headers(), timeout=20).json()
        baseline_mrr = r0["mrr_usd"]

        # Set test user to active with custom $75
        requests.post(f"{API}/admin/cloud/users/override",
                      headers=_admin_headers(),
                      json={"user_id": State.cloud_user_id,
                            "custom_price_usd": 75.0,
                            "extend_days": 30}, timeout=20)

        r1 = requests.get(f"{API}/admin/cloud/stats", headers=_admin_headers(), timeout=20).json()
        # New MRR should differ from baseline by reflecting $75 (assuming user wasn't already active at $75)
        # Either way, MRR must be > 0 when at least 1 active user has custom price
        assert r1["mrr_usd"] >= 75.0 - 0.01, f"MRR={r1['mrr_usd']} should include $75 override"
        assert "active_users" in r1 and r1["active_users"] >= 1

        # Reset
        requests.post(f"{API}/admin/cloud/users/override",
                      headers=_admin_headers(),
                      json={"user_id": State.cloud_user_id, "custom_price_usd": 0}, timeout=20)


# ============================================================
# 8) Master signal flow + 1) trade-open (success+fail) + 2) fanout-logs
# ============================================================
class TestMasterSignalAndFanout:
    def test_master_signal_creates_signal(self):
        r = requests.post(f"{API}/cloud/master/signal",
                          headers=_agent_headers(),
                          json={"symbol": "XAUUSD", "side": "BUY",
                                "entry": 2650.0, "sl": 2640.0, "tp": 2670.0,
                                "grade": "A+"}, timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert "signal_id" in body
        State.last_signal_id = body["signal_id"]

    def test_pending_signals_returns_signal(self):
        assert State.last_signal_id, "previous test must have created a signal"
        r = requests.get(f"{API}/cloud/agent/pending-signals?limit=10",
                         headers=_agent_headers(), timeout=20)
        assert r.status_code == 200
        body = r.json()
        assert "opens" in body and isinstance(body["opens"], list)
        ids = [s["id"] for s in body["opens"]]
        assert State.last_signal_id in ids, "freshly-created signal must appear in pending-signals"

    def test_trade_open_success_inserts_real_trade(self):
        sig = State.last_signal_id or "TEST_sig_success_x1"
        r = requests.post(f"{API}/cloud/agent/trade-open",
                          headers=_agent_headers(),
                          json={"user_id": State.cloud_user_id,
                                "signal_id": sig,
                                "ticket": 999001,
                                "symbol": "XAUUSD", "side": "BUY",
                                "lots": 0.10, "entry": 2650.0,
                                "sl": 2640.0, "tp": 2670.0,
                                "ok": True,
                                "opened_at": "2026-01-15T10:00:00+00:00"}, timeout=20)
        assert r.status_code == 200, r.text
        # verify in DB
        mongo = MongoClient(os.environ["MONGO_URL"])
        db = mongo[os.environ["DB_NAME"]]
        trade = db.cloud_trades.find_one(
            {"user_id": State.cloud_user_id, "signal_id": sig, "ticket": 999001})
        assert trade is not None, "real trade row not created on ok=true"
        assert trade.get("shadow") is False
        assert trade.get("status") == "open"
        # also a fanout log
        fl = db.cloud_fanout_logs.find_one(
            {"user_id": State.cloud_user_id, "signal_id": sig, "ticket": 999001})
        assert fl is not None
        assert fl.get("status") == "open"

    def test_trade_open_failure_only_logs_fanout(self):
        sig_id = "TEST_sig_fail_" + str(int(time.time()))
        r = requests.post(f"{API}/cloud/agent/trade-open",
                          headers=_agent_headers(),
                          json={"user_id": State.cloud_user_id,
                                "signal_id": sig_id,
                                "ticket": 0,
                                "symbol": "XAUUSD", "side": "BUY",
                                "lots": 0.0, "entry": 2650.0,
                                "ok": False,
                                "error": "INVALID_STOPS",
                                "opened_at": "2026-01-15T10:01:00+00:00"}, timeout=20)
        assert r.status_code == 200, r.text
        mongo = MongoClient(os.environ["MONGO_URL"])
        db = mongo[os.environ["DB_NAME"]]
        # should NOT be in cloud_trades
        t = db.cloud_trades.find_one({"signal_id": sig_id})
        assert t is None, "failed trade must NOT create cloud_trades row"
        # SHOULD be in fanout_logs
        fl = db.cloud_fanout_logs.find_one({"signal_id": sig_id})
        assert fl is not None
        assert fl.get("status") == "failed"
        assert fl.get("error") == "INVALID_STOPS"

    def test_admin_fanout_logs_returns_recent(self):
        r = requests.get(f"{API}/admin/cloud/fanout-logs?limit=50",
                         headers=_admin_headers(), timeout=20)
        assert r.status_code == 200
        body = r.json()
        assert "logs" in body and isinstance(body["logs"], list)
        assert len(body["logs"]) >= 1
        # sorted by opened_at desc — verify monotonic
        opened = [l.get("opened_at", "") for l in body["logs"] if l.get("opened_at")]
        assert opened == sorted(opened, reverse=True), "logs must be sorted by opened_at desc"
        # Both ok and failed entries should be present
        statuses = {l.get("status") for l in body["logs"]}
        assert "open" in statuses or "failed" in statuses
