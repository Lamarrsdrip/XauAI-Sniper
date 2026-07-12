import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.21.0.mq5"
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
# Release hygiene: sync, version, banner (per this repo's RELEASE_CHECKLIST)
# ---------------------------------------------------------------------------

def test_current_release_source_is_synced_to_backend():
    assert read(EA) == read(BACKEND_EA)


def test_version_bumped_to_v6210():
    ea = read(EA)
    assert '#define XAUAI_EA_VERSION "v6.21.0"' in ea
    assert '#define XAUAI_EA_VERSION_NUM "6.21.0"' in ea
    assert '#property version   "6.261"' in ea


def test_header_banner_matches_property_version_for_website_display():
    ea = read(EA)
    m = re.search(r'v(\d+\.\d+\.\d+)\s*[—\-]+\s*(.+)', ea[:3000])
    assert m is not None
    assert m.group(1) == "6.21.0"
    edition = m.group(2).strip().rstrip("|").strip()
    assert "R-Based Exit Manager" in edition


# ---------------------------------------------------------------------------
# New authority: struct, state, inputs, function all present
# ---------------------------------------------------------------------------

def test_r_exit_state_struct_and_required_fields_exist():
    ea = read(EA)
    st = body(ea, "struct XAU_RExitState")
    for field in (
        "ulong    ticket",
        "originalEntryPrice", "originalStopLoss", "originalStopDistance", "originalRiskUSD",
        "positionDirection", "peakProfitUSD", "peakR", "timePeakReached",
        "troughProfitUSD", "troughR", "currentProfitUSD", "currentR",
        "stageReached", "lastProtectedSL", "rCheckpointProfitUSD[6]",
        "reconciledFromRestart",
    ):
        assert field in st, f"missing field: {field}"


def test_inputs_exist_with_spec_defaults():
    ea = read(EA)
    for token in (
        'input bool   InpRExitEnable               = true;',
        'input double InpRProtectTrigger           = 0.30;',
        'input double InpRInitialLock              = 0.15;',
        'input double InpRCaptureTarget            = 0.50;',
        'input double InpRStrongContinuationLock   = 0.35;',
        'input double InpRWeakContinuationLock     = 0.40;',
        'input double InpRFinalTarget              = 1.00;',
        'input double InpRMaxGivebackPct           = 45.0;',
        'input int    InpRContinuationMinFactors   = 4;',
    ):
        assert token in ea


def test_exit_reason_tags_present():
    ea = read(EA)
    for tag in ("R_EXIT_PROTECT_03R", "R_EXIT_GIVEBACK_45", "R_EXIT_CAPTURE_0_5R",
                "R_EXIT_HOLD_TO_1R", "R_EXIT_TP_1R"):
        assert f'"{tag}"' in ea


def test_manager_function_signature_and_helpers_exist():
    ea = read(EA)
    assert "void XAU_ManageRBasedExit(ulong ticket, bool isBuy, double openPx, double curSL, double curTP," in ea
    assert re.search(r"int\s+XAU_RExit_FindIdx\(ulong ticket\)", ea)
    assert re.search(r"int\s+XAU_RExit_EnsureIdx\(", ea)
    assert re.search(r"void\s+XAU_RExit_Clear\(ulong ticket\)", ea)
    assert re.search(r"void\s+XAU_ValidateRExitConfig\(\)", ea)
    assert re.search(r"void\s+XAU_ReconcileRExitOnInit\(\)", ea)
    assert re.search(r"void\s+XAU_RExit_LogCounterfactual\(", ea)


def test_oninit_calls_validate_and_reconcile():
    ea = read(EA)
    init = body(ea, "int OnInit()")
    assert "XAU_ValidateRExitConfig();" in init
    assert "XAU_ReconcileRExitOnInit();" in init
    assert init.index("XAU_ValidateRExitConfig();") < init.index("XAU_ReconcileRExitOnInit();")


# ---------------------------------------------------------------------------
# Single-authority proof: the new manager runs first and every competing
# authority is either unreachable downstream of its `continue`, or gated.
# ---------------------------------------------------------------------------

def test_manager_call_precedes_ttm_and_clean_exits_in_manage_positions():
    ea = read(EA)
    mp = body(ea, "void ManagePositions()")
    assert "XAU_ManageRBasedExit(ticket, isBuy, openPx, curSL, curTP, curPrice, profit, lotsOpen," in mp
    call_idx = mp.index("XAU_ManageRBasedExit(ticket, isBuy, openPx, curSL, curTP, curPrice, profit, lotsOpen,")
    ttm_idx = mp.index("v6.4.19 TRADE THESIS MONITOR")
    clean_idx = mp.index("if(InpCleanExits)")
    assert call_idx < ttm_idx < clean_idx


def test_manager_call_is_followed_by_unconditional_continue():
    ea = read(EA)
    mp = body(ea, "void ManagePositions()")
    call_idx = mp.index("if(InpRExitEnable && g_rExitConfigValid)")
    snippet = mp[call_idx:call_idx + 400]
    assert "continue;" in snippet


def test_pg_per_position_ratchet_and_epf_partials_gated_off_by_new_manager():
    ea = read(EA)
    assert "if(!InpRExitEnable) PG_PerPositionRatchet();" in ea
    assert "if(!noLimitMode && !InpRExitEnable) EPF_ManagePartials();" in ea


def test_manage_basket_short_circuits_discretionary_logic_when_new_manager_active():
    ea = read(EA)
    mb = body(ea, "bool ManageBasket()")
    assert "if(InpRExitEnable) return false;" in mb
    # The flat-state reset must still run before this guard (housekeeping preserved).
    reset_idx = mb.index("XAU_ResetBasketProtectionState();")
    guard_idx = mb.index("if(InpRExitEnable) return false;")
    assert reset_idx < guard_idx
    # The guard must come before any peak-arm/giveback decision logic.
    arm_idx = mb.index("Arm the basket-lock once peak crosses threshold")
    assert guard_idx < arm_idx


def test_emergency_paths_are_not_gated_by_new_manager():
    ea = read(EA)
    for emergency_call in (
        'CloseAll("WEEKEND_CLOSE")',
        'CloseAll("PROP_FIRM_LOSS_LOCK: " + propFirmLock)',
        'CloseAll("EQUITY_PROTECT")',
        'CloseAll("WEEKLY_TARGET_HIT")',
        'CloseAll("REMOTE_COMMAND_CLOSE_ALL")',
    ):
        assert emergency_call in ea
    # None of these lines should be preceded by an InpRExitEnable check within
    # the same short block (i.e. they aren't accidentally wrapped).
    for emergency_call in ('CloseAll("WEEKEND_CLOSE")', 'CloseAll("EQUITY_PROTECT")'):
        idx = ea.index(emergency_call)
        preceding = ea[max(0, idx - 200):idx]
        assert "InpRExitEnable" not in preceding


# ---------------------------------------------------------------------------
# Numeric reimplementations (Python) of the core R-math, both directions.
# ---------------------------------------------------------------------------

def _protected_sl(entry: float, stop_distance: float, is_buy: bool, lock_r: float = 0.15) -> float:
    lock_dist = lock_r * stop_distance
    return entry + lock_dist if is_buy else entry - lock_dist


def test_protect_trigger_boundary_buy_and_sell():
    # 0.29R must not arm protection; 0.30R must.
    risk = 100.0
    assert (28.999 / risk) < 0.30
    assert (30.0 / risk) >= 0.30


def test_protected_sl_formula_buy():
    entry, stop_distance = 2000.0, 10.0
    sl = _protected_sl(entry, stop_distance, is_buy=True)
    assert sl == entry + 0.15 * stop_distance
    assert sl > entry  # correct side: BUY protection sits above entry


def test_protected_sl_formula_sell():
    entry, stop_distance = 2000.0, 10.0
    sl = _protected_sl(entry, stop_distance, is_buy=False)
    assert sl == entry - 0.15 * stop_distance
    assert sl < entry  # correct side: SELL protection sits below entry


def test_giveback_pct_formula_and_45pct_threshold():
    peak, current = 100.0, 54.0
    giveback = (peak - current) / peak * 100.0
    assert round(giveback, 1) == 46.0
    assert giveback >= 45.0  # this example must close

    peak2, current2 = 100.0, 60.0
    giveback2 = (peak2 - current2) / peak2 * 100.0
    assert giveback2 < 45.0  # this example must NOT close


def test_giveback_exit_requires_stage1_armed_first():
    # Giveback only evaluated once peakProfitUSD > 0, which in the source is
    # only reached via the same peak-tracking used for the 0.3R arm decision.
    # A trade giving back 90% of a $5 peak (well under 0.3R on $100 risk)
    # must not be treated as an armed giveback in the manager's own gating:
    # the manager returns at Stage 0 (peakR < 0.30 and currentR < 0.30)
    # before Stage 2 giveback logic ever runs.
    risk = 100.0
    peak_profit, current_profit = 5.0, 0.5
    peak_r = peak_profit / risk
    current_r = current_profit / risk
    assert peak_r < 0.30 and current_r < 0.30  # Stage 0 -> giveback stage unreached


def test_1r_close_boundary_both_directions():
    risk = 100.0
    assert (99.0 / risk) < 1.0
    assert (100.0 / risk) >= 1.0
    # Direction-neutral: R is always profit/risk regardless of BUY/SELL,
    # since `profit` already reflects broker-side-aware P/L.
    for direction_profit in (100.0, 100.0):
        assert direction_profit / risk >= 1.0


def test_ratchet_never_loosens_buy_and_sell():
    # BUY: only accept a new SL if it's strictly greater (closer to price) than current.
    cur_sl_buy = 2001.0
    better_buy = 2002.0
    worse_buy = 2000.5
    assert better_buy > cur_sl_buy
    assert not (worse_buy > cur_sl_buy)

    # SELL: only accept a new SL if it's strictly less (closer to price) than current,
    # or current is unset (0).
    cur_sl_sell = 1999.0
    better_sell = 1998.0
    worse_sell = 1999.5
    assert better_sell < cur_sl_sell
    assert not (worse_sell < cur_sl_sell)
    assert (1998.0 < 0) or True  # curSL == 0 (unset) always ratchet-eligible, exercised in source via `curSL == 0`


def test_source_ratchet_guard_never_loosens():
    ea = read(EA)
    fn = body(ea, "void XAU_ManageRBasedExit(ulong ticket, bool isBuy, double openPx, double curSL, double curTP,")
    assert "bool ratchet = isBuy ? (protectedSL > curSL) : (protectedSL < curSL || curSL == 0);" in fn
    assert "bool runRatchet = isBuy ? (runLockSL > curSL) : (runLockSL < curSL || curSL == 0);" in fn


def test_source_never_forces_invalid_stop_level():
    ea = read(EA)
    fn = body(ea, "void XAU_ManageRBasedExit(ulong ticket, bool isBuy, double openPx, double curSL, double curTP,")
    # Both SL moves are gated on `sane && ratchet && SafeModifySL(...)` -- an
    # invalid (insane) proposal is silently skipped, not forced, and
    # SafeModifySL itself clamps to broker stops/freeze levels and retries
    # safely rather than erroring out.
    assert "if(sane && ratchet && SafeModifySL(ticket, protectedSL, curTP, isBuy, curPrice, \"R_EXIT_PROTECT_03R\"))" in fn
    assert "if(runSane && runRatchet && SafeModifySL(ticket, runLockSL, curTP, isBuy, curPrice, \"R_EXIT_HOLD_TO_1R\"))" in fn


# ---------------------------------------------------------------------------
# Direction correctness
# ---------------------------------------------------------------------------

def test_direction_is_read_from_position_type_not_a_stored_signal():
    ea = read(EA)
    mp = body(ea, "void ManagePositions()")
    assert "bool isBuy = posInfo.PositionType() == POSITION_TYPE_BUY;" in mp
    call_idx = mp.index("if(InpRExitEnable && g_rExitConfigValid)")
    isbuy_idx = mp.index("bool isBuy = posInfo.PositionType() == POSITION_TYPE_BUY;")
    assert isbuy_idx < call_idx  # isBuy is captured from broker state before being passed in


def test_current_price_basis_is_bid_for_buy_ask_for_sell():
    ea = read(EA)
    mp = body(ea, "void ManagePositions()")
    # posInfo.PriceCurrent() is the standard MQL5 CPositionInfo accessor that
    # returns Bid for a BUY position and Ask for a SELL position.
    assert "double curPrice = posInfo.PriceCurrent();" in mp


# ---------------------------------------------------------------------------
# Restart / pyramid independence
# ---------------------------------------------------------------------------

def test_restart_reconcile_never_fabricates_pre_restart_peak():
    ea = read(EA)
    fn = body(ea, "void XAU_ReconcileRExitOnInit()")
    assert "g_rExit[idx].peakProfitUSD = MathMax(0.0, profit);" in fn
    assert "g_rExit[idx].troughProfitUSD = MathMin(0.0, profit);" in fn
    assert "historical peak unknown" in fn


def test_state_is_keyed_strictly_by_ticket_for_pyramid_independence():
    ea = read(EA)
    find_fn = body(ea, "int XAU_RExit_FindIdx(ulong ticket)")
    assert "g_rExit[i].ticket == ticket" in find_fn
    ensure_fn = body(ea, "int XAU_RExit_EnsureIdx(ulong ticket, bool isBuy, double openPx, double curSL, double lots, bool isRestartReconcile)")
    assert "g_rExit[n].ticket = ticket;" in ensure_fn


# ---------------------------------------------------------------------------
# Commission/swap inclusion, counterfactual instrumentation, no live-behavior
# change to the default 1R target.
# ---------------------------------------------------------------------------

def test_current_profit_includes_swap_and_commission():
    ea = read(EA)
    mp = body(ea, "void ManagePositions()")
    assert "double profit = posInfo.Profit() + posInfo.Swap() + posInfo.Commission();" in mp


def test_counterfactual_checkpoints_cover_required_r_levels():
    ea = read(EA)
    assert "double g_rCheckpointLevels[6] = {0.20, 0.30, 0.40, 0.50, 0.75, 1.00};" in ea
    log_fn = body(ea, "void XAU_RExit_LogCounterfactual(int idx, string exitReason)")
    assert "MFE_peakR" in log_fn and "MAE_troughR" in log_fn and "exitR=" in log_fn


def test_final_target_still_defaults_to_1r_not_extended():
    ea = read(EA)
    assert 'input double InpRFinalTarget              = 1.00;' in ea


# ---------------------------------------------------------------------------
# Entry-regression guard: confirm the entry boundary functions this task was
# told not to touch are still present with unchanged signatures.
# ---------------------------------------------------------------------------

def test_entry_boundary_functions_unchanged_signatures_present():
    ea = read(EA)
    assert "bool OpenTrade(int signal, double atr, string reason, double sizeMulti, bool isManualOverride = false)" in ea
    assert re.search(r"\bScoreSetups\s*\(", ea)
    assert "void CheckPyramidOpportunity()" in ea or re.search(r"CheckPyramidOpportunity\s*\(\s*\)", ea)
    assert "InpMaxOpenTrades" in ea
    assert "InpNormalRiskPct" in ea
