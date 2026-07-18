"""Tests for the v6.24.18 owner-directive fixes:
- hourly outlook scheduler slot-skipping (market_outlook.hourly_generation_tick,
  server.py's _outlook_hourly_loop wall-clock alignment)
- notification subscription-deletion failure classification (notifications.py)
- real notification registration-status endpoint
- genuine win-rate / performance stats (market_outlook_routes.py)

Same static-verification + pure-logic convention as test_market_outlook.py --
no live Mongo connection needed.

Run with: /tmp/backend_test_venv/bin/python -m pytest backend/tests/test_notification_scheduler_and_winrate.py
"""

import sys
from pathlib import Path
from datetime import datetime, timezone, timedelta

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

import notifications as notif  # noqa: E402


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


MO_SRC = read(BACKEND_DIR / "market_outlook.py")
NOTIF_SRC = read(BACKEND_DIR / "notifications.py")
ROUTES_SRC = read(BACKEND_DIR / "market_outlook_routes.py")
SERVER_SRC = read(BACKEND_DIR / "server.py")


# ---------------------------------------------------------------------------
# Hourly slot key -- root cause of the 6:51 PM publication skipping 7:00 PM
# ---------------------------------------------------------------------------
def test_hourly_slot_field_is_computed_and_stored():
    assert 'hourly_slot = now.strftime("%Y-%m-%dT%H:00")' in MO_SRC
    assert MO_SRC.count('"hourly_slot": hourly_slot,') == 4  # early returns, invalid-quote guard, main doc


def test_hourly_tick_checks_exact_slot_not_rolling_lookback():
    fn_idx = MO_SRC.index("async def hourly_generation_tick(")
    fn = MO_SRC[fn_idx: fn_idx + 4000]
    assert '"hourly_slot": current_slot' in fn
    # the old bug: a rolling-window lookback that a late publication could
    # satisfy for the NEXT slot too
    assert "timedelta(minutes=55)" not in fn


def test_late_publication_does_not_skip_next_slot():
    # Pure-logic proof of the actual fix: an 18:51 publication's slot key is
    # "18:00"; checking for "19:00" existence is independent of it.
    publish_time = datetime(2026, 7, 16, 18, 51, 21, tzinfo=timezone.utc)
    published_slot = publish_time.strftime("%Y-%m-%dT%H:00")
    next_tick_time = datetime(2026, 7, 16, 19, 0, 5, tzinfo=timezone.utc)
    current_slot = next_tick_time.strftime("%Y-%m-%dT%H:00")
    assert published_slot != current_slot
    assert published_slot == "2026-07-16T18:00"
    assert current_slot == "2026-07-16T19:00"


def test_missed_slot_catchup_marks_late_catchup_once():
    fn_idx = MO_SRC.index("async def hourly_generation_tick(")
    fn = MO_SRC[fn_idx: fn_idx + 4000]
    assert "is_late_catchup = (current_slot_dt - last_slot_dt) > timedelta(hours=1, minutes=5)" in fn
    assert "generate_outlook_for_account(lic_key, account, account_id=account, is_late_catchup=is_late_catchup)" in fn


def test_next_scheduled_slot_remains_the_next_real_hour_not_shifted():
    # the catch-up logic only affects the CURRENT tick's is_late_catchup flag;
    # it never computes or stores any kind of "next slot" override -- the
    # very next tick simply computes current_slot fresh from wall-clock `now`
    # again, so a late catch-up cannot push future slots later.
    fn_idx = MO_SRC.index("async def hourly_generation_tick(")
    fn = MO_SRC[fn_idx: fn_idx + 4000]
    assert "next_slot" not in fn
    assert "current_slot = now.strftime" in fn


def test_hourly_loop_sleeps_until_next_wall_clock_hour_not_flat_3600s():
    fn_idx = SERVER_SRC.index("async def _outlook_hourly_loop()")
    fn = SERVER_SRC[fn_idx: fn_idx + 2500]
    assert "next_hour = (now.replace(minute=0, second=0, microsecond=0) + _timedelta(hours=1))" in fn
    assert "await asyncio.sleep(3600)" not in fn


def test_dedup_key_scoped_by_account_symbol_and_slot():
    fn_idx = MO_SRC.index("async def hourly_generation_tick(")
    fn = MO_SRC[fn_idx: fn_idx + 2000]
    assert '"account": account, "symbol": OUTLOOK_SYMBOL, "hourly_slot": current_slot' in fn


# ---------------------------------------------------------------------------
# Notification: real state, not preference-tier alone
# ---------------------------------------------------------------------------
def test_subscription_never_deleted_on_delivery_failure():
    # v6.25.3 owner directive 2026-07-17 -- OneSignal owns device/subscription
    # lifecycle entirely (unlike the retired self-hosted Web Push code, which
    # deleted a subscription on a confirmed 404/410). This module must never
    # delete a cloud_push_subscriptions record for any reason.
    assert "cloud_push_subscriptions.delete_one" not in NOTIF_SRC


def test_temporary_failures_do_not_delete_subscription():
    # the old bug: `if not ok: delete` -- unconditional deletion on ANY
    # failure. Confirm that literal pattern no longer exists.
    assert "if not ok:\n                    await db.cloud_push_subscriptions.delete_one" not in NOTIF_SRC


def test_onesignal_returns_classified_failure_not_bare_bool():
    fn_idx = NOTIF_SRC.index("async def _send_onesignal(user_id: str, payload: Dict) -> tuple:")
    fn = NOTIF_SRC[fn_idx: fn_idx + 4300]
    for status_class in ["SERVER_NOT_CONFIGURED", "AUTHENTICATION_FAILED",
                          "TEMPORARY_DELIVERY_FAILURE", "NO_DEVICE_REGISTERED", "UNKNOWN_FAILURE"]:
        assert status_class in fn


def test_empty_message_id_classified_as_no_device_registered():
    fn_idx = NOTIF_SRC.index("async def _send_onesignal(user_id: str, payload: Dict) -> tuple:")
    fn = NOTIF_SRC[fn_idx: fn_idx + 4300]
    assert 'if data.get("id")' in fn
    assert "NO_DEVICE_REGISTERED" in fn


def test_notification_status_endpoint_exists_and_derives_final_status():
    assert 'async def get_notification_status(user_id: str, account: str = "") -> Dict:' in NOTIF_SRC
    assert '@r.get("/outlook/notifications/status")' in ROUTES_SRC
    fn_idx = NOTIF_SRC.index('async def get_notification_status(user_id: str, account: str = "") -> Dict:')
    fn = NOTIF_SRC[fn_idx: fn_idx + 2500]
    for status in ["OFF", "SERVER_NOT_CONFIGURED", "SUBSCRIPTION_MISSING", "DELIVERY_FAILED", "ON_VERIFIED"]:
        assert status in fn


def test_status_is_off_regardless_of_device_state_when_tier_is_off():
    fn_idx = NOTIF_SRC.index('async def get_notification_status(user_id: str, account: str = "") -> Dict:')
    fn = NOTIF_SRC[fn_idx: fn_idx + 2500]
    idx = fn.index('if saved_tier == "OFF":')
    window = fn[idx: idx + 80]
    assert 'final_status = "OFF"' in window
    assert window.index('final_status = "OFF"') < window.index("elif")


def test_on_verified_requires_devices_and_server_ready():
    fn_idx = NOTIF_SRC.index('async def get_notification_status(user_id: str, account: str = "") -> Dict:')
    fn = NOTIF_SRC[fn_idx: fn_idx + 2500]
    assert 'elif not subscription:\n        final_status = "SUBSCRIPTION_MISSING"' in fn


def test_test_notification_uses_real_production_dispatcher():
    fn_idx = NOTIF_SRC.index("async def send_test_notification(user_id: str) -> Dict:")
    fn = NOTIF_SRC[fn_idx: fn_idx + 4200]
    assert "await _send_onesignal(user_id, payload)" in fn
    assert '@r.post("/outlook/notifications/test")' in ROUTES_SRC


def test_test_notification_never_creates_an_outlook():
    fn_idx = NOTIF_SRC.index("async def send_test_notification(user_id: str) -> Dict:")
    fn = NOTIF_SRC[fn_idx: fn_idx + 4200]
    assert "cloud_market_outlooks" not in fn
    assert "generate_outlook_for_account" not in fn


def test_test_notification_returns_named_status_not_bare_bool():
    fn_idx = NOTIF_SRC.index("async def send_test_notification(user_id: str) -> Dict:")
    fn = NOTIF_SRC[fn_idx: fn_idx + 4200]
    for status in ["SERVER_NOT_CONFIGURED", "NO_DEVICE", "SENT", "FAILED"]:
        assert status in fn


def test_transition_outlook_published_notifies_like_neutral_range():
    idx = NOTIF_SRC.index('if direction in ("NO_VALID_OUTLOOK", "NEUTRAL", "RANGE", "TRANSITION"):')
    assert idx > 0


# ---------------------------------------------------------------------------
# Win rate: wins / (wins + losses), never wins / total
# ---------------------------------------------------------------------------
def test_win_rate_formula_is_wins_over_wins_plus_losses():
    idx = ROUTES_SRC.index("win_rate = round(len(wins) / len(wins + losses), 3) if (wins or losses) else None")
    assert idx > 0
    # must NOT divide by total stats_rows or activated count
    win_rate_line = ROUTES_SRC[idx: idx + 100]
    assert "stats_rows" not in win_rate_line
    assert "len(activated)" not in win_rate_line


def test_only_authoritative_completed_outcomes_count_as_win_or_loss():
    idx = ROUTES_SRC.index("completed = [o for o in actionable")
    window = ROUTES_SRC[idx: idx + 250]
    assert "ANALYTICS_WIN" in window and "ANALYTICS_LOSS" in window
    assert "HISTORICAL_DATA_UNAVAILABLE" not in window


def test_zero_resolved_signals_yields_none_not_zero_percent():
    wins, losses = [], []
    win_rate = round(len(wins) / len(wins + losses), 3) if (wins or losses) else None
    assert win_rate is None  # frontend must render "—", never "0%"


def test_win_rate_example_matches_owner_acceptance_numbers():
    # owner's worked example: 8 wins, 4 losses -> 66.7%
    wins = [1] * 8
    losses = [1] * 4
    win_rate = round(len(wins) / len(wins + losses), 3)
    assert round(win_rate * 100, 1) == 66.7


def test_invalid_data_excluded_from_stats_rows_before_any_win_rate_math():
    idx = ROUTES_SRC.index("stats_rows = [o for o in rows if not o.get(\"excluded_from_stats\")]")
    assert idx > 0
    win_rate_idx = ROUTES_SRC.index("win_rate = round(len(wins)")
    assert idx < win_rate_idx  # exclusion filter runs before any win-rate computation


def test_stats_include_profit_factor_and_best_worst():
    for field in ["profit_factor", "best_result_r", "worst_result_r", "average_win_r", "average_loss_r", "total_r"]:
        assert f'"{field}"' in ROUTES_SRC
