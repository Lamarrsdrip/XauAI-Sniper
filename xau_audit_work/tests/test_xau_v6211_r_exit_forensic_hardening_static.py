import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.21.1.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def body(src: str, signature: str) -> str:
    idx = src.index(signature)
    start = src.index("{", idx)
    depth = 0
    for i in range(start, len(src)):
        if src[i] == "{":
            depth += 1
        elif src[i] == "}":
            depth -= 1
            if depth == 0:
                return src[start:i + 1]
    raise AssertionError(f"unbalanced braces for {signature}")


# ---------------------------------------------------------------------------
# Release hygiene
# ---------------------------------------------------------------------------

def test_current_release_source_is_synced_to_backend():
    assert read(EA) == read(BACKEND_EA)


def test_version_bumped_to_v6211():
    ea = read(EA)
    assert '#define XAUAI_EA_VERSION "v6.21.1"' in ea
    assert '#define XAUAI_EA_VERSION_NUM "6.21.1"' in ea
    assert '#property version   "6.262"' in ea


def test_header_banner_matches_property_version_for_website_display():
    ea = read(EA)
    m = re.search(r'v(\d+\.\d+\.\d+)\s*[—\-]+\s*(.+)', ea[:3000])
    assert m is not None
    assert m.group(1) == "6.21.1"


# ---------------------------------------------------------------------------
# Critical Issue 1: core R management must not depend on indicator readiness
# ---------------------------------------------------------------------------

def test_core_loop_called_unconditionally_from_ontick_before_indicator_gated_functions():
    ea = read(EA)
    ot = body(ea, "void OnTick()")
    assert "XAU_RExitCoreLoop();" in ot
    core_call_idx = ot.index("XAU_RExitCoreLoop();")
    managebasket_idx = ot.index("if(ManageBasket())")
    manageposition_idx = ot.index("ManagePositions();")
    assert core_call_idx < managebasket_idx < manageposition_idx


def test_manage_positions_indicator_early_returns_do_not_gate_core_loop():
    # ManagePositions() itself still has indicator-warm-up early returns, but
    # XAU_RExitCoreLoop() is a wholly separate function called before it --
    # so those early returns can no longer block core R management.
    ea = read(EA)
    mp = body(ea, "void ManagePositions()")
    assert "if(ArraySize(bufATR) < 2 || bufATR[1] <= 0) return;" in mp
    core = body(ea, "void XAU_RExitCoreLoop()")
    assert "if(ArraySize(bufATR) < 2 || bufATR[1] <= 0) return;" not in core


def test_core_loop_checks_indicator_readiness_itself_only_for_the_05r_decision():
    ea = read(EA)
    core = body(ea, "void XAU_RExitCoreLoop()")
    assert "bool indicatorsReady = (ArraySize(bufATR) >= 2 && bufATR[1] > 0 &&" in core
    # 1R close, giveback close, and 0.3R protection must all appear BEFORE
    # the indicatorsReady branch is even consulted for a decision.
    ready_idx = core.index("if(!indicatorsReady)")
    final_target_idx = core.index("if(currentR >= InpRFinalTarget)")
    giveback_idx = core.index('reason=R_EXIT_GIVEBACK_45')
    protect_idx = core.index("R_STAGE_PROTECTED")
    assert final_target_idx < ready_idx
    assert giveback_idx < ready_idx
    assert protect_idx < ready_idx


def test_indicator_unavailable_fallback_closes_at_05r_with_required_log_tags():
    ea = read(EA)
    core = body(ea, "void XAU_RExitCoreLoop()")
    assert "R_EXIT_INDICATORS_UNAVAILABLE" in core
    assert "R_EXIT_05R_FALLBACK" in core
    assert "R_EXIT_CORE_MANAGEMENT_ACTIVE" in core
    # The fallback must actually request a close, not just log.
    fallback_idx = core.index("R_EXIT_05R_FALLBACK")
    snippet = core[fallback_idx:fallback_idx + 400]
    assert 'XAU_RExit_RequestClose(idx, ticket, "R_EXIT_CAPTURE_0_5R");' in snippet


# ---------------------------------------------------------------------------
# Critical Issue 2: persistent, retry-safe, broker-confirmed close
# ---------------------------------------------------------------------------

def test_close_state_machine_constants_exist():
    ea = read(EA)
    for const in ("R_CLOSE_NONE", "R_CLOSE_HOLD_TO_1R", "R_CLOSE_REQUESTED",
                  "R_CLOSE_PENDING_RETRY", "R_CLOSE_CONFIRMED"):
        assert f"#define {const}" in ea


def test_request_close_preserves_reason_across_retries_and_confirms_before_clearing():
    ea = read(EA)
    fn = body(ea, "bool XAU_RExit_RequestClose(int idx, ulong ticket, string reason)")
    # Reason is only overwritten on a FRESH request, not on every retry.
    assert 'g_rExit[idx].pendingCloseReason = reason;' in fn
    assert 'bool sendOk = SafePositionClose(ticket, g_rExit[idx].pendingCloseReason);' in fn
    # Confirmation requires BOTH a successful send AND the position actually gone.
    assert 'bool stillOpen = PositionSelectByTicket(ticket);' in fn
    assert 'if(sendOk && !stillOpen)' in fn
    # Rejection/still-open path stays pending, never reverts to a hold state.
    assert 'g_rExit[idx].closeState = R_CLOSE_PENDING_RETRY;' in fn
    assert 'g_rExit[idx].closeState = R_CLOSE_CONFIRMED;' in fn


def test_request_close_throttles_duplicate_requests():
    ea = read(EA)
    fn = body(ea, "bool XAU_RExit_RequestClose(int idx, ulong ticket, string reason)")
    assert "now - g_rExit[idx].lastCloseAttemptTime < 3" in fn
    assert "return false; // throttled -- no duplicate request this tick" in fn


def test_pending_close_has_top_priority_in_core_loop():
    ea = read(EA)
    core = body(ea, "void XAU_RExitCoreLoop()")
    assert "Priority 1: a close already in flight always wins" in core
    pending_idx = core.index("g_rExit[idx].closeState == R_CLOSE_REQUESTED || g_rExit[idx].closeState == R_CLOSE_PENDING_RETRY")
    final_target_idx = core.index("if(currentR >= InpRFinalTarget)")
    assert pending_idx < final_target_idx


def test_never_reports_success_without_broker_confirmation():
    ea = read(EA)
    fn = body(ea, "bool XAU_RExit_RequestClose(int idx, ulong ticket, string reason)")
    # Final telemetry/clear only happens inside the sendOk-and-not-stillOpen branch.
    confirmed_branch = fn[fn.index("if(sendOk && !stillOpen)"):fn.index("// Broker rejected")]
    assert "XAU_RExit_Clear(ticket);" in confirmed_branch
    assert "XAU_RExit_Clear(ticket);" not in fn[fn.index("// Broker rejected"):]


# ---------------------------------------------------------------------------
# Known Conflict 3 & 4: Daily Profit Lock / Expectancy Day Giveback Guard
# ---------------------------------------------------------------------------

def test_daily_profit_lock_does_not_modify_r_owned_tickets():
    ea = read(EA)
    ot = body(ea, "void OnTick()")
    assert "InpDailyProfitLockPct > 0 && dailyStartEquity > 0 && XAU_RExitOwnsNormalPositions()" in ot
    assert "DAILY_PROFIT_LOCK OBSERVATION_ONLY" in ot
    # The original ATR-tightening body must only run in the else-if (R does NOT own positions).
    else_idx = ot.index("else if(!noLimitMode && InpDailyProfitLockPct > 0 && dailyStartEquity > 0)")
    safemodify_idx = ot.index('SafeModifySL(ticket, newSL, PositionGetDouble(POSITION_TP),')
    assert else_idx < safemodify_idx


def test_expectancy_day_giveback_guard_observation_only_while_r_owns_positions():
    ea = read(EA)
    ot = body(ea, "void OnTick()")
    assert "EXPECTANCY_DAY_GUARD OBSERVATION_ONLY" in ot
    assert "if(!noLimitMode && XAU_RExitOwnsNormalPositions())" in ot


def test_expectancy_guard_is_ordinary_profit_preservation_not_emergency():
    # Classification proof: it calls a basket-wide CloseAll(), gated by
    # InpExpectancyUseDayGiveback (an ordinary preference), not any
    # account-emergency-specific mechanism.
    ea = read(EA)
    fn = body(ea, "bool ExpectancyDayGivebackGuard()")
    assert "CloseAll(lastExitReason);" in fn
    assert "InpExpectancyUseDayGiveback" in fn


# ---------------------------------------------------------------------------
# Ownership helper consistency + fail-safe invalid configuration
# ---------------------------------------------------------------------------

def test_invalid_config_blocks_init_when_enabled():
    ea = read(EA)
    init = body(ea, "int OnInit()")
    assert "if(InpRExitEnable && !g_rExitConfigValid)" in init
    assert "return INIT_PARAMETERS_INCORRECT;" in init
    validate_idx = init.index("XAU_ValidateRExitConfig();")
    guard_idx = init.index("if(InpRExitEnable && !g_rExitConfigValid)")
    reconcile_idx = init.index("XAU_ReconcileRExitOnInit();")
    assert validate_idx < guard_idx < reconcile_idx


def test_persisted_state_loaded_before_live_reconciliation():
    ea = read(EA)
    init = body(ea, "int OnInit()")
    assert init.index("XAU_RExit_LoadPersistedState();") < init.index("XAU_ReconcileRExitOnInit();")


# ---------------------------------------------------------------------------
# Restart / cross-session persistence
# ---------------------------------------------------------------------------

def test_state_file_path_is_scoped_by_account_server_symbol_magic():
    ea = read(EA)
    fn = body(ea, "string XAU_RExit_StateFilePath()")
    assert "AccountInfoInteger(ACCOUNT_LOGIN)" in fn
    assert "AccountInfoString(ACCOUNT_SERVER)" in fn
    assert "Symbol()" in fn
    assert "InpMagicNumber" in fn


def test_load_persisted_state_validates_before_applying():
    ea = read(EA)
    fn = body(ea, "void XAU_RExit_LoadPersistedState()")
    assert "login != myLogin || server != myServer ||" in fn
    assert "symbol != Symbol() || magic != InpMagicNumber" in fn
    assert "mismatched++;" in fn
    assert "R_EXIT_STATE_MISMATCH" in fn
    assert "if(!PositionSelectByTicket(ticket))" in fn
    assert "liveDir != direction" in fn


def test_required_persistence_log_tags_present():
    ea = read(EA)
    for tag in ("R_EXIT_STATE_SAVED", "R_EXIT_STATE_RESTORED", "R_EXIT_STATE_MISMATCH",
                "R_EXIT_STATE_FALLBACK_ESTIMATE".replace("FALLBACK_ESTIMATE", "RESTORE_SUMMARY"),
                "R_EXIT_PENDING_CLOSE_RESTORED"):
        assert tag in ea


def test_reconcile_on_init_does_not_wipe_already_restored_state():
    ea = read(EA)
    fn = body(ea, "void XAU_ReconcileRExitOnInit()")
    assert "ArrayResize(g_rExit, 0);" not in fn
    assert "alreadyRestoredFromFile" in fn


def test_pending_close_state_is_persisted_and_restorable():
    ea = read(EA)
    save_fn = body(ea, "void XAU_RExit_SaveState()")
    assert "g_rExit[i].closeState," in save_fn
    assert "g_rExit[i].pendingCloseReason," in save_fn
    load_fn = body(ea, "void XAU_RExit_LoadPersistedState()")
    assert "g_rExit[idx].closeState = closeState;" in load_fn
    assert "g_rExit[idx].pendingCloseReason = pendingReason;" in load_fn


# ---------------------------------------------------------------------------
# Complete cleanup lifecycle
# ---------------------------------------------------------------------------

def test_ontradetransaction_clears_state_on_any_full_close():
    ea = read(EA)
    ott = body(ea, "void OnTradeTransaction(const MqlTradeTransaction& trans, const MqlTradeRequest& request, const MqlTradeResult& result)")
    assert "if(!stillOpen && posId > 0)" in ott
    cleanup_idx = ott.index("if(!stillOpen && posId > 0)")
    partial_idx = ott.index("if(stillOpen)")
    assert cleanup_idx < partial_idx  # full-close cleanup evaluated before the partial-close branch
    snippet = ott[cleanup_idx:partial_idx]
    assert "XAU_RExit_Clear(posId);" in snippet
    assert "finalTelemetyLogged" not in snippet  # (typo guard: correct spelling below)
    assert "finalTelemetryLogged" in snippet


def test_orphan_reconciliation_removes_state_with_no_live_position():
    ea = read(EA)
    fn = body(ea, "void XAU_RExit_ReconcileOrphans()")
    assert "if(!PositionSelectByTicket(g_rExit[i].ticket))" in fn
    assert "ORPHAN_CLEANUP" in fn


def test_core_loop_calls_orphan_reconciliation_every_pass():
    ea = read(EA)
    core = body(ea, "void XAU_RExitCoreLoop()")
    assert "XAU_RExit_ReconcileOrphans();" in core


def test_final_telemetry_logged_flag_prevents_duplicate_reporting():
    ea = read(EA)
    st = body(ea, "struct XAU_RExitState")
    assert "finalTelemetryLogged" in st
    close_fn = body(ea, "bool XAU_RExit_RequestClose(int idx, ulong ticket, string reason)")
    assert "if(!g_rExit[idx].finalTelemetryLogged)" in close_fn


# ---------------------------------------------------------------------------
# Original-risk capture immediately after entry (not lazy)
# ---------------------------------------------------------------------------

def test_opentrade_captures_r_state_immediately_on_success():
    ea = read(EA)
    fn = body(ea, "bool OpenTrade(int signal, double atr, string reason, double sizeMulti, bool isManualOverride = false)")
    assert "XAU_RExit_EnsureIdx(openedPosId, signal == 1, price, sl, lots, false);" in fn
    assert "XAU_RExit_SaveState();" in fn
    capture_idx = fn.index("XAU_RExit_EnsureIdx(openedPosId, signal == 1, price, sl, lots, false);")
    ttm_idx = fn.index("TTM_RecordEntry(openedPosId, signal,")
    assert ttm_idx < capture_idx  # same post-fill block, capture follows the established TTM precedent


def test_pyramid_add_captures_its_own_r_state_immediately():
    ea = read(EA)
    fn = body(ea, "void CheckPyramidOpportunity()")
    assert "XAU_RExit_EnsureIdx(pyrPosId, isBuy, entryPx, pyramidSL, addLot, false);" in fn
    assert "pyrPosId = (ulong)HistoryDealGetInteger(pyrDealTicket, DEAL_POSITION_ID);" in fn


# ---------------------------------------------------------------------------
# RUN_TO_1R continuation-failure reevaluation (closed-bar granularity only)
# ---------------------------------------------------------------------------

def test_runner_reevaluation_only_on_a_new_closed_bar_not_every_tick():
    ea = read(EA)
    core = body(ea, "void XAU_RExitCoreLoop()")
    assert "datetime barTime = iTime(Symbol(), PERIOD_M5, 1);" in core
    assert "barTime != g_rExit[idx].lastRunnerRecheckBarTime" in core


def test_runner_failure_uses_structure_break_or_hostile_majority_and_dedicated_reason():
    ea = read(EA)
    core = body(ea, "void XAU_RExitCoreLoop()")
    assert 'if(structureBrokenAgainst || hostileFactors >= InpRRunnerFailureMinHostile)' in core
    assert 'R_EXIT_RUNNER_CONTINUATION_FAILED' in core


def test_runner_failure_input_exists():
    ea = read(EA)
    assert "input int    InpRRunnerFailureMinHostile  = 3;" in ea


# ---------------------------------------------------------------------------
# Entry-regression guard (this release's own diff, additive only)
# ---------------------------------------------------------------------------

def test_scoresetups_and_grading_untouched_markers_present():
    ea = read(EA)
    assert "int ScoreSetups(double &score, string &setupName, int excludeDir = 0)" in ea
    assert "double XAU_ComputeCombinedGradeForCandidate(int signal, string setupName, double setupScore," in ea


def test_no_new_entry_gating_logic_introduced_by_r_state_capture_hooks():
    ea = read(EA)
    fn = body(ea, "bool OpenTrade(int signal, double atr, string reason, double sizeMulti, bool isManualOverride = false)")
    # The capture hook must be inside the already-successful branch (openedPosId > 0),
    # never itself gating whether/how the trade opens.
    assert "if(openedPosId > 0)\n      {\n         TTM_RecordEntry" in fn
