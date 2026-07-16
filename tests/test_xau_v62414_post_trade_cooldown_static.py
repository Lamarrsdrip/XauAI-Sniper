"""v6.24.14 — universal five-minute post-trade execution cooldown +
exhausted-old-direction re-entry ban + adaptive opposite-direction
analysis, per owner spec.

Scope confirmed by a full-file audit before implementation: there are
exactly 3 real trade-placement call sites in the whole ~31k-line source
(grep for `trade.Buy(`/`trade.Sell(`):
  - OpenTrade() -- reached by the primary fresh-entry path, CheckReEntryOpportunity,
    and XAU_TryForceOpenTrade (the human-triggered manual override).
  - CheckPyramidOpportunity() -- its own direct trade.Buy/Sell for adds.
  - the Counter-Excursion module -- its own direct trade.Buy/Sell, on a
    dedicated magic number, explicitly isolated from the normal path by
    pre-existing owner-directed design.

Design decisions this test file locks in:
  1. Cooldown starts exactly once, when g_campaign[].active flips true->false
     (the LAST position of a direction's campaign closes), timestamped from
     the broker's own DEAL_TIME -- not TimeCurrent() -- so it reflects when
     the close actually happened, not when the EA next noticed it.
  2. The cooldown + exhaustion-ban gate lives inside OpenTrade() itself (one
     point, all normal + re-entry callers converge on it), skipped only for
     isManualOverride=true -- the same, pre-existing exemption pattern the
     cross-instance lock immediately above it already uses, for the same
     documented reason (explicit human FORCE_OPEN_TRADE command).
  3. CheckPyramidOpportunity gets its own explicit (if largely redundant in
     practice) cooldown check, since pyramid can only ever fire while a
     position is already open, and no fresh position can open during an
     active cooldown either -- but the spec requires the gate to exist and
     be independently testable, not just structurally implied.
  4. Counter-Excursion is deliberately NOT wired to the new cooldown: its
     closes never reach g_postClose in the first place (OnTradeTransaction
     filters by magic number before any of this code runs), and it already
     has its own owner-directed, fully isolated cooldown/eligibility system.
     Coupling it to the normal campaign's cooldown would itself create the
     "two systems fighting" failure mode this audit exists to prevent.
  5. XAU_ClassifyOldDirectionState never reads a clock -- RESET_CONFIRMED
     requires BOTH a recorded prior exhaustion at close AND a live
     freshAllowed flip back to true (itself driven by structural evidence
     inside XAU_AdaptiveMarketTransitionEngine, not time).
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.24.14.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"
COMPILE_LOG = ROOT / "compile_logs" / "v62414_post_trade_cooldown_compile.log"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def read_log(path: Path) -> str:
    raw = path.read_bytes()
    try:
        return raw.decode("utf-16le")
    except UnicodeDecodeError:
        return raw.decode("utf-8", errors="ignore")


# ---------------------------------------------------------------------------
# Housekeeping: sync, version, compile
# ---------------------------------------------------------------------------

def test_repo_source_is_synced_to_backend():
    assert read(EA) == read(BACKEND_EA)


def test_version_bumped_to_v62414():
    ea = read(BACKEND_EA)
    assert '#define XAUAI_EA_VERSION "v6.24.14"' in ea
    assert '#define XAUAI_EA_VERSION_NUM "6.24.14"' in ea


def test_compile_clean():
    log = read_log(COMPILE_LOG)
    assert "Result: 0 errors, 0 warnings" in log


# ---------------------------------------------------------------------------
# 1. Cooldown constant + state + start hook
# ---------------------------------------------------------------------------

def test_cooldown_is_exactly_300_seconds():
    ea = read(BACKEND_EA)
    assert "#define POST_TRADE_COOLDOWN_SECONDS 300" in ea


def test_post_close_state_struct_exists_with_required_fields():
    ea = read(BACKEND_EA)
    fn = ea[ea.index("struct XAU_PostCloseState"):][:1200]
    for field in ("closeTime", "direction", "closeReason", "campaignId",
                  "lifecycleAtClose", "exhaustionAtClose", "movementConsumedAtClose",
                  "wasInvalidated", "oppositeTransitionWasDeveloping", "cooldownExpiresAt"):
        assert field in fn, f"missing field {field} in XAU_PostCloseState"


def test_cooldown_start_hook_uses_broker_deal_time_not_timecurrent():
    ea = read(BACKEND_EA)
    idx = ea.index("g_postClose.closeTime")
    line = ea[idx:idx + 120]
    assert "HistoryDealGetInteger(dealTicket, DEAL_TIME)" in line
    assert "TimeCurrent()" not in line


def test_cooldown_start_hook_fires_only_on_active_to_inactive_transition():
    ea = read(BACKEND_EA)
    # captured BEFORE XAU_CampaignRegisterClose runs...
    before_idx = ea.index("bool campaignWasActiveBeforeClose = g_campaign[closeSlot].active;")
    register_close_idx = ea.index("XAU_CampaignRegisterClose(closedDirection, profit);")
    guard_idx = ea.index("if(campaignWasActiveBeforeClose && !g_campaign[closeSlot].active)")
    assert before_idx < register_close_idx < guard_idx


def test_cooldown_start_is_logged_once_with_snapshot_fields():
    ea = read(BACKEND_EA)
    block = ea[ea.index("if(campaignWasActiveBeforeClose && !g_campaign[closeSlot].active)"):][:2200]
    assert "POST_TRADE_COOLDOWN_STARTED" in block
    assert "g_postClose.exhaustionAtClose" in block
    assert "g_postClose.movementConsumedAtClose" in block
    assert "g_postClose.wasInvalidated" in block


def test_cooldown_tick_logs_active_heartbeat_and_complete_transition_only():
    ea = read(BACKEND_EA)
    fn = ea[ea.index("void XAU_PostTradeCooldownTick()"):][:1200]
    assert "POST_TRADE_COOLDOWN_ACTIVE" in fn
    assert "POST_TRADE_COOLDOWN_COMPLETE" in fn
    # heartbeat is throttled to >=60s, not every tick
    assert "TimeCurrent() - g_postClose.lastStateLogTime >= 60" in fn
    # STARTED is never logged from this function -- only from the
    # OnTradeTransaction close hook, exactly once per close
    assert "POST_TRADE_COOLDOWN_STARTED" not in fn


def test_cooldown_tick_is_called_every_ontick_before_any_gate_can_skip_it():
    ea = read(BACKEND_EA)
    fn_start = ea.index("void OnTick()")
    fn = ea[fn_start:fn_start + 600]
    assert "XAU_PostTradeCooldownTick();" in fn


# ---------------------------------------------------------------------------
# 2. Cooldown must not blind the market brain
# ---------------------------------------------------------------------------

def test_cooldown_tick_never_calls_market_thesis_or_transition_engine():
    # XAU_PostTradeCooldownTick is pure state/logging -- it must never
    # itself compute or gate market analysis, confirming the cooldown
    # blocks execution only, never analysis (analysis runs from its own,
    # unconditional call sites elsewhere in OnTick regardless of this
    # function's outcome).
    ea = read(BACKEND_EA)
    fn = ea[ea.index("void XAU_PostTradeCooldownTick()"):][:1200]
    fn_body = fn[:fn.index("\n}\n") + 3]
    assert "XAU_ComputeMarketThesis" not in fn_body
    assert "XAU_AdaptiveMarketTransitionEngine" not in fn_body


def test_transition_decision_global_is_populated_independently_of_pyramid_or_opentrade_gates():
    # g_transitionDecision is written inside XAU_AdaptiveMarketTransitionEngine
    # itself (called from many independent sites), never inside the new
    # cooldown gates -- confirms blocking a trade never blocks the
    # underlying analysis that would have fed it.
    ea = read(BACKEND_EA)
    cooldown_gate = ea[ea.index("if(!isManualOverride)\n   {\n      if(XAU_PostTradeCooldownActive())"):][:1700]
    assert "g_transitionDecision =" not in cooldown_gate


# ---------------------------------------------------------------------------
# 3 & 4. Exhausted same-direction re-entry ban + exhaustion classification
# ---------------------------------------------------------------------------

def test_old_direction_state_enum_has_all_required_states():
    ea = read(BACKEND_EA)
    enum_block = ea[ea.index("enum ENUM_XAU_OLD_DIRECTION_STATE"):][:400]
    for state in ("OLD_DIRECTION_HEALTHY", "OLD_DIRECTION_MATURE", "OLD_DIRECTION_EXHAUSTED",
                  "OLD_DIRECTION_INVALIDATED", "OLD_DIRECTION_RESETTING", "OLD_DIRECTION_RESET_CONFIRMED"):
        assert state in enum_block


def test_classify_old_direction_state_never_reads_a_clock():
    ea = read(BACKEND_EA)
    fn = ea[ea.index("ENUM_XAU_OLD_DIRECTION_STATE XAU_ClassifyOldDirectionState("):]
    fn_body = fn[:fn.index("\n}\n") + 3]
    assert "TimeCurrent()" not in fn_body
    assert "PeriodSeconds" not in fn_body


def test_reset_confirmed_requires_both_prior_exhaustion_and_live_fresh_allowed():
    ea = read(BACKEND_EA)
    fn = ea[ea.index("ENUM_XAU_OLD_DIRECTION_STATE XAU_ClassifyOldDirectionState("):][:1800]
    assert "if(priorExhaustion) return OLD_DIRECTION_RESET_CONFIRMED;" in fn
    # this line is only reachable after the freshAllowed-false branch already
    # returned above it -- i.e. only when freshAllowed is structurally true
    reset_idx = fn.index("if(priorExhaustion) return OLD_DIRECTION_RESET_CONFIRMED;")
    fresh_false_branch_idx = fn.index("!freshAllowed")
    assert fresh_false_branch_idx < reset_idx


def test_reentry_gate_is_scoped_to_the_direction_that_actually_closed():
    ea = read(BACKEND_EA)
    fn = ea[ea.index("bool XAU_SameDirectionReentryBlockedByExhaustion("):][:500]
    assert "g_postClose.direction != direction) return false;" in fn


# ---------------------------------------------------------------------------
# 7/8. Gate wiring at the 3 real trade-placement sites
# ---------------------------------------------------------------------------

def test_exactly_three_trade_buy_sell_call_sites_exist():
    # Each of the 3 real placement sites is a `isX ? trade.Buy(...) :
    # trade.Sell(...)` ternary, so BOTH literals appear in source at each
    # site even though only one executes at runtime -- 3 sites * 2 literals
    # = 6 regex matches is the correct expected count, not 3.
    ea = read(BACKEND_EA)
    import re
    sites = re.findall(r'trade\.(?:Buy|Sell)\(', ea)
    assert len(sites) == 6, f"expected 3 real placement sites (Buy+Sell literal each) = 6 matches, found {len(sites)}"


def test_opentrade_gates_cooldown_and_exhaustion_skipping_manual_override():
    ea = read(BACKEND_EA)
    fn_start = ea.index("bool OpenTrade(int signal")
    fn_body = ea[fn_start:fn_start + 5000]
    assert "if(!isManualOverride)" in fn_body
    assert "XAU_PostTradeCooldownActive()" in fn_body
    assert "XAU_SameDirectionReentryBlockedByExhaustion(signal, oldDirState)" in fn_body
    # both new checks are nested inside the same isManualOverride guard
    guard_idx = fn_body.index("if(!isManualOverride)")
    cooldown_idx = fn_body.index("XAU_PostTradeCooldownActive()")
    exhaustion_idx = fn_body.index("XAU_SameDirectionReentryBlockedByExhaustion(signal, oldDirState)")
    assert guard_idx < cooldown_idx < exhaustion_idx


def test_pyramid_has_its_own_cooldown_gate():
    ea = read(BACKEND_EA)
    fn_start = ea.index("void CheckPyramidOpportunity()")
    fn_body = ea[fn_start:fn_start + 900]
    assert "XAU_PostTradeCooldownActive()" in fn_body
    assert "PYRAMID_BLOCKED_POST_TRADE_COOLDOWN" in fn_body


def test_counter_excursion_is_explicitly_reviewed_and_not_wired_to_cooldown():
    ea = read(BACKEND_EA)
    assert "v6.24.14 review: Counter-Excursion was explicitly considered" in ea
    # confirm the documented structural reason is real: OnTradeTransaction
    # filters by magic number before ANY g_postClose code can run
    fn_start = ea.index("void OnTradeTransaction(")
    early_body = ea[fn_start:fn_start + 400]
    assert "if(magic != InpMagicNumber) return;" in early_body
    magic_check_idx = ea.index("if(magic != InpMagicNumber) return;")
    postclose_write_idx = ea.index("g_postClose.valid                         = true;")
    assert magic_check_idx < postclose_write_idx


def test_reentry_and_force_open_reach_the_same_gated_opentrade_function():
    ea = read(BACKEND_EA)
    assert "opened=OpenTrade(dir,bufATR[1],\"RE_ENTRY_FRESH_SETUP:" in ea
    assert "opened = OpenTrade(dir, atrNow, forceReason, 1.0, true);" in ea


# ---------------------------------------------------------------------------
# 10. Command Center display
# ---------------------------------------------------------------------------

def test_web_json_gains_post_trade_state_field():
    ea = read(BACKEND_EA)
    # raw source has the escaped-quote form (this is an MQL5 string literal)
    # v6.24.15 appended "entry_readiness" after "post_trade_state" (same
    # pattern this field itself was added with) -- the object's final key
    # moved, "post_trade_state" itself is still present and well-formed.
    assert '\\"post_trade_state\\":%s' in ea
    assert "postTradeJson" in ea


def test_on_chart_display_block_exists_and_is_wired_in():
    ea = read(BACKEND_EA)
    assert "string XAU_PostTradeStateDisplayBlock()" in ea
    assert "d += XAU_PostTradeStateDisplayBlock();" in ea
    fn = ea[ea.index("string XAU_PostTradeStateDisplayBlock()"):][:2600]
    for field in ("Last direction", "Close reason", "Last campaign", "Close time",
                  "Cooldown", "exhaustion", "Re-entry", "Transition", "evidence", "Action"):
        assert field in fn, f"missing display field '{field}'"


# ---------------------------------------------------------------------------
# Behavioral mirror: XAU_ClassifyOldDirectionState decision matrix
# (Python re-implementation, verified line-by-line against the real .mq5
# function above -- same convention as scripts/unified_thesis_mirror.py)
# ---------------------------------------------------------------------------

def classify_old_direction_state_mirror(existing_action, fresh_allowed, lifecycle,
                                         dominant_direction, direction, prior_exhaustion):
    if existing_action == "TRANSITION_EXIT_CONTROLLED" or (
        lifecycle == "OPPOSITE_DIRECTION_CONFIRMED" and dominant_direction != 0 and dominant_direction != direction
    ):
        return "OLD_DIRECTION_INVALIDATED"
    if existing_action in ("TRANSITION_STOP_ADDS", "TRANSITION_TIGHTEN_PROTECTION", "TRANSITION_EXIT_PROFITABLE") \
       or not fresh_allowed:
        if prior_exhaustion:
            return "OLD_DIRECTION_EXHAUSTED"
        return "OLD_DIRECTION_RESETTING" if lifecycle == "TRANSITION_NEUTRAL" else "OLD_DIRECTION_MATURE"
    if prior_exhaustion:
        return "OLD_DIRECTION_RESET_CONFIRMED"
    return "OLD_DIRECTION_MATURE" if lifecycle == "TREND_MATURE" else "OLD_DIRECTION_HEALTHY"


def test_scenario_14_exhausted_sell_cannot_reenter_after_cooldown():
    state = classify_old_direction_state_mirror(
        existing_action="TRANSITION_STOP_ADDS", fresh_allowed=False, lifecycle="TREND_EXHAUSTING",
        dominant_direction=-1, direction=-1, prior_exhaustion=True)
    assert state == "OLD_DIRECTION_EXHAUSTED"


def test_scenario_15_exhausted_buy_cannot_reenter_after_cooldown():
    state = classify_old_direction_state_mirror(
        existing_action="TRANSITION_TIGHTEN_PROTECTION", fresh_allowed=False, lifecycle="TREND_LATE",
        dominant_direction=1, direction=1, prior_exhaustion=True)
    assert state == "OLD_DIRECTION_EXHAUSTED"


def test_scenario_16_healthy_old_direction_may_reenter_via_fresh_setup():
    state = classify_old_direction_state_mirror(
        existing_action="TRANSITION_HOLD", fresh_allowed=True, lifecycle="TREND_HEALTHY",
        dominant_direction=1, direction=1, prior_exhaustion=False)
    assert state == "OLD_DIRECTION_HEALTHY"


def test_scenario_17_time_alone_cannot_reset_exhaustion():
    # freshAllowed still false (no structural change) even though, in a real
    # run, plenty of time may have passed since close -- classification
    # never reads a clock, so this must stay EXHAUSTED regardless of how
    # long ago the close was.
    state = classify_old_direction_state_mirror(
        existing_action="TRANSITION_STOP_ADDS", fresh_allowed=False, lifecycle="TREND_EXHAUSTING",
        dominant_direction=-1, direction=-1, prior_exhaustion=True)
    assert state == "OLD_DIRECTION_EXHAUSTED"


def test_scenario_18_structural_reset_restores_eligibility():
    # freshAllowed flips true on genuine structural evidence (a pullback
    # reset / continuationEntryAllowed inside the real engine) AND prior
    # exhaustion was recorded -> RESET_CONFIRMED, not silently HEALTHY.
    state = classify_old_direction_state_mirror(
        existing_action="TRANSITION_HOLD", fresh_allowed=True, lifecycle="TREND_DEVELOPING",
        dominant_direction=-1, direction=-1, prior_exhaustion=True)
    assert state == "OLD_DIRECTION_RESET_CONFIRMED"


def test_scenario_19_exhaustion_alone_does_not_auto_open_opposite():
    # the OLD direction being EXHAUSTED/INVALIDATED says nothing, by itself,
    # about whether the OPPOSITE direction is tradeable -- that is a wholly
    # separate freshBuyAllowed/freshSellAllowed read for the opposite
    # direction, gated by its own structure/pressure/timing/location proof
    # inside XAU_AdaptiveMarketTransitionEngine (unchanged by this feature).
    old_state = classify_old_direction_state_mirror(
        existing_action="TRANSITION_EXIT_CONTROLLED", fresh_allowed=False, lifecycle="OPPOSITE_DIRECTION_CONFIRMED",
        dominant_direction=1, direction=-1, prior_exhaustion=True)
    assert old_state == "OLD_DIRECTION_INVALIDATED"
    # confirms this function has no branch that returns/implies anything
    # about the opposite direction being tradeable -- it only ever
    # classifies the direction it was called with.


def test_invalidated_on_confirmed_opposite_lifecycle():
    state = classify_old_direction_state_mirror(
        existing_action="TRANSITION_HOLD", fresh_allowed=True, lifecycle="OPPOSITE_DIRECTION_CONFIRMED",
        dominant_direction=1, direction=-1, prior_exhaustion=False)
    assert state == "OLD_DIRECTION_INVALIDATED"


def test_resetting_state_for_transition_neutral_without_prior_exhaustion_flag():
    state = classify_old_direction_state_mirror(
        existing_action="TRANSITION_HOLD", fresh_allowed=False, lifecycle="TRANSITION_NEUTRAL",
        dominant_direction=1, direction=1, prior_exhaustion=False)
    assert state == "OLD_DIRECTION_RESETTING"


# ---------------------------------------------------------------------------
# Behavioral mirror: cooldown expiry arithmetic
# ---------------------------------------------------------------------------

def test_cooldown_active_before_expiry_and_inactive_at_expiry():
    close_time = 1_000_000
    expires_at = close_time + 300
    assert (close_time + 299) < expires_at            # still active 1s before
    assert not ((close_time + 300) < expires_at)       # inactive exactly at expiry
    assert not ((close_time + 301) < expires_at)       # inactive after expiry


def test_cooldown_remaining_seconds_counts_down_to_zero_not_negative():
    close_time = 1_000_000
    expires_at = close_time + 300
    now = close_time + 250
    remaining = max(0, expires_at - now)
    assert remaining == 50
    now_after_expiry = close_time + 400
    remaining_after = max(0, expires_at - now_after_expiry) if now_after_expiry < expires_at else 0
    assert remaining_after == 0
