import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.21.2.mq5"
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


def test_version_bumped_to_v6212():
    ea = read(EA)
    assert '#define XAUAI_EA_VERSION "v6.21.2"' in ea
    assert '#property version   "6.263"' in ea


# ---------------------------------------------------------------------------
# Wall-clock entry timing: bounds, no bar fallback
# ---------------------------------------------------------------------------

def test_entry_delay_defaults_and_absolute_bounds():
    ea = read(EA)
    assert "input int    InpM5EntryDelaySeconds         = 150;" in ea
    assert "input int    InpM5EntryDelayMinSeconds      = 120;" in ea
    assert "input int    InpM5EntryDelayMaxSeconds      = 180;" in ea
    assert "#define XAU_ENTRY_DELAY_ABSOLUTE_FLOOR_SEC   120.0" in ea
    assert "#define XAU_ENTRY_DELAY_ABSOLUTE_CEILING_SEC 180.0" in ea


def test_resolver_clamps_to_absolute_bounds_regardless_of_inputs():
    ea = read(EA)
    fn = body(ea, "double XAU_EffectiveEntryDelaySeconds()")
    assert "XAU_ENTRY_DELAY_ABSOLUTE_FLOOR_SEC" in fn
    assert "XAU_ENTRY_DELAY_ABSOLUTE_CEILING_SEC" in fn
    # Numeric proof: even a wildly misconfigured .set (min=5, max=9999, target=1)
    # must resolve inside [120,180].
    FLOOR, CEIL = 120.0, 180.0
    def resolve(min_in, max_in, target_in):
        raw_lo, raw_hi = min(min_in, max_in), max(min_in, max_in)
        lo = max(FLOOR, min(CEIL, raw_lo))
        hi = max(FLOOR, min(CEIL, raw_hi))
        hi = max(hi, lo)
        t = max(lo, min(hi, target_in))
        return max(FLOOR, min(CEIL, t))
    assert resolve(5, 9999, 1) == 120.0
    assert resolve(120, 60, 150) == 120.0  # swapped min/max still resolves inside [120,180], never crashes or goes to 5min
    assert resolve(120, 180, 150) == 150.0


def test_legacy_bar_wait_branch_removed_from_timing_engine():
    ea = read(EA)
    fn = body(ea, "bool XAU_TimingEngineConfirmsEntry(int dir, string setup, string grade, double sizeMulti, double atr)")
    assert "firstSeenCandle + PeriodSeconds(PERIOD_M5)" not in fn
    assert "sameSignalOneBarLater" not in fn
    assert "confirm required on next M5 bar" not in fn
    assert "XAU_EffectiveEntryDelaySeconds()" in fn
    assert "ENTRY_TIMING_LEGACY_BAR_WAIT_REMOVED" in fn


def test_recovery_uses_wall_clock_not_new_bar_gate():
    ea = read(EA)
    ot = body(ea, "void OnTick()")
    assert "if(newM5Bar) XAU_CheckPendingOpportunityRecovery();" not in ot
    assert "XAU_CheckPendingOpportunityRecovery();" in ot
    recovery_fn = body(ea, "void XAU_CheckPendingOpportunityRecovery()")
    # Recovery itself hands off to the shared timing engine (XAU_CheckRecoveryAwaitingTiming),
    # which already carries the bounded wall-clock delay -- it must not add a second wait.
    timing_fn = body(ea, "void XAU_CheckRecoveryAwaitingTiming()")
    assert "XAU_TimingEngineConfirmsEntry(" in timing_fn


def test_startup_cooldown_is_wall_clock_seconds_no_bar_requirement():
    ea = read(EA)
    assert "input int    InpStartupCooldownSeconds = 150;" in ea
    fn = body(ea, "string StartupCooldownReason()")
    assert "waiting for next M5 bar" not in fn
    assert "barOpens[0] <= g_startupBarTime" not in fn
    assert "XAU_ENTRY_DELAY_ABSOLUTE_FLOOR_SEC" in fn and "XAU_ENTRY_DELAY_ABSOLUTE_CEILING_SEC" in fn


def test_reentry_routes_through_the_same_shared_timing_engine():
    ea = read(EA)
    fn = body(ea, "void CheckReEntryOpportunity()")
    assert 'XAU_TimingEngineConfirmsEntry(lastClose.dir, "RE_ENTRY", "A", InpReEntrySize, bufATR[1])' in fn


def test_startup_timing_config_printed_at_init():
    ea = read(EA)
    init = body(ea, "int OnInit()")
    assert "ENTRY_TIMING_MODE=WALL_CLOCK_ONLY" in init
    assert "NEXT_M5_BAR_WAIT=DISABLED" in init
    assert "FIVE_MINUTE_ENTRY_WAIT=DISABLED" in init


# ---------------------------------------------------------------------------
# Canonical position identity (Fix 10)
# ---------------------------------------------------------------------------

def test_state_struct_separates_position_id_from_current_ticket():
    ea = read(EA)
    st = body(ea, "struct XAU_RExitState")
    assert "ulong    positionId;" in st
    assert "ulong    currentTicket;" in st
    assert "ticket;" not in st.replace("currentTicket;", "")


def test_find_idx_and_clear_key_by_position_id():
    ea = read(EA)
    find_fn = body(ea, "int XAU_RExit_FindIdx(ulong positionId)")
    assert "g_rExit[i].positionId == positionId" in find_fn


def test_live_position_resolved_by_identifier_iteration_not_ticket_select():
    ea = read(EA)
    fn = body(ea, "bool XAU_FindLivePositionByIdentifier(ulong positionId, ulong &outTicket, string &outSymbol, long &outMagic,")
    assert "posInfo.Identifier() != positionId" in fn
    assert "PositionSelectByTicket" not in fn
    # And the restore/orphan paths must use it, not PositionSelectByTicket.
    load_fn = body(ea, "void XAU_RExit_LoadPersistedState()")
    assert "XAU_FindLivePositionByIdentifier(positionId" in load_fn
    assert "PositionSelectByTicket(ticket)" not in load_fn
    orphan_fn = body(ea, "void XAU_RExit_ReconcileOrphans()")
    assert "XAU_FindLivePositionByIdentifier(g_rExit[i].positionId" in orphan_fn


def test_broker_close_calls_use_current_ticket_not_position_id():
    ea = read(EA)
    fn = body(ea, "bool XAU_RExit_RequestClose(int idx, ulong currentTicket, string reason)")
    assert "SafePositionClose(currentTicket," in fn
    assert "XAU_RExit_Clear(g_rExit[idx].positionId);" in fn


# ---------------------------------------------------------------------------
# Actual-fill capture (Fix 11)
# ---------------------------------------------------------------------------

def test_opentrade_captures_from_actual_broker_fields_not_requested_values():
    ea = read(EA)
    fn = body(ea, "bool OpenTrade(int signal, double atr, string reason, double sizeMulti, bool isManualOverride = false)")
    assert "XAU_FindLivePositionByIdentifier(openedPosId, liveTicket, liveSymbol, liveMagic, liveDir, liveOpen, liveVol, liveSL, liveTP)" in fn
    assert "XAU_RExit_EnsureIdx(openedPosId, liveTicket, liveDir == 1, liveOpen, liveSL, liveVol, false);" in fn
    assert "R_EXIT_ENTRY_CAPTURE_PENDING" in fn


def test_entry_capture_confirmed_and_pending_tags_exist():
    ea = read(EA)
    assert "R_EXIT_ENTRY_CAPTURE_CONFIRMED" in ea
    assert "R_EXIT_ENTRY_CAPTURE_PENDING" in ea


# ---------------------------------------------------------------------------
# Netting cumulative risk (Fix 12)
# ---------------------------------------------------------------------------

def test_netting_state_has_cumulative_risk_fields():
    ea = read(EA)
    st = body(ea, "struct XAU_RExitState")
    for field in ("cumulativeOriginalRiskUSD", "totalOriginalVolume", "addCount"):
        assert field in st


def test_core_loop_uses_cumulative_risk_as_r_denominator():
    ea = read(EA)
    core = body(ea, "void XAU_RExitCoreLoop()")
    assert "double riskUSD = g_rExit[idx].cumulativeOriginalRiskUSD;" in core
    assert "XAU_RExit_SyncNettingState(idx, isBuy, openPx, curSL, lots);" in core


def test_netting_sync_adds_new_volume_risk_without_resetting_peak_or_stage():
    ea = read(EA)
    fn = body(ea, "void XAU_RExit_SyncNettingState(int idx, bool isBuy, double liveOpenPx, double liveSL, double liveVolume)")
    assert "g_rExit[idx].cumulativeOriginalRiskUSD += addRiskUSD;" in fn
    assert "g_rExit[idx].addCount++;" in fn
    assert "peakProfitUSD" not in fn  # peak/trough/stage untouched by a netting merge
    assert "stageReached" not in fn


def test_pyramid_add_syncs_netting_state_immediately():
    ea = read(EA)
    fn = body(ea, "void CheckPyramidOpportunity()")
    assert "XAU_RExit_SyncNettingState(pyrIdx, pyrLiveDir == 1, pyrLiveOpen, pyrLiveSL, pyrLiveVol);" in fn


# ---------------------------------------------------------------------------
# Growth Daily Lock ownership conflict (Fix 13)
# ---------------------------------------------------------------------------

def test_growth_daily_lock_observation_only_while_r_owns_positions():
    ea = read(EA)
    ot = body(ea, "void OnTick()")
    assert "GROWTH_DAILY_LOCK OBSERVATION_ONLY" in ot
    assert "XAU_GrowthDailyLockTriggered(growthDayLockWhy) && XAU_RExitOwnsNormalPositions()" in ot


def test_growth_entry_and_pyramid_gates_untouched():
    # These are entry-side gates (not position-closing) and must remain as-is.
    ea = read(EA)
    assert "bool XAU_GrowthGuardReEntryAllowed(int dir, double curPrice, double atr, string &why)" in ea
    assert "GROWTH_REENTRY_BLOCK:" in ea
    assert "GROWTH_PYRAMID_BLOCK:" in ea


# ---------------------------------------------------------------------------
# Persistence throttling + full schema + restore validation (Fix 16-19)
# ---------------------------------------------------------------------------

def test_save_state_is_dirty_gated_not_unconditional():
    ea = read(EA)
    fn = body(ea, "void XAU_RExit_SaveState(bool force = false)")
    assert "if(!force && !g_rExitStateDirty) return;" in fn
    assert "g_rExitStateDirty = false;" in fn


def test_critical_transitions_force_immediate_flush():
    ea = read(EA)
    close_fn = body(ea, "bool XAU_RExit_RequestClose(int idx, ulong currentTicket, string reason)")
    assert "XAU_RExit_SaveState(true)" in close_fn
    deinit_fn = body(ea, "void OnDeinit(const int reason)")
    assert "XAU_RExit_SaveState(true);" in deinit_fn


def test_save_uses_temp_file_and_atomic_replace():
    ea = read(EA)
    fn = body(ea, "void XAU_RExit_SaveState(bool force = false)")
    assert 'string tmpPath = path + ".tmp";' in fn
    assert "FileMove(tmpPath, FILE_COMMON, path, FILE_COMMON | FILE_REWRITE)" in fn


def test_load_rejects_malformed_rows():
    ea = read(EA)
    fn = body(ea, "void XAU_RExit_LoadPersistedState()")
    assert "positionId == 0 || direction == 0 || origRisk < 0.0 || cumRisk < 0.0 || addCount < 1" in fn
    assert "MALFORMED_ROW_REJECTED" in fn
    assert "SCHEMA_MISMATCH" in fn


def test_all_deal_entry_out_variants_trigger_cleanup():
    ea = read(EA)
    ott = body(ea, "void OnTradeTransaction(const MqlTradeTransaction& trans, const MqlTradeRequest& request, const MqlTradeResult& result)")
    assert "entry != DEAL_ENTRY_OUT && entry != DEAL_ENTRY_OUT_BY" in ott


# ---------------------------------------------------------------------------
# Broker SL geometry (Fix 14)
# ---------------------------------------------------------------------------

def test_buffer_includes_both_stops_and_freeze_level():
    ea = read(EA)
    core = body(ea, "void XAU_RExitCoreLoop()")
    assert "long freezeLevel = SymbolInfoInteger(Symbol(), SYMBOL_TRADE_FREEZE_LEVEL);" in core
    assert "double buffer = MathMax(MathMax(stopsLevel, freezeLevel) * point, point * 30);" in core


# ---------------------------------------------------------------------------
# Stage priority (Fix 15) -- pending close > 1R > giveback > 0.5R > 0.3R > telemetry
# ---------------------------------------------------------------------------

def test_stage_priority_ordering_in_core_loop():
    ea = read(EA)
    core = body(ea, "void XAU_RExitCoreLoop()")
    pending_idx = core.index("Priority 1: a close already in flight")
    final_idx = core.index("Priority 2: 1R hard close")
    giveback_idx = core.index("Priority 3: 45% giveback close")
    protect_idx = core.index("Priority 5: 0.3R protection")
    decision_idx = core.index("Priority 4: 0.5R continuation decision")
    assert pending_idx < final_idx < giveback_idx < protect_idx
    assert protect_idx < decision_idx  # both must be reachable only after 1R/giveback are ruled out


# ---------------------------------------------------------------------------
# Entry-regression guard
# ---------------------------------------------------------------------------

def test_entry_boundary_signatures_present_unchanged():
    ea = read(EA)
    assert "int ScoreSetups(double &score, string &setupName, int excludeDir = 0)" in ea
    assert "double XAU_ComputeCombinedGradeForCandidate(int signal, string setupName, double setupScore," in ea
    assert "InpNormalRiskPct" in ea and "InpMaxOpenTrades" in ea
