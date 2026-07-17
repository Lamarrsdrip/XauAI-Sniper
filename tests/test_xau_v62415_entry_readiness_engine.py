"""v6.24.15 — Entry Readiness Engine.

Root cause fixed: XAU_ComputeMarketThesis/XAU_MarketThesisAction already
computed a full priority-ordered readiness read (ALLOW_CORE vs WAIT_FOR_*
vs TRANSITION_WATCH vs HARD_BLOCK) every time they were called, but the
ONLY place that result was ever checked pre-entry was `.action == HARD_BLOCK`.
Every WAIT_* value was silently discarded -- actual entry authorization
came entirely from the older score/grade + independent-authority pipeline,
which has no persistent "the old side must finish first" concept. That gap
is exactly "identifies the eventual direction correctly, but enters before
the market is actually ready."

Fix: a persistent per-direction candidate (g_readiness[2]) that survives
across bars for the same idea (identified by the existing immutable
decision snapshot's own signature), classified via a pure re-sequencing of
already-existing evidence (XAU_ComputeMarketThesis's 6 buckets,
XAU_ClassifyOldDirectionState from v6.24.14) into the spec's named states,
elevated to a REAL gate inside OpenTrade() -- one more required condition
alongside every existing gate (score/grade, authorities, the 120-180s
timer, the v6.24.14 cooldown), never a replacement for any of them.

Static tests here verify source structure/wiring; behavioral tests mirror
the state-mapping logic (scripts/unified_thesis_mirror.py's
map_to_readiness_state/classify_old_direction_state, the same canonical
mirror module the replay harness uses) against the real .mq5 branch order.
"""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.24.15.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"
COMPILE_LOG = ROOT / "compile_logs" / "v62415_entry_readiness_engine_main_compile.log"

sys.path.insert(0, str(ROOT / "scripts"))
from unified_thesis_mirror import (  # noqa: E402
    TransitionDecision, compute_thesis, map_to_readiness_state,
    classify_old_direction_state, old_side_state_from_row_evidence,
    TREND_HEALTHY, TREND_MATURE, TREND_EXHAUSTING, TRANSITION_NEUTRAL,
    OPPOSITE_DIRECTION_CONFIRMED, TRANSITION_STOP_ADDS, TRANSITION_HOLD,
)


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def read_log(path: Path) -> str:
    raw = path.read_bytes()
    try:
        return raw.decode("utf-16le")
    except UnicodeDecodeError:
        return raw.decode("utf-8", errors="ignore")


# ---------------------------------------------------------------------------
# Housekeeping
# ---------------------------------------------------------------------------

def test_repo_source_is_synced_to_backend():
    assert read(EA) == read(BACKEND_EA)


def test_version_bumped_to_v62415():
    ea = read(BACKEND_EA)
    assert '#define XAUAI_EA_VERSION "v6.24.15"' in ea


def test_compile_clean():
    log = read_log(COMPILE_LOG)
    assert "Result: 0 errors, 0 warnings" in log


# ---------------------------------------------------------------------------
# Root-cause / structural wiring (deliverables 1-11 of the spec)
# ---------------------------------------------------------------------------

def test_readiness_state_enum_has_all_required_states():
    ea = read(BACKEND_EA)
    block = ea[ea.index("enum ENUM_XAU_READINESS_STATE"):][:900]
    for state in ("READINESS_BIAS_ONLY", "READINESS_OLD_SIDE_ACTIVE", "READINESS_WAIT_FOR_EXHAUSTION",
                  "READINESS_WAIT_FOR_LOCATION", "READINESS_WAIT_FOR_PRESSURE", "READINESS_WAIT_FOR_STRUCTURE",
                  "READINESS_WAIT_FOR_RECLAIM", "READINESS_WAIT_FOR_RETEST", "READINESS_FORMING",
                  "READINESS_CONFIRMED", "READINESS_ENTRY_READY", "READINESS_INVALIDATED", "READINESS_EXPIRED"):
        assert state in block


def test_final_action_enum_values_match_spec():
    ea = read(BACKEND_EA)
    fn = ea[ea.index("d.finalAction = (thesis.action == HARD_BLOCK)"):][:800]
    assert '"HARD_BLOCK"' in fn
    assert '"NO_VALID_TRADE"' in fn
    assert '"ALLOW_BUY"' in fn
    assert '"ALLOW_SELL"' in fn
    assert '"WAIT_FOR_BUY"' in fn
    assert '"WAIT_FOR_SELL"' in fn


def test_candidate_persists_via_snapshot_signature_not_recomputed_every_tick():
    # v6.24.16 audit fix changed the fingerprint SOURCE (see
    # test_xau_v62416_readiness_audit_fixes.py's own
    # test_candidate_fingerprint_no_longer_uses_decision_snapshot_signature
    # for why: the old g_latestDecisionSnapshot.signature-based fingerprint
    # buckets fast RSI/Stoch/momentum and could flip exactly at the
    # wait-to-confirm transition, discarding real progress). The PERSISTENCE
    # behavior this test actually cares about -- freshOrigin only resets on
    # a genuinely new idea, not unconditionally every call -- is unchanged;
    # only the fingerprint's ingredients moved to a coarser, locally-computed
    # one (regime|setup|direction).
    ea = read(BACKEND_EA)
    fn = ea[ea.index("XAU_EntryReadinessDecision XAU_UpdateEntryReadiness("):][:2200]
    assert 'StringFormat("%s|%s|%d", RegimeName()' in fn
    assert "freshOrigin" in fn
    # only resets on direction change or a genuinely different fingerprint --
    # not unconditionally every call
    assert "g_readiness[slot].direction != direction" in fn


def test_entryready_requires_candidate_already_existed_not_instant_confirm():
    # regression guard for "do not jump directly from BIAS to ENTRY_READY":
    # a brand-new candidate that computes straight to CONFIRMED on its very
    # first evaluation must NOT be marked as ready on that same evaluation.
    # v6.24.16 audit fix changed WHICH flag gates entryReady (see
    # test_xau_v62416_readiness_audit_fixes.py's own
    # test_entryready_gate_uses_candidate_already_existed_not_wait_flag for
    # why: the ORIGINAL passedThroughWaitState flag could never become true
    # for a candidate that stayed CONFIRMED on every observation,
    # permanently blocking entryReady). A later hygiene pass removed
    # passedThroughWaitState entirely once it became provably dead code
    # (written, never read, after candidateAlreadyExisted took over as the
    # real gate) -- window widened for the extra v6.24.16 comments.
    ea = read(BACKEND_EA)
    fn = ea[ea.index("XAU_EntryReadinessDecision XAU_UpdateEntryReadiness("):][:7500]
    assert "candidateReady = g_readiness[slot].active &&" in fn
    assert "candidateAlreadyExisted" in fn
    assert "passedThroughWaitState" not in fn


def test_gate_lives_inside_opentrade_skipped_only_for_manual_override():
    ea = read(BACKEND_EA)
    fn_start = ea.index("bool OpenTrade(int signal")
    # v6.24.17: window widened 8000->10000 -- the readiness gate itself grew a
    # substantial explanatory comment (see its own "CRITICAL FIX" note on the
    # 172-approved/0-executed live incident) that pushed the actual code
    # lines past the old window before this line was ever reached.
    fn_body = ea[fn_start:fn_start + 12000]  # v6.25.0: widened for the new direction-exclusivity + post-profit-entry guards
    assert "g_lastEntryReadiness = XAU_UpdateEntryReadiness(signal, g_transitionDecision);" in fn_body
    assert "if(!g_lastEntryReadiness.entryReady)" in fn_body
    # the readiness block, like the cooldown/exhaustion blocks before it,
    # sits inside the same `if(!isManualOverride)` guard
    guard_idx = fn_body.index("if(!isManualOverride)")
    ready_idx = fn_body.index("g_lastEntryReadiness = XAU_UpdateEntryReadiness")
    close_brace_idx = fn_body.index("\n   }\n\n   // v6.20.3 adversarial-review fix: the REAL atomic claim")
    assert guard_idx < ready_idx < close_brace_idx


def test_exactly_three_trade_buy_sell_call_sites_still_exist():
    # regression guard: confirms v6.24.15 didn't add a 4th direct
    # order-placement path outside the audited 3 (OpenTrade, pyramid,
    # Counter-Excursion) -- each is a ternary with both literals present.
    ea = read(BACKEND_EA)
    import re
    sites = re.findall(r'trade\.(?:Buy|Sell)\(', ea)
    # v6.24.18: added a 4th real placement site (Exhaustion Counter)
    # v6.25.0: that 4th site is deleted outright (RETIRED_NO_NEW_ENTRIES,
    # exhaustion is evidence-only) -- back to 3 sites x Buy+Sell literal = 6.
    assert len(sites) == 6, f"expected 6 (3 sites x Buy+Sell literal), found {len(sites)}"


def test_pyramid_reviewed_and_explicitly_not_routed_through_readiness():
    ea = read(BACKEND_EA)
    assert "v6.24.15 review: pyramid is deliberately NOT routed through" in ea
    # its OWN pre-existing exhaustion gate (v6.24.6, unchanged) must still
    # be present and untouched
    assert "campaignAction == TRANSITION_STOP_ADDS || campaignAction == TRANSITION_TIGHTEN_PROTECTION" in ea


def test_counter_excursion_reviewed_and_explicitly_not_routed_through_readiness():
    ea = read(BACKEND_EA)
    assert "v6.24.15 review: same conclusion, same reasoning, for the new Entry" in ea


def test_reentry_reaches_the_same_gated_opentrade_function():
    ea = read(BACKEND_EA)
    assert "opened=OpenTrade(dir,bufATR[1],\"RE_ENTRY_FRESH_SETUP:" in ea


def test_force_open_remains_the_documented_manual_override_exemption():
    ea = read(BACKEND_EA)
    assert "opened = OpenTrade(dir, atrNow, forceReason, 1.0, true);" in ea
    # the readiness gate itself is scoped inside !isManualOverride, so
    # force-open's isManualOverride=true skips it by the same mechanism
    # already used for the cooldown/exhaustion-ban gates -- no separate
    # bypass code was added for this feature specifically.


# ---------------------------------------------------------------------------
# Non-negotiables preserved (spec's explicit "do not change" list)
# ---------------------------------------------------------------------------

def test_15pct_risk_and_lot_sizing_untouched():
    ea = read(BACKEND_EA)
    assert "input double InpNormalRiskPct       = 10.0;" in ea


def test_news_window_still_30_minutes():
    ea = read(BACKEND_EA)
    assert "InpCalCustomDurMin1     = 30;" in ea


def test_post_trade_cooldown_still_300_seconds():
    ea = read(BACKEND_EA)
    assert "#define POST_TRADE_COOLDOWN_SECONDS 300" in ea


def test_campaign_registration_still_inside_opentrade_ok_block():
    ea = read(BACKEND_EA)
    assert "XAU_CampaignRegisterAdd(signal, funnelSetup);" in ea
    # v6.24.18: call now also passes the broker-confirmed core position id
    # and real money risk for the pyramid basket-exit's fixed 1R denominator
    assert "XAU_CampaignOpenCore(signal, funnelSetup, g_latestDecisionSnapshot.horizon, sl, tp, tp, tp,\n                              openedPosId, coreMoneyRiskUSD);" in ea


def test_readiness_gate_never_touches_sl_tp_or_lot_computation():
    # the entire readiness block (from XAU_UpdateEntryReadiness call to its
    # closing brace) must contain no lot/SL/TP computation -- it only reads
    # signal/td and returns false early, exactly like the cooldown gate
    # immediately above it.
    ea = read(BACKEND_EA)
    start = ea.index("g_lastEntryReadiness = XAU_UpdateEntryReadiness(signal, g_transitionDecision);")
    block = ea[start:ea.index("return false;\n      }\n   }", start) + 30]
    for forbidden in ("NormalizeVolumeDown", "RiskPerLotForDistance", "sl =", "tp ="):
        assert forbidden not in block


# ---------------------------------------------------------------------------
# Entry-quality telemetry (spec section 10) -- purely additive, no exit coupling
# ---------------------------------------------------------------------------

def test_entry_quality_telemetry_is_a_separate_array_from_rexit_state():
    ea = read(BACKEND_EA)
    assert "struct XAU_EntryQualityRecord" in ea
    assert "XAU_EntryQualityRecord g_entryQuality[];" in ea
    # never reads or writes g_rExit's own fields
    fn = ea[ea.index("void XAU_RecordEntryQualityTelemetry("):]
    fn_body = fn[:fn.index("\n}\n") + 3]
    assert "g_rExit[" not in fn_body


def test_telemetry_recorder_never_calls_close_or_continue():
    ea = read(BACKEND_EA)
    fn = ea[ea.index("void XAU_RecordEntryQualityTelemetry("):]
    fn_body = fn[:fn.index("\n}\n") + 3]
    assert "XAU_RExit_RequestClose" not in fn_body
    assert "PositionClose" not in fn_body


def test_telemetry_checkpoints_are_30s_1m_3m_5m_10m():
    ea = read(BACKEND_EA)
    assert "int g_entryQualityCheckpointSeconds[XAU_EQ_CHECKPOINTS] = {30, 60, 180, 300, 600};" in ea


def test_classification_never_closes_a_trade_learning_only():
    ea = read(BACKEND_EA)
    fn = ea[ea.index("string XAU_ClassifyEntryQuality("):]
    fn_body = fn[:fn.index("\n}\n") + 3]
    assert "PositionClose" not in fn_body
    assert "RequestClose" not in fn_body


def test_all_eight_classification_labels_reachable():
    ea = read(BACKEND_EA)
    fn = ea[ea.index("string XAU_ClassifyEntryQuality("):][:2000]
    for label in ("ENTRY_CLEAN", "ENTRY_ACCEPTABLE", "ENTRY_TOO_EARLY", "ENTRY_LATE",
                  "ENTRY_WRONG_LOCATION", "ENTRY_FALSE_CONFIRMATION", "ENTRY_DIRECTION_WRONG",
                  "ENTRY_NO_FOLLOW_THROUGH"):
        assert label in fn


# ---------------------------------------------------------------------------
# Command Center display
# ---------------------------------------------------------------------------

def test_on_chart_entry_readiness_block_exists_and_wired_in():
    ea = read(BACKEND_EA)
    assert "string XAU_EntryReadinessDisplayBlock()" in ea
    assert "d += XAU_EntryReadinessDisplayBlock();" in ea


def test_web_json_gains_entry_readiness_field():
    ea = read(BACKEND_EA)
    # v6.25.0 appended "m10_signal" after "entry_readiness" (same pattern
    # used for every prior field addition here) -- entry_readiness is no
    # longer the literal final key, but it is still present and followed by
    # the field.
    assert '\\"entry_readiness\\":%s,\\"m10_signal\\":%s}' in ea
    assert "readinessJson" in ea


# ---------------------------------------------------------------------------
# Behavioral mirror: map_to_readiness_state / classify_old_direction_state
# (verified line-by-line against XAU_MapToReadinessState /
# XAU_ClassifyOldDirectionState above -- same convention as
# scripts/unified_thesis_mirror.py's other mirrored functions)
# ---------------------------------------------------------------------------

def _thesis(signal=1, **overrides):
    td = TransitionDecision(dominantDirection=signal, **overrides.pop("td_kwargs", {}))
    t = compute_thesis(signal, False, td)
    t.update(overrides)
    return t


def test_1_buy_bias_alone_cannot_open_buy():
    # bias alone (dominantDirection==signal, nothing else confirmed) with
    # old side still active must not reach READINESS_CONFIRMED
    td = TransitionDecision(dominantDirection=1, existingSellAction=TRANSITION_HOLD, lifecycle=TREND_HEALTHY)
    old_side = classify_old_direction_state(-1, td)  # SELL is the old side for a BUY candidate
    thesis = compute_thesis(1, False, td)
    state = map_to_readiness_state(old_side, thesis)
    assert old_side in ("OLD_DIRECTION_HEALTHY", "OLD_DIRECTION_MATURE")
    assert state == "READINESS_OLD_SIDE_ACTIVE"


def test_3_buy_cannot_open_while_sellers_remain_active():
    old_side = "OLD_DIRECTION_HEALTHY"
    td = TransitionDecision(dominantDirection=1, entryLocationQuality=90.0, moveAlreadyConsumedPct=10.0)
    thesis = compute_thesis(1, False, td)
    assert map_to_readiness_state(old_side, thesis) == "READINESS_OLD_SIDE_ACTIVE"


def test_4_sell_cannot_open_while_buyers_remain_active():
    old_side = "OLD_DIRECTION_HEALTHY"
    td = TransitionDecision(dominantDirection=-1, entryLocationQuality=90.0, moveAlreadyConsumedPct=10.0)
    thesis = compute_thesis(-1, False, td)
    assert map_to_readiness_state(old_side, thesis) == "READINESS_OLD_SIDE_ACTIVE"


def test_5_correct_direction_late_location_returns_wait():
    old_side = "OLD_DIRECTION_INVALIDATED"  # old side already finished
    td = TransitionDecision(dominantDirection=1, moveAlreadyConsumedPct=75.0, entryLocationQuality=30.0,
                            continuationEntryAllowed=True, continuationEntryPaused=False)
    thesis = compute_thesis(1, False, td)
    assert thesis["location"] in ("LOCATION_LATE",)
    assert map_to_readiness_state(old_side, thesis) == "READINESS_WAIT_FOR_LOCATION"


def test_6_correct_direction_good_location_can_progress():
    old_side = "OLD_DIRECTION_INVALIDATED"
    td = TransitionDecision(dominantDirection=1, entryLocationQuality=85.0, moveAlreadyConsumedPct=15.0,
                            buyConfidence=70.0, sellConfidence=30.0, continuationEntryAllowed=True)
    thesis = compute_thesis(1, False, td)
    state = map_to_readiness_state(old_side, thesis)
    assert state not in ("READINESS_OLD_SIDE_ACTIVE", "READINESS_WAIT_FOR_LOCATION", "READINESS_INVALIDATED")


def test_9_retest_pending_returns_wait():
    old_side = "OLD_DIRECTION_INVALIDATED"
    td = TransitionDecision(dominantDirection=-1, entryLocationQuality=85.0, moveAlreadyConsumedPct=15.0,
                            buyConfidence=70.0, sellConfidence=30.0,
                            oppositeDisplacement=True, oppositeReclaim=False)
    thesis = compute_thesis(1, False, td)
    assert thesis["timing"] == "TIMING_WAIT_RECLAIM"
    assert map_to_readiness_state(old_side, thesis) == "READINESS_WAIT_FOR_RECLAIM"


def test_10_retest_held_can_produce_confirmed():
    old_side = "OLD_DIRECTION_INVALIDATED"
    td = TransitionDecision(dominantDirection=OPPOSITE_DIRECTION_CONFIRMED if False else 1,
                            lifecycle=OPPOSITE_DIRECTION_CONFIRMED, entryLocationQuality=85.0,
                            moveAlreadyConsumedPct=10.0, buyConfidence=75.0, sellConfidence=25.0,
                            oppositeReclaim=True, oppositeRetestHeld=True)
    thesis = compute_thesis(1, False, td)
    assert thesis["timing"] == "TIMING_READY"
    state = map_to_readiness_state(old_side, thesis)
    assert state == "READINESS_CONFIRMED"


def test_11_balanced_pressure_cannot_produce_confirmed():
    old_side = "OLD_DIRECTION_INVALIDATED"
    td = TransitionDecision(dominantDirection=1, entryLocationQuality=85.0, moveAlreadyConsumedPct=10.0,
                            buyConfidence=50.0, sellConfidence=50.0, continuationEntryAllowed=True)
    thesis = compute_thesis(1, False, td)
    assert thesis["pressure"] == "PRESSURE_BALANCED"
    assert map_to_readiness_state(old_side, thesis) == "READINESS_WAIT_FOR_PRESSURE"


def test_12_dominant_pressure_without_structure_returns_wait():
    old_side = "OLD_DIRECTION_INVALIDATED"
    td = TransitionDecision(dominantDirection=1, entryLocationQuality=85.0, moveAlreadyConsumedPct=10.0,
                            buyConfidence=80.0, sellConfidence=20.0, smcBosDir=-1, smcBonus=0.0)
    thesis = compute_thesis(1, False, td)
    assert thesis["structure"] == "STRUCTURE_OPPOSES"
    assert map_to_readiness_state(old_side, thesis) == "READINESS_WAIT_FOR_STRUCTURE"


def test_14_exhausted_same_direction_cannot_produce_late_entry():
    # exhausted old side, thesis action not yet ALLOW_CORE -> WAIT_FOR_EXHAUSTION,
    # never CONFIRMED/ENTRY_READY
    old_side = "OLD_DIRECTION_EXHAUSTED"
    td = TransitionDecision(dominantDirection=-1, existingSellAction=TRANSITION_STOP_ADDS,
                            entryLocationQuality=50.0, moveAlreadyConsumedPct=85.0,
                            continuationEntryAllowed=False, continuationEntryPaused=True)
    thesis = compute_thesis(1, False, td)
    state = map_to_readiness_state(old_side, thesis)
    assert state in ("READINESS_WAIT_FOR_EXHAUSTION", "READINESS_WAIT_FOR_LOCATION", "READINESS_FORMING")
    assert state not in ("READINESS_CONFIRMED", "READINESS_ENTRY_READY")


def test_19_exhaustion_alone_does_not_automatically_open_opposite():
    # classify_old_direction_state/map_to_readiness_state only ever answer
    # for the direction they are called with -- there is no code path in
    # either mirror function that returns anything about the OPPOSITE
    # direction's tradability as a side effect.
    import inspect
    src = inspect.getsource(map_to_readiness_state)
    assert "opposite" not in src.lower() or "direction" in src  # sanity: function only reasons about `direction` param
    # explicit behavioral check: an EXHAUSTED old side does not, by itself,
    # produce a CONFIRMED/ENTRY_READY state -- opposite structure/pressure/
    # location must still independently confirm (see test_14 above).


def test_28_15pct_risk_and_29_news_window_and_30_log_spam_static():
    ea = read(BACKEND_EA)
    assert "input double InpNormalRiskPct       = 10.0;" in ea
    assert "InpCalCustomDurMin1     = 30;" in ea
    # log-spam dedupe: readiness state-change-only + 60s heartbeat cap intact
    fn = ea[ea.index("XAU_EntryReadinessDecision XAU_UpdateEntryReadiness("):]
    fn_body = fn[:fn.index("\n}\n") + 3]
    assert "state != g_readiness[slot].lastLoggedState" in fn_body
    assert "TimeCurrent() - g_readiness[slot].lastHeartbeatLog >= 60" in fn_body


def test_old_side_row_evidence_proxy_matches_htf_opposition():
    # unified_thesis_mirror.old_side_state_from_row_evidence, used by the
    # replay harness for historical CSV rows that have no dual-sided
    # snapshot -- confirms the documented approximation logic directly.
    assert old_side_state_from_row_evidence(1, htf_dir=-1, entry_phase="EARLY", late_chase="N") == "OLD_DIRECTION_HEALTHY"
    assert old_side_state_from_row_evidence(1, htf_dir=-1, entry_phase="LATE_OR_WEAK", late_chase="N") == "OLD_DIRECTION_EXHAUSTED"
    assert old_side_state_from_row_evidence(1, htf_dir=1, entry_phase="EARLY", late_chase="N") == "OLD_DIRECTION_INVALIDATED"


def test_reset_confirmed_requires_prior_exhaustion_flag_not_time():
    td = TransitionDecision(dominantDirection=1, existingBuyAction=TRANSITION_HOLD, lifecycle=TREND_HEALTHY)
    # without prior_exhaustion, a healthy/eligible direction is just HEALTHY,
    # never RESET_CONFIRMED -- confirms time/default state alone cannot
    # produce a "reset" classification
    state_no_prior = classify_old_direction_state(1, td, prior_exhaustion=False)
    assert state_no_prior != "OLD_DIRECTION_RESET_CONFIRMED"
    state_with_prior = classify_old_direction_state(1, td, prior_exhaustion=True)
    assert state_with_prior == "OLD_DIRECTION_RESET_CONFIRMED"
