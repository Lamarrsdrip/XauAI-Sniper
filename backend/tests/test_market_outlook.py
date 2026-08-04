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
from datetime import datetime, timezone
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
    own_collections = {"cloud_market_outlooks", "cloud_market_outlook_revisions", "cloud_market_outlook_outcomes",
                       "cloud_market_outlook_repair_runs"}
    for coll in writes:
        assert coll in own_collections, f"market_outlook.py writes to unexpected collection: {coll}"


def test_notifications_module_only_writes_its_own_collections():
    # v6.25.3 owner directive 2026-07-17 -- switched to OneSignal; the
    # retired self-hosted VAPID keypair (system_settings/_id=
    # web_push_vapid_primary) is gone. The notification module owns both
    # genuine OneSignal device registrations and delivery log entries; routes
    # validate/authenticate requests and delegate registration persistence.
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
    assert set(mo.PRIMARY_DIRECTIONS) == {"BUY", "SELL", "NEUTRAL", "RANGE", "TRANSITION", "NO_VALID_OUTLOOK", "BLOCKED"}


def test_all_required_lifecycle_states_defined():
    required = {"INFORMATIONAL", "TRACKING_AMBER", "WIN_GREEN_0_5R",
                "WIN_GREEN_TP1", "LOSS_RED_SL", "LOSS_RED_TIMEOUT"}
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

def test_actionable_signal_activates_at_publication_not_zone_touch():
    src = MO_SRC[MO_SRC.index("async def generate_outlook_for_account"):]
    assert '"tracking_entry_price": tracking_entry if actionable else None' in src
    assert '"activated": actionable' in src
    assert "entry_zone_reached" not in MO_SRC[MO_SRC.index("def advance_persisted_signal"):]


def test_publication_anchor_uses_buy_ask_and_sell_bid_never_zone_midpoint():
    src = _outlook_gen_body()
    assert "_build_tracking_anchor(direction_label, published_bid, published_ask, original_sl)" in src
    helper = MO_SRC[MO_SRC.index("def _build_tracking_anchor"):MO_SRC.index("async def _insert_outlook_atomically")]
    assert 'entry = ask if direction == "BUY" else bid' in helper
    anchor_section = src[src.index("# Signal-performance tracking is anchored"):src.index("narrative = await")]
    assert "entry_mid" not in anchor_section
    assert "preferred_entry_zone" not in anchor_section


def test_original_risk_uses_exact_anchor_and_original_published_sl():
    src = _outlook_gen_body()
    helper = MO_SRC[MO_SRC.index("def _build_tracking_anchor"):MO_SRC.index("async def _insert_outlook_atomically")]
    assert "risk = abs(entry - sl)" in helper
    assert 'geometry_valid = sl < entry if direction == "BUY" else sl > entry' in helper
    assert '"original_sl": original_sl if actionable else None' in src
    assert '"published_bid": published_bid if published_bid > 0 else None' in src
    assert '"published_ask": published_ask if published_ask > 0 else None' in src


def test_actionable_publication_rejects_stale_quote_and_initializes_spread_excursion():
    src = _outlook_gen_body()
    assert "MAX_PUBLICATION_QUOTE_AGE_SECONDS" in src
    assert "quote_fresh" in src
    assert "OUTLOOK_AWAITING_FRESH_PUBLICATION_QUOTE" in src
    assert src.index("OUTLOOK_AWAITING_FRESH_PUBLICATION_QUOTE") < src.index("quote_valid =")
    assert '"current_r": tracking_anchor["current_r"] if actionable else None' in src
    assert '"mae_r": tracking_anchor["mae_r"] if actionable else None' in src


def test_fresh_ea_quote_reenters_the_canonical_slot_idempotent_publisher():
    server_src = SERVER_SRC
    activity = server_src[server_src.index("async def cloud_monitor_activity"):]
    activity = activity[:activity.index("# v6.25.1 owner directive", 1)]
    assert 'await _mo.hourly_generation_tick(account=req.account or "")' in activity
    assert "MAX_PUBLICATION_QUOTE_AGE_SECONDS = 30" in MO_SRC


def test_background_monitor_and_pending_dispatch_are_not_capped_at_500_records():
    monitor = MO_SRC[MO_SRC.index("async def track_outlook_lifecycle_tick"):MO_SRC.index("async def _record_revision")]
    pending = MO_SRC[MO_SRC.index("async def dispatch_pending_signal_notifications"):MO_SRC.index("def _quote_from_activity")]
    assert ".to_list(500)" not in monitor
    assert ".to_list(500)" not in pending
    assert "pending_event_conditions" in pending
    assert 'notification_flags.TIMEOUT_60M' in pending


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
    # v6.25.2 owner directive 2026-07-17 -- generation's own insert_one calls
    # moved into the shared _insert_outlook_atomically() helper (the
    # duplicate-hourly-publication fix: a deterministic per-slot _id so a
    # racing second insert raises DuplicateKeyError instead of creating a
    # second record). The immutability guarantee this test protects --
    # generation never UPDATES a prior outlook document -- still holds; it
    # now goes through that one shared insert path instead of three direct
    # insert_one calls.
    fn = MO_SRC[MO_SRC.index("async def generate_outlook_for_account"):]
    fn_body = fn[:fn.index("\n\nasync def publish_m10_signal_from_activity")]
    assert "_insert_outlook_atomically" in fn_body
    assert "update_one" not in fn_body  # generation never mutates a prior outlook
    helper_fn = MO_SRC[MO_SRC.index("async def _insert_outlook_atomically"):]
    helper_fn_body = helper_fn[:helper_fn.index("\n\nasync def generate_outlook_for_account")]
    assert "insert_one" in helper_fn_body
    assert "update_one" not in helper_fn_body


# ---------------------------------------------------------------------------
# 13-16: SL/TP event ordering
# ---------------------------------------------------------------------------

def test_any_tp_touch_precedes_timeout_and_sl_never_independently_classifies():
    """Owner-approved rule (2026-08-04): a genuine TP1/TP2/TP3 touch at any
    point in the evaluation window always wins, regardless of order versus
    SL. SL touching alone must never appear as a classification trigger in
    the primary if/elif chain -- it only finalizes LOSS in the defensive
    no-deadline fallback, which is a separate branch checked after the
    timeout path."""
    fn = MO_SRC[MO_SRC.index("def advance_persisted_signal"):]
    classify = fn[fn.index("    if outcome is None:"):]
    primary_chain = classify[:classify.index("elif outcome == ANALYTICS_WIN:")]
    assert primary_chain.index("if tp3_on_time:") < primary_chain.index("elif tp2_on_time:")
    assert primary_chain.index("elif tp2_on_time:") < primary_chain.index("elif tp1_on_time:")
    assert primary_chain.index("elif tp1_on_time:") < primary_chain.index("elif deadline and observed_at >= deadline:")
    assert primary_chain.index("elif deadline and observed_at >= deadline:") < primary_chain.index("elif not deadline and sl_hit:")
    # The generic +0.50R threshold must never independently classify a win --
    # only a genuine TP price-level touch may.
    assert "elif half_on_time:" not in primary_chain


def test_actionable_state_machine_has_persisted_win_states():
    assert mo.SIGNAL_WIN_HALF_R == "WIN_GREEN_0_5R"
    assert mo.SIGNAL_WIN_TP1 == "WIN_GREEN_TP1"


def test_actionable_state_machine_has_persisted_loss_states():
    assert mo.SIGNAL_LOSS_SL == "LOSS_RED_SL"
    assert mo.SIGNAL_LOSS_TIMEOUT == "LOSS_RED_TIMEOUT"


def test_actionable_lifecycle_never_emits_no_entry():
    fn = MO_SRC[MO_SRC.index("def advance_persisted_signal"):MO_SRC.index("async def _account_quotes_since")]
    assert "NO_ENTRY" not in fn


def test_historical_unavailable_is_explicit_and_excluded():
    assert mo.ANALYTICS_UNAVAILABLE == "HISTORICAL_DATA_UNAVAILABLE"


def test_exact_60_minute_timeout_is_a_loss_for_actionable_signal():
    fn = MO_SRC[MO_SRC.index("def advance_persisted_signal"):]
    assert "observed_at >= deadline" in fn
    assert "SIGNAL_LOSS_TIMEOUT" in fn


# ---------------------------------------------------------------------------
# 17: MFE/MAE recorded
# ---------------------------------------------------------------------------

def test_persisted_signal_state_tracks_mfe_and_mae():
    assert "mfe_r = max(mfe_r, current_r)" in MO_SRC
    assert "mae_r = min(mae_r, current_r, 0.0)" in MO_SRC


# ---------------------------------------------------------------------------
# 19: confidence calibration reportable via outcomes collection
# ---------------------------------------------------------------------------

def test_outcome_record_stores_confidence_for_calibration_analysis():
    fn = MO_SRC[MO_SRC.index("async def _persist_signal_outcome"):]
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
    fn_body = fn[:fn.index("\n\nasync def send_test_notification")]
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


def test_send_outlook_notification_never_deletes_subscriptions_itself():
    # v6.25.3 owner directive 2026-07-17 -- OneSignal owns device/subscription
    # lifecycle entirely; this module must never delete a
    # cloud_push_subscriptions record on a delivery failure (unlike the
    # retired self-hosted Web Push code, which deleted on a confirmed
    # 404/410 -- OneSignal's failure modes are all config/auth/transient,
    # never "the browser confirmed this endpoint is gone").
    fn = NOTIF_SRC[NOTIF_SRC.index("async def send_outlook_notification"):]
    fn_body = fn[:fn.index("\n\nasync def send_test_notification")]
    assert "cloud_push_subscriptions.delete_one" not in fn_body
    assert "cloud_push_subscriptions.update_one" not in fn_body


def test_onesignal_credentials_read_from_settings_not_hardcoded():
    assert "onesignal_app_id" in NOTIF_SRC
    assert "onesignal_api_key" in NOTIF_SRC
    # confirm no literal key material is hardcoded as a fallback default
    import re
    assert not re.search(r'onesignal_api_key["\']?\s*[,:]\s*["\'][A-Za-z0-9+/=_-]{20,}["\']', NOTIF_SRC)


# ---------------------------------------------------------------------------
# API endpoints scoped to authenticated user (static check)
# ---------------------------------------------------------------------------

def test_all_new_endpoints_require_cloud_user_auth():
    import re
    handlers = re.findall(r'async def \w+\([^)]*\):', ROUTES_SRC)
    for h in handlers:
        if "get_onesignal_app_id" in h:
            continue  # OneSignal App ID is not secret, no auth needed to fetch it
        if "get_public_outlook_performance" in h:
            continue  # deliberately public -- this is what the marketing site shows signed-out visitors
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

def test_no_pywebpush_dependency():
    # v6.25.3 owner directive 2026-07-17 -- pywebpush is retired along with
    # self-hosted Web Push; OneSignal delivery only needs httpx, already a
    # dependency for other reasons. Its absence here is deliberate, not an
    # oversight -- this locks in that nothing reintroduces it.
    req = read(BACKEND_DIR / "requirements.txt")
    assert "pywebpush" not in req


# ---------------------------------------------------------------------------
# v6.24.17 price-integrity incident (entry zone ~$960 from live market):
# EA-authoritative price, price-sanity gate, directional-consistency gate,
# stale-fallback refusal, and the audit-preserving repair function.
# ---------------------------------------------------------------------------

SERVER_SRC = read(BACKEND_DIR / "server.py")


def test_gold_price_fallback_is_never_mislabeled_as_live():
    # v6.25.6 update: Codex's XAU-018 forensic repair replaced the old
    # hardcoded numeric fallback with an honest unavailable/null response --
    # a failed quote provider is unavailable, never a licence to invent a
    # price. This test now asserts THAT behavior exists, not the retired
    # fallback-constant string it originally pinned.
    fn = SERVER_SRC[SERVER_SRC.index("async def fetch_live_gold_price"):]
    fn_body = fn[:fn.index("\n\ndef generate_unique_pin")]
    assert '"available": False' in fn_body
    assert '"source": "unavailable"' in fn_body
    # the failed-provider branch must never fabricate a price/spread
    assert '"bid": None, "ask": None,' in fn_body
    # and a successful live fetch must never be mislabeled as anything else
    assert '"source":"live"' not in fn_body.replace(" ", "") or 'source = "live"' in fn_body


def _outlook_gen_body() -> str:
    fn = MO_SRC[MO_SRC.index("async def generate_outlook_for_account"):]
    return fn[:fn.index("\n\nasync def publish_m10_signal_from_activity")]


def test_outlook_prefers_ea_reported_price_over_external_feed():
    body = _outlook_gen_body()
    ea_price_idx = body.index("evidence_quote = extract_evidence_quote")
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


def _resolve_hourly_bias_body() -> str:
    fn = MO_SRC[MO_SRC.index("def _resolve_hourly_bias"):]
    return fn[:fn.index("\n\nasync def generate_outlook_for_account")]


def test_outlook_has_directional_consistency_gate():
    # v6.25.x refactor: the directional-consistency gate moved into the pure,
    # independently-testable _resolve_hourly_bias() helper (called from
    # generate_outlook_for_account, still asserted below), so this must look
    # for it there. generate_outlook_for_account's own body still consumes
    # its output via `directional_conflict = bias["directional_conflict"]`.
    body = _resolve_hourly_bias_body()
    assert "directional_conflict" in body
    assert "TRANSITION" in body
    # both directions must be checked, not just one
    assert 'direction_label == "SELL"' in body
    assert 'direction_label == "BUY"' in body
    assert "directional_conflict" in _outlook_gen_body()
    assert "_resolve_hourly_bias(canonical_m10, thesis)" in _outlook_gen_body()


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
    assert '"outlooks": rows' in ROUTES_SRC
    assert '"timeline": group_meaningful_history(rows)' in ROUTES_SRC


def test_history_analytics_are_not_limited_to_visible_card_page():
    body = ROUTES_SRC[ROUTES_SRC.index('    @r.get("/outlook/history")'):]
    body = body[:body.index('    @r.get("/outlook/{outlook_id}")')]
    assert ".to_list(limit)" in body
    assert "stats_rows = await" in body
    assert ".to_list(None)" in body
    assert "compute_outlook_stats(stats_rows)" in body


def test_signal_outlook_hot_path_indexes_are_declared_at_startup():
    for index_fragment in (
        'cloud_market_outlooks.create_index([("account", 1), ("generated_at", -1)])',
        'cloud_market_outlook_outcomes.create_index("outlook_id", unique=True)',
        'cloud_bot_activity.create_index([("account", 1), ("ts", 1)])',
    ):
        assert index_fragment in SERVER_SRC


def _m10_evidence(*, ready=None, decision="SELL_CANDIDATE", ask=4052.6, freshness="FRESH"):
    return {
        "ts": "2026-07-22T09:00:00+00:00",
        "event_time": "2026-07-22T09:00:00+00:00",
        "symbol": "XAUUSD",
        "m10_signal": {
            "decision": decision, "preferred_direction": "SELL", "confidence": 72,
            "freshness_state": freshness, "bar_time": "2026-07-22T08:50:00+00:00",
            "live_bid": 4052.4, "live_ask": ask,
        },
        "execution": {"final_execution_allowed": ready, "final_decision": "READY" if ready else "WAITING"},
    }


def test_contract_fresh_ready_m10_survives_missing_hourly_context():
    contract = mo.build_authoritative_outlook_contract(
        _m10_evidence(ready=True), "OK", hourly_doc=None,
        now=datetime(2026, 7, 22, 9, 0, 5, tzinfo=timezone.utc),
    )
    assert contract["state"] == mo.OUTLOOK_ACTIONABLE
    assert contract["direction"] == "SELL"
    assert contract["hourlyContext"]["state"] == "UNAVAILABLE"
    assert contract["notificationEligibility"]["eligible"] is True


def test_contract_candidate_not_ready_is_watching_and_not_notifiable():
    contract = mo.build_authoritative_outlook_contract(
        _m10_evidence(ready=False), "OK", now=datetime(2026, 7, 22, 9, 0, 5, tzinfo=timezone.utc),
    )
    assert contract["state"] == mo.OUTLOOK_WATCHING
    assert contract["executionReady"] is False
    assert contract["notificationEligibility"] == {
        "eligible": False, "reason": "CANDIDATE_NOT_EXECUTION_READY",
    }


def test_contract_healthy_no_candidate_is_not_data_unavailable():
    evidence = _m10_evidence(ready=False, decision="NO_VALID_SIGNAL")
    evidence["m10_signal"]["preferred_direction"] = ""
    contract = mo.build_authoritative_outlook_contract(
        evidence, "OK", now=datetime(2026, 7, 22, 9, 0, 5, tzinfo=timezone.utc),
    )
    assert contract["state"] == mo.OUTLOOK_NO_SIGNAL
    assert contract["confidence"] is None


def test_contract_missing_ask_is_data_unavailable_not_zero_confidence_neutral():
    contract = mo.build_authoritative_outlook_contract(
        _m10_evidence(ready=True, ask=None), "OK",
        now=datetime(2026, 7, 22, 9, 0, 5, tzinfo=timezone.utc),
    )
    assert contract["state"] == mo.OUTLOOK_DATA_UNAVAILABLE
    assert "BROKER_ASK" in contract["missingFields"]
    assert contract["confidence"] != 0


def test_m10_quote_mapper_accepts_quote_outside_market_thesis():
    quote = mo.extract_evidence_quote(_m10_evidence(ready=True))
    assert quote["valid"] is True
    assert quote["bid"] == 4052.4
    assert quote["ask"] == 4052.6


# ---------------------------------------------------------------------------
# Owner directive: the Hourly Manual Outlook must publish BUY or SELL for
# every healthy evaluation window, independent of whether the strict M10
# automated engine approved an executable entry. NEUTRAL/0%-confidence must
# never appear merely because automated execution wasn't approved.
# ---------------------------------------------------------------------------

def _no_candidate_m10(actionable=False):
    return {"direction": "", "actionable": actionable, "confidence": None,
            "blocker_code": None, "execution_status": "NO_CANDIDATE"}


def _candidate_m10(direction, actionable, blocker_code=None, confidence=72):
    return {"direction": direction, "actionable": actionable, "confidence": confidence,
            "blocker_code": blocker_code, "execution_status": "READY" if actionable else "BLOCKED"}


def test_hourly_bias_never_returns_neutral_with_healthy_pressure_evidence():
    for buy_p, sell_p in [(51, 49), (49, 51), (32, 68), (68, 32), (50, 50), (85, 15), (15, 85)]:
        bias = mo._resolve_hourly_bias(_no_candidate_m10(), {"buy_pressure": buy_p, "sell_pressure": sell_p})
        assert bias["direction_label"] in ("BUY", "SELL"), f"got {bias['direction_label']} for {buy_p}/{sell_p}"
        assert bias["direction_label"] != "NEUTRAL"


def test_hourly_bias_no_automated_candidate_still_produces_direction():
    # This is the exact regression this fix targets: automated EA found no
    # executable M10 candidate this hour, but real buy/sell pressure
    # evidence exists -- must not collapse to NEUTRAL/0%.
    bias = mo._resolve_hourly_bias(_no_candidate_m10(actionable=False), {"buy_pressure": 68, "sell_pressure": 32})
    assert bias["direction_label"] == "BUY"  # buy pressure dominant
    assert bias["automated_entry_approved"] is False
    assert bias["confidence"] > 0


def test_hourly_bias_stronger_buy_evidence_cannot_display_sell():
    bias = mo._resolve_hourly_bias(_no_candidate_m10(), {"buy_pressure": 68, "sell_pressure": 32})
    assert bias["direction_label"] == "BUY"


def test_hourly_bias_stronger_sell_evidence_cannot_display_buy():
    bias = mo._resolve_hourly_bias(_no_candidate_m10(), {"buy_pressure": 32, "sell_pressure": 68})
    assert bias["direction_label"] == "SELL"


def test_hourly_bias_small_evidence_gap_is_very_low_confidence():
    bias = mo._resolve_hourly_bias(_no_candidate_m10(), {"buy_pressure": 51, "sell_pressure": 49})
    assert bias["direction_label"] == "BUY"
    assert bias["confidence"] <= 25
    assert bias["confidence_category"] == "VERY_LOW"


def test_hourly_bias_exact_tie_is_deterministic_not_neutral():
    bias = mo._resolve_hourly_bias(_no_candidate_m10(), {"buy_pressure": 50, "sell_pressure": 50})
    assert bias["direction_label"] == "BUY"
    assert bias["confidence_category"] == "VERY_LOW"


def test_hourly_bias_larger_gap_yields_higher_confidence_than_small_gap():
    small_gap = mo._resolve_hourly_bias(_no_candidate_m10(), {"buy_pressure": 51, "sell_pressure": 49})
    large_gap = mo._resolve_hourly_bias(_no_candidate_m10(), {"buy_pressure": 20, "sell_pressure": 80})
    assert large_gap["confidence"] > small_gap["confidence"]


def test_hourly_bias_prefers_explicit_ea_candidate_over_pressure_when_not_conflicting():
    # Automated EA has an explicit BUY candidate but it's not execution-ready
    # (e.g. blocked by a LATE location gate) -- pressure is mildly against
    # but under the 15-point conflict threshold. The candidate direction
    # must still win, with automated status reported separately.
    m10 = _candidate_m10("BUY", actionable=False, blocker_code="OWNER_LOCATION_LATE_BLOCK")
    bias = mo._resolve_hourly_bias(m10, {"buy_pressure": 45, "sell_pressure": 55})
    assert bias["direction_label"] == "BUY"
    assert bias["automated_entry_approved"] is False
    assert bias["automated_block_reason"] == "OWNER_LOCATION_LATE_BLOCK"
    assert bias["directional_transformation_applied"] is False


def test_hourly_bias_flips_to_pressure_side_on_real_conflict_never_neutral():
    # EA candidate says SELL, but pressure overwhelmingly favors BUY (gap
    # well past the 15-point conflict threshold, no structural override).
    # Must flip to the pressure-dominant side, not collapse to NEUTRAL/0%.
    m10 = _candidate_m10("SELL", actionable=True, confidence=80)
    bias = mo._resolve_hourly_bias(m10, {"buy_pressure": 75, "sell_pressure": 25, "structure": ""})
    assert bias["direction_label"] == "BUY"
    assert bias["direction_label"] != "NEUTRAL"
    assert bias["directional_transformation_applied"] is True
    assert bias["directional_conflict"] is not None
    assert bias["confidence"] <= 65  # conflict caps confidence, never zeroes it
    assert bias["confidence"] > 0


def test_hourly_bias_structural_override_prevents_conflict_flip():
    m10 = _candidate_m10("SELL", actionable=True, confidence=80)
    bias = mo._resolve_hourly_bias(m10, {"buy_pressure": 75, "sell_pressure": 25, "structure": "STRUCTURE_STRONGLY_SUPPORTS"})
    assert bias["direction_label"] == "SELL"
    assert bias["directional_transformation_applied"] is False


def test_hourly_bias_automated_approval_surfaced_independently_of_direction():
    m10 = _candidate_m10("SELL", actionable=True, confidence=80)
    bias = mo._resolve_hourly_bias(m10, {"buy_pressure": 30, "sell_pressure": 70})
    assert bias["direction_label"] == "SELL"
    assert bias["automated_entry_approved"] is True
    assert bias["automated_block_reason"] is None


def test_hourly_outlook_docs_carry_manual_advisory_identity_fields():
    # Every hourly outlook document (success and all NO_VALID_OUTLOOK
    # branches) must self-identify as a zero-execution-authority manual
    # advisory, distinct from the M10 automated execution signal.
    assert MO_SRC.count('"outlook_type": "HOURLY_MANUAL_BIAS"') >= 3
    assert MO_SRC.count('"execution_authority": False') >= 4
    assert '"automated_entry_approved": automated_entry_approved' in MO_SRC
    assert '"automated_block_reason": automated_block_reason' in MO_SRC


def test_confidence_category_thresholds_are_monotonic_and_cover_0_to_100():
    labels = [mo._confidence_category(p) for p in (0, 10, 34, 35, 54, 55, 74, 75, 100)]
    assert labels == ["VERY_LOW", "VERY_LOW", "VERY_LOW", "LOW", "LOW", "MODERATE", "MODERATE", "HIGH", "HIGH"]


# ---------------------------------------------------------------------------
# Notification-volume root cause: _dispatch_hourly_notification only ever
# sends when primary_direction is BUY/SELL. Before the _resolve_hourly_bias
# fix above, generate_outlook_for_account collapsed to NEUTRAL every time
# the automated M10 engine had no actionable candidate (the common case),
# which silently suppressed the hourly notification too -- not a push/
# OneSignal delivery failure, a direction-calculation bug upstream of it.
# This test locks in that the notification gate itself is unchanged (still
# correctly advisory-only for genuinely non-directional data) while the
# bias resolver above now reliably supplies BUY/SELL for healthy evidence,
# so the gate is actually reached far more often than before.
# ---------------------------------------------------------------------------

def test_hourly_notification_gate_fires_on_any_healthy_directional_bias():
    start = MO_SRC.index("async def _dispatch_hourly_notification")
    fn_body = MO_SRC[start:start + 600]
    assert 'doc.get("primary_direction") in ("BUY", "SELL")' in fn_body
    assert "ADVISORY_ONLY" in fn_body


def test_resolved_bias_for_healthy_no_candidate_evidence_satisfies_notification_gate():
    # Direct proof of the fix: a healthy hour with no automated candidate but
    # real pressure evidence now produces a primary_direction the
    # notification gate actually accepts, closing the suppression gap.
    bias = mo._resolve_hourly_bias(_no_candidate_m10(actionable=False), {"buy_pressure": 62, "sell_pressure": 38})
    assert bias["direction_label"] in ("BUY", "SELL")


# ---------------------------------------------------------------------------
# Owner-approved permanent M10 category policy -- the single shared engine
# every Outlook consumer must use. Reason codes match the EA's own
# XAU_IsPermanentM10CategoryBlocked / XAU_OwnerEntryPermission hard blocks
# exactly (see ea_code/XAUUSD_AI_Sniper_EA.mq5).
# ---------------------------------------------------------------------------

def _m10(blocker_code=None, session="LONDON", grade="A"):
    return {"blocker_code": blocker_code, "session": session, "grade": grade}


def test_asia_grade_a_never_publishes():
    result = mo.evaluate_owner_policy(_m10("PERM_BLOCK_ASIA_NON_A_PLUS", session="ASIA", grade="A"))
    assert result["allowed"] is False
    assert result["blocker_code"] == "PERM_BLOCK_ASIA_NON_A_PLUS"


def test_asia_grade_b_never_publishes():
    result = mo.evaluate_owner_policy(_m10("PERM_BLOCK_ASIA_GRADE_B", session="ASIA", grade="B"))
    assert result["allowed"] is False


def test_clean_asia_a_plus_may_publish():
    result = mo.evaluate_owner_policy(_m10(None, session="ASIA", grade="A+"))
    assert result["allowed"] is True
    assert result["blocker_code"] is None


def test_a_plus_reset_pending_never_publishes():
    result = mo.evaluate_owner_policy(_m10("PERM_BLOCK_A_PLUS_RESET_PENDING", session="ASIA", grade="A+"))
    assert result["allowed"] is False


def test_non_asia_normal_grade_b_may_publish():
    result = mo.evaluate_owner_policy(_m10(None, session="LONDON", grade="B"))
    assert result["allowed"] is True


def test_grade_b_reversal_never_publishes():
    result = mo.evaluate_owner_policy(_m10("PERM_BLOCK_GRADE_B_REVERSAL", session="LONDON", grade="B"))
    assert result["allowed"] is False


def test_grade_b_reset_pending_never_publishes():
    result = mo.evaluate_owner_policy(_m10("PERM_BLOCK_RESET_PENDING_GRADE_B", session="LONDON", grade="B"))
    assert result["allowed"] is False


def test_owner_location_excellent_never_publishes():
    result = mo.evaluate_owner_policy(_m10("OWNER_LOCATION_EXCELLENT_BLOCK"))
    assert result["allowed"] is False
    assert "Excellent" in result["blocker_explanation"]


def test_owner_location_late_never_publishes():
    result = mo.evaluate_owner_policy(_m10("OWNER_LOCATION_LATE_BLOCK"))
    assert result["allowed"] is False
    assert "Late" in result["blocker_explanation"]


def test_missing_blocker_code_is_treated_as_not_blocked():
    """No blocker_code reported and "genuinely blocked" are different
    states -- consistent with how automated_block_reason/blocker_code are
    read everywhere else in this module (absence means "nothing reported",
    never "assume blocked"). True fail-closed behavior for missing/stale/
    incomplete EA evidence is the job of generate_outlook_for_account's own
    NO_VALID_OUTLOOK path, not this function."""
    result = mo.evaluate_owner_policy(_m10(None))
    assert result["allowed"] is True


def test_unrecognized_blocker_code_does_not_block():
    """A routine, non-owner-policy block (e.g. still waiting for
    confirmation timer) must not suppress the advisory direction -- only
    the specific owner-policy hard-block codes do."""
    result = mo.evaluate_owner_policy(_m10("CANDIDATE_NOT_EXECUTION_READY"))
    assert result["allowed"] is True


def test_result_includes_policy_version_and_evaluated_timestamp():
    result = mo.evaluate_owner_policy(_m10("PERM_BLOCK_ASIA_NON_A_PLUS", session="ASIA", grade="A"))
    assert result["policy_version"] == mo.OWNER_POLICY_VERSION
    assert result["evaluated_at"] is not None
    assert result["session"] == "ASIA"
    assert result["grade"] == "A"


def test_generation_downgrades_blocked_directional_bias_to_blocked_state():
    """Integration point: generate_outlook_for_account must downgrade
    primary_direction to BLOCKED (never publish BUY/SELL) when the owner
    policy blocks the candidate, while preserving what the evidence would
    otherwise have shown for the technical/audit view."""
    fn_src = MO_SRC[MO_SRC.index("async def generate_outlook_for_account"):MO_SRC.index("async def generate_outlook_for_account") + 8000]
    assert "evaluate_owner_policy(canonical_m10)" in fn_src
    assert 'direction_label = "BLOCKED"' in fn_src
    assert "owner_policy_blocked_direction" in fn_src


def test_blocked_signals_excluded_from_public_performance_query():
    routes_src = read(BACKEND_DIR / "market_outlook_routes.py")
    fn = routes_src[routes_src.index("async def build_public_outlook_performance"):]
    fn = fn[:fn.index("\n\n\n")]
    assert '"primary_direction": {"$in": ["BUY", "SELL"]}' in fn


def test_blocked_signals_never_dispatch_a_trade_notification():
    fn = MO_SRC[MO_SRC.index("async def _dispatch_hourly_notification"):]
    fn = fn[:fn.index("\n\n\n")]
    assert 'doc.get("primary_direction") in ("BUY", "SELL")' in fn


def test_blocked_primary_direction_is_a_known_state():
    assert "BLOCKED" in mo.PRIMARY_DIRECTIONS
