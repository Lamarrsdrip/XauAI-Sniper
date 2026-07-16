"""Tests for the AI Market Outlook feature (backend/market_outlook.py,
backend/notifications.py, backend/market_outlook_routes.py).

These tests run WITHOUT a live Mongo connection -- every function tested
here is pure logic (confidence scoring, zone/target calculation, lifecycle
classification, idempotency-key construction). Functions that need `db`
(evidence gathering, generation, persistence) are exercised only via static
source-text checks confirming they call the lazy `_db()`/`_server()`
accessors rather than touching any EA-facing collection or function --
matching the static-verification convention already used for the MQL5 EA
in this repo (tests/test_xau_*.py).

Run with: /tmp/backend_test_venv/bin/python -m pytest backend/tests/test_market_outlook.py
(a dedicated venv with pydantic+fastapi+pytest, since this repo's backend
has no committed venv and the full runtime needs a live MongoDB this
environment doesn't have.)
"""

import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

import market_outlook as mo  # noqa: E402
import notifications as notif  # noqa: E402


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


MO_SRC = read(BACKEND_DIR / "market_outlook.py")
NOTIF_SRC = read(BACKEND_DIR / "notifications.py")
ROUTES_SRC = read(BACKEND_DIR / "market_outlook_routes.py")


# ---------------------------------------------------------------------------
# 1-3: strict separation from live trading (static verification)
# ---------------------------------------------------------------------------

def test_no_trade_execution_calls_anywhere_in_outlook_module():
    forbidden = ["OpenTrade(", "trade.Buy(", "trade.Sell(", "PositionClose(",
                "cloud_bot_commands.insert", "cloud_force_close_queue"]
    for term in forbidden:
        assert term not in MO_SRC, f"found forbidden trading call '{term}' in market_outlook.py"
        assert term not in NOTIF_SRC, f"found forbidden trading call '{term}' in notifications.py"
        assert term not in ROUTES_SRC, f"found forbidden trading call '{term}' in market_outlook_routes.py"


def test_outlook_module_only_writes_its_own_collections():
    import re
    writes = re.findall(r'db\.(\w+)\.(?:insert_one|update_one|delete_one|update_many)', MO_SRC)
    own_collections = {"cloud_market_outlooks", "cloud_market_outlook_revisions", "cloud_market_outlook_outcomes"}
    for coll in writes:
        assert coll in own_collections, f"market_outlook.py writes to unexpected collection: {coll}"


def test_notifications_module_only_writes_its_own_collections():
    import re
    writes = re.findall(r'db\.(\w+)\.(?:insert_one|update_one|delete_one|update_many)', NOTIF_SRC)
    own_collections = {"cloud_notification_log", "cloud_push_subscriptions"}
    for coll in writes:
        assert coll in own_collections, f"notifications.py writes to unexpected collection: {coll}"


def test_routes_only_write_outlook_and_notification_collections():
    import re
    writes = re.findall(r'db\.(\w+)\.(?:insert_one|update_one|delete_one|update_many)', ROUTES_SRC)
    own_collections = {"cloud_notification_prefs", "cloud_push_subscriptions"}
    for coll in writes:
        assert coll in own_collections, f"market_outlook_routes.py writes to unexpected collection: {coll}"


def test_generate_outlook_never_calls_readiness_engine_mutating_functions():
    # confirms no accidental import/call of anything that would touch the
    # EA's OWN readiness state (this module only READS EA-posted JSON, it
    # never calls back into any EA-control surface). MQL5 function names
    # can never legitimately appear in this Python file at all; the
    # collection name is checked as a real db.<collection> access, since
    # the module's own docstring legitimately names it as documentation of
    # what is NOT touched.
    for term in ("XAU_UpdateEntryReadiness", "XAU_CampaignOpenCore"):
        assert term not in MO_SRC
    assert "db.cloud_bot_commands" not in MO_SRC


# ---------------------------------------------------------------------------
# 4-7: direction/lifecycle support
# ---------------------------------------------------------------------------

def test_all_required_primary_directions_supported():
    assert set(mo.PRIMARY_DIRECTIONS) == {"BUY", "SELL", "NEUTRAL", "RANGE", "TRANSITION", "NO_VALID_OUTLOOK"}


def test_all_required_lifecycle_states_defined():
    required = {"ANALYZING", "PUBLISHED", "WAITING_FOR_ENTRY_ZONE", "ENTRY_ZONE_ACTIVE",
               "CONFIRMATION_PENDING", "ACTIVE", "TP1_HIT", "TP2_HIT", "TP3_HIT",
               "INVALIDATED", "EXPIRED", "MISSED_WITHOUT_ENTRY", "CANCELLED_BY_NEW_STRUCTURE"}
    assert required.issubset(set(mo.LIFECYCLE_STATES))


def test_no_valid_outlook_is_a_real_supported_direction_not_forced_buy_sell():
    # generate_outlook_for_account's no-evidence branch must set this
    # exact literal, not silently default to BUY/SELL
    assert '"primary_direction": "NO_VALID_OUTLOOK"' in MO_SRC


# ---------------------------------------------------------------------------
# 8-9: confidence model with stored components; not automatically current price
# ---------------------------------------------------------------------------

def test_confidence_components_are_all_stored_not_just_final_percent():
    c = mo._compute_confidence(1, {"buy_pressure": 70, "sell_pressure": 30, "location": "LOCATION_GOOD",
                                   "structure": "STRUCTURE_SUPPORTS", "exhaustion_pct": 20,
                                   "remaining_room_r": 2.0, "action": "ALLOW_CORE"}, {})
    d = c.model_dump()
    for field in ("trend_alignment", "structure", "pressure", "location", "exhaustion",
                  "remaining_room", "liquidity_clarity", "session_news_stability"):
        assert field in d
        assert 0.0 <= d[field] <= 100.0


def test_confidence_is_not_readiness_low_evidence_gives_low_confidence():
    weak = mo._compute_confidence(1, {"buy_pressure": 40, "sell_pressure": 45, "location": "LOCATION_EXTREME",
                                      "structure": "STRUCTURE_OPPOSES", "exhaustion_pct": 90,
                                      "remaining_room_r": 0.2, "action": "WAIT_FOR_PULLBACK"}, {})
    strong = mo._compute_confidence(1, {"buy_pressure": 85, "sell_pressure": 15, "location": "LOCATION_EXCELLENT",
                                        "structure": "STRUCTURE_STRONGLY_SUPPORTS", "exhaustion_pct": 10,
                                        "remaining_room_r": 3.0, "action": "ALLOW_CORE"}, {})
    assert mo._confidence_pct(weak) < mo._confidence_pct(strong)


def test_entry_zone_is_not_automatically_current_price():
    zone = mo._compute_zone_and_targets(1, current_price=4050.0, thesis={"movement_consumed_pct": 40.0, "remaining_room_r": 2.0}, atr_estimate=14.0)
    assert zone["preferred_entry_zone_low"] != 4050.0
    assert zone["preferred_entry_zone_high"] != 4050.0
    assert zone["preferred_entry_zone_low"] < 4050.0  # BUY pullback zone sits below current price
    assert zone["preferred_entry_zone_high"] < 4050.0


def test_targets_computed_from_real_room_not_blind_fixed_r_multiplication():
    zone_low_room = mo._compute_zone_and_targets(1, 4050.0, {"movement_consumed_pct": 40.0, "remaining_room_r": 0.6}, 14.0)
    zone_high_room = mo._compute_zone_and_targets(1, 4050.0, {"movement_consumed_pct": 40.0, "remaining_room_r": 3.0}, 14.0)
    # a low-room thesis must NOT produce the same TP3 distance as a high-room one
    assert zone_low_room["tp3_r"] != zone_high_room["tp3_r"]
    assert zone_low_room["tp3_r"] < zone_high_room["tp3_r"]


def test_target_r_values_are_ordered_tp1_lt_tp2_lt_tp3():
    zone = mo._compute_zone_and_targets(1, 4050.0, {"movement_consumed_pct": 30.0, "remaining_room_r": 3.0}, 14.0)
    assert zone["tp1_r"] < zone["tp2_r"] < zone["tp3_r"]


def test_sell_direction_zone_sits_above_current_price():
    zone = mo._compute_zone_and_targets(-1, current_price=4050.0, thesis={"movement_consumed_pct": 40.0, "remaining_room_r": 2.0}, atr_estimate=14.0)
    assert zone["preferred_entry_zone_low"] > 4050.0
    assert zone["preferred_entry_zone_high"] > 4050.0
    assert zone["tp1_price"] < 4050.0  # SELL targets go down


# ---------------------------------------------------------------------------
# 10: entering zone alone does not always activate
# ---------------------------------------------------------------------------

def test_advance_outlook_state_requires_favorable_confirmation_not_just_zone_touch():
    src = MO_SRC[MO_SRC.index("async def _advance_outlook_state"):]
    assert "favorable_confirm" in src[:4000]
    # confirms activation is gated on a confirmation margin, not the raw
    # entry_zone_reached boolean alone
    assert "if entry_zone_reached:" in src[:4000]
    assert "favorable_confirm = " in src[:4000]


# ---------------------------------------------------------------------------
# 11-12: immutability + revisions stored separately
# ---------------------------------------------------------------------------

def test_revisions_are_a_separate_collection_from_the_outlook_itself():
    assert "cloud_market_outlook_revisions" in MO_SRC
    assert "async def _record_revision" in MO_SRC
    fn = MO_SRC[MO_SRC.index("async def _record_revision"):]
    fn_body = fn[:fn.index("\n\n\n")]
    for field in ("outlook_id", "revision_time", "field", "previous_value", "new_value", "reason"):
        assert field in fn_body


def test_generation_only_ever_inserts_never_updates_the_original_outlook_doc():
    fn = MO_SRC[MO_SRC.index("async def generate_outlook_for_account"):]
    fn_body = fn[:fn.index("\n\nasync def hourly_generation_tick")]
    assert "insert_one" in fn_body
    assert "update_one" not in fn_body  # generation never mutates a prior outlook


# ---------------------------------------------------------------------------
# 13-16: SL/TP event ordering
# ---------------------------------------------------------------------------

def test_sl_checked_before_tp_in_activated_branch():
    fn = MO_SRC[MO_SRC.index("# Activated: check SL vs TP1/2/3"):]
    sl_idx = fn.index("sl_hit = ")
    tp_idx = fn.index("hit_now = None")
    assert sl_idx < tp_idx


def test_classify_final_result_tp_before_sl_is_green():
    assert mo._classify_final_result(highest_tp=1, sl_hit=False, activated=True, entry_zone_reached=True) == "GREEN_TP1"
    assert mo._classify_final_result(highest_tp=2, sl_hit=False, activated=True, entry_zone_reached=True) == "GREEN_TP2"
    assert mo._classify_final_result(highest_tp=3, sl_hit=False, activated=True, entry_zone_reached=True) == "GREEN_TP3"


def test_classify_final_result_sl_before_any_tp_is_red():
    assert mo._classify_final_result(highest_tp=None, sl_hit=True, activated=True, entry_zone_reached=True) == "RED_STOPPED"


def test_classify_final_result_no_entry_is_gray_not_red():
    assert mo._classify_final_result(highest_tp=None, sl_hit=False, activated=False, entry_zone_reached=False) == "GRAY_EXPIRED_NO_ENTRY"
    result = mo._classify_final_result(highest_tp=None, sl_hit=False, activated=False, entry_zone_reached=False)
    assert not result.startswith("RED")


def test_classify_final_result_invalidated_before_entry_is_gray():
    result = mo._classify_final_result(highest_tp=None, sl_hit=False, activated=False, entry_zone_reached=True)
    assert result == "GRAY_INVALIDATED_BEFORE_ENTRY"


def test_time_expiry_alone_does_not_mark_red_when_never_activated():
    # an outlook that simply expires without ever reaching its entry zone
    # must be GRAY, never RED -- time passing is not a loss
    result = mo._classify_final_result(highest_tp=None, sl_hit=False, activated=False, entry_zone_reached=False)
    assert not result.startswith("RED")
    assert result.startswith("GRAY")


# ---------------------------------------------------------------------------
# 17: MFE/MAE recorded
# ---------------------------------------------------------------------------

def test_advance_outlook_state_tracks_mfe_and_mae():
    assert "mfe = max(mfe, favorable)" in MO_SRC
    assert "mae = max(mae, -favorable)" in MO_SRC


# ---------------------------------------------------------------------------
# 19: confidence calibration reportable via outcomes collection
# ---------------------------------------------------------------------------

def test_outcome_record_stores_confidence_for_calibration_analysis():
    fn = MO_SRC[MO_SRC.index("async def _finalize_outlook"):]
    fn_body = fn[:fn.index("\n\n\n")]
    assert '"confidence_pct": doc.get("confidence_pct")' in fn_body


# ---------------------------------------------------------------------------
# 20: dashboard and full-page use the same data source (API-level check)
# ---------------------------------------------------------------------------

def test_history_endpoint_and_current_endpoint_query_the_same_collection():
    assert ROUTES_SRC.count("db.cloud_market_outlooks") >= 3


# ---------------------------------------------------------------------------
# Notification idempotency + duplicate prevention
# ---------------------------------------------------------------------------

def test_idempotency_key_includes_event_outlook_and_user():
    key = notif._idempotency_key("OUTLOOK-XAUUSD-20260716-0700-BUY-abc123", "TP1_HIT", "user-42")
    assert "TP1_HIT" in key
    assert "OUTLOOK-XAUUSD-20260716-0700-BUY-abc123" in key
    assert "user-42" in key


def test_send_outlook_notification_checks_idempotency_before_sending():
    fn = NOTIF_SRC[NOTIF_SRC.index("async def send_outlook_notification"):]
    fn_body = fn[:fn.index("\n\nasync def _send_webpush")]
    idem_check_idx = fn_body.index("cloud_notification_log.find_one")
    payload_build_idx = fn_body.index("_build_payload(doc, event)")
    assert idem_check_idx < payload_build_idx  # checked BEFORE building/sending anything


def test_notification_tier_ranking_is_monotonic():
    assert notif._TIER_RANK["OFF"] < notif._TIER_RANK["HOURLY_ONLY"] < \
           notif._TIER_RANK["HOURLY_PLUS_RESULTS"] < notif._TIER_RANK["ALL_UPDATES"]


def test_hourly_signal_requires_only_hourly_only_tier_or_above():
    assert notif._EVENT_MIN_TIER["OUTLOOK_PUBLISHED"] == "HOURLY_ONLY"


def test_tp_and_sl_results_require_at_least_results_tier():
    for event in ("TP1_HIT", "TP2_HIT", "TP3_HIT", "SL_HIT"):
        assert notif._TIER_RANK[notif._EVENT_MIN_TIER[event]] >= notif._TIER_RANK["HOURLY_PLUS_RESULTS"]


def test_off_tier_never_satisfies_any_event_requirement():
    for event, min_tier in notif._EVENT_MIN_TIER.items():
        assert notif._TIER_RANK["OFF"] < notif._TIER_RANK[min_tier]


def test_expired_or_failed_device_is_removed_on_send_failure():
    fn = NOTIF_SRC[NOTIF_SRC.index("async def send_outlook_notification"):]
    fn_body = fn[:fn.index("\n\nasync def _send_webpush")]
    assert "cloud_push_subscriptions.delete_one" in fn_body


def test_vapid_keys_read_from_env_not_hardcoded():
    assert 'os.environ.get("VAPID_PUBLIC_KEY"' in NOTIF_SRC
    assert 'os.environ.get("VAPID_PRIVATE_KEY"' in NOTIF_SRC
    # confirm no literal key material is hardcoded as a fallback default
    import re
    assert not re.search(r'VAPID_(PUBLIC|PRIVATE)_KEY["\']?\s*,\s*["\'][A-Za-z0-9+/=_-]{20,}["\']', NOTIF_SRC)


# ---------------------------------------------------------------------------
# API endpoints scoped to authenticated user (static check)
# ---------------------------------------------------------------------------

def test_all_new_endpoints_require_cloud_user_auth():
    import re
    handlers = re.findall(r'async def \w+\([^)]*\):', ROUTES_SRC)
    for h in handlers:
        if "get_vapid_public_key" in h:
            continue  # public key is not secret, no auth needed to fetch it
        assert "Depends(srv.get_cloud_user)" in h, f"endpoint missing auth dependency: {h}"


def test_device_and_prefs_scoped_by_user_id_not_global():
    assert '"user_id": user["id"]' in ROUTES_SRC


# ---------------------------------------------------------------------------
# EA fields actually captured now (the real bug this feature depends on)
# ---------------------------------------------------------------------------

def test_bot_activity_req_has_thesis_fields():
    server_src = read(BACKEND_DIR / "server.py")
    fn = server_src[server_src.index("class BotActivityReq(BaseModel):"):]
    fn_body = fn[:fn.index("\n\n")]
    for field in ("market_thesis", "post_trade_state", "entry_readiness"):
        assert f"{field}: Optional[Dict[str, Any]] = None" in fn_body


def test_activity_endpoint_copies_thesis_fields_into_details():
    server_src = read(BACKEND_DIR / "server.py")
    fn = server_src[server_src.index('async def cloud_monitor_activity('):]
    fn_body = fn[:fn.index("doc = await _store_bot_activity")]
    assert '"market_thesis", "post_trade_state", "entry_readiness"' in fn_body


# ---------------------------------------------------------------------------
# requirements.txt has the new dependency, no credential leakage
# ---------------------------------------------------------------------------

def test_pywebpush_in_requirements():
    req = read(BACKEND_DIR / "requirements.txt")
    assert "pywebpush==" in req


# ---------------------------------------------------------------------------
# v6.24.17 price-integrity incident (entry zone ~$960 from live market):
# EA-authoritative price, price-sanity gate, directional-consistency gate,
# stale-fallback refusal, and the audit-preserving repair function.
# ---------------------------------------------------------------------------

SERVER_SRC = read(BACKEND_DIR / "server.py")


def test_gold_price_fallback_is_never_mislabeled_as_live():
    fn = SERVER_SRC[SERVER_SRC.index("async def fetch_live_gold_price"):]
    fn_body = fn[:fn.index("\n\ndef generate_unique_pin")]
    assert 'source = "fallback_stale_constant"' in fn_body
    # the hardcoded numeric fallback must not be returned tagged as "live"
    assert '"source":"live"' not in fn_body.replace(" ", "")


def _outlook_gen_body() -> str:
    fn = MO_SRC[MO_SRC.index("async def generate_outlook_for_account"):]
    return fn[:fn.index("\n\nasync def hourly_generation_tick")]


def test_outlook_prefers_ea_reported_price_over_external_feed():
    body = _outlook_gen_body()
    ea_price_idx = body.index("ea_mid = float(thesis_preview.get")
    fallback_idx = body.index("await srv.fetch_live_gold_price()")
    assert ea_price_idx < fallback_idx, "EA-reported price must be checked before the external fallback feed is ever called"


def test_outlook_refuses_stale_fallback_constant_as_a_usable_price():
    body = _outlook_gen_body()
    assert 'price_info.get("source") == "live"' in body
    assert "fallback_stale_constant" in MO_SRC or "fallback_stale_constant" in SERVER_SRC


def test_outlook_has_price_sanity_gate_bounded_by_atr_not_fixed_dollars():
    body = _outlook_gen_body()
    assert "price_sanity_failed" in body
    assert "max_allowed_distance" in body
    assert "atr_for_check * 5.0" in body or "atr_for_check *5.0" in body.replace(" ", "")
    assert "INTERNAL_DATA_INCONSISTENCY" in body
    assert "OUTLOOK_PRICE_SANITY_FAILED" in body


def test_outlook_has_directional_consistency_gate():
    body = _outlook_gen_body()
    assert "directional_conflict" in body
    assert "TRANSITION" in body
    # both directions must be checked, not just one
    assert 'direction_label == "SELL"' in body
    assert 'direction_label == "BUY"' in body


def test_repair_function_never_overwrites_original_price_or_zone_fields():
    fn = MO_SRC[MO_SRC.index("async def repair_price_integrity_incidents"):]
    fn_body = fn[:fn.index("\n\n# ---")]
    assert "$set" in fn_body
    for forbidden_field in ("current_price", "preferred_entry_zone_low", "preferred_entry_zone_high", "suggested_sl"):
        assert f'"{forbidden_field}":' not in fn_body, f"repair function must not rewrite original field {forbidden_field}"
    assert '"data_integrity_status": "INVALID_DATA"' in fn_body
    assert '"excluded_from_stats": True' in fn_body


def test_repair_function_is_not_wired_into_any_automatic_tick():
    assert "repair_price_integrity_incidents()" not in MO_SRC.replace(
        "async def repair_price_integrity_incidents(max_reasonable_price", "")


def test_history_stats_exclude_flagged_records_but_keep_them_visible():
    assert "excluded_from_stats" in ROUTES_SRC
    assert 'return {"outlooks": rows, "stats": stats}' in ROUTES_SRC
