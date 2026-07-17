from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def find_function(ea: str, signature: str) -> str:
    start = ea.index(signature)
    open_idx = ea.index("{", start)
    depth = 0
    i = open_idx
    while i < len(ea):
        if ea[i] == "{":
            depth += 1
        elif ea[i] == "}":
            depth -= 1
            if depth == 0:
                return ea[start:i + 1]
        i += 1
    raise AssertionError(f"unbalanced braces for {signature}")


def test_root_and_backend_copies_synced():
    assert read(EA) == read(BACKEND_EA)


# ---------------------------------------------------------------------------
# incident: positionId=2972357360 orphaned on a single miss while still live
# ---------------------------------------------------------------------------
def test_debounce_thresholds_defined_and_require_more_than_one_miss():
    ea = read(EA)
    assert "#define XAU_REXIT_ORPHAN_MIN_MISSES  3" in ea
    assert "#define XAU_REXIT_ORPHAN_MIN_SECONDS 15" in ea


def test_struct_has_debounce_fields():
    ea = read(EA)
    struct = find_function(ea, "struct XAU_RExitState")
    assert "int      notFoundStreak;" in struct
    assert "datetime firstNotFoundAt;" in struct


def test_connectivity_guard_before_any_orphan_logic():
    ea = read(EA)
    fn = find_function(ea, "void XAU_RExit_ReconcileOrphans()")
    guard_idx = fn.index("!TerminalInfoInteger(TERMINAL_CONNECTED)")
    loop_idx = fn.index("for(int i = ArraySize(g_rExit) - 1; i >= 0; i--)")
    assert guard_idx < loop_idx, "connectivity guard must run before the reconciliation loop"
    assert "return;" in fn[guard_idx:loop_idx]


def test_single_miss_does_not_purge_state():
    ea = read(EA)
    fn = find_function(ea, "void XAU_RExit_ReconcileOrphans()")
    # the debounce check must `continue` (skip purge) whenever thresholds
    # are not yet satisfied
    idx = fn.index("if(g_rExit[i].notFoundStreak < XAU_REXIT_ORPHAN_MIN_MISSES || elapsedSec < XAU_REXIT_ORPHAN_MIN_SECONDS)")
    window = fn[idx: idx + 600]
    assert "ORPHAN_SUSPECTED" in window
    assert "continue;" in window
    # and the purge branch (ORPHAN_CLEANUP) must appear strictly AFTER the
    # debounce gate, never before it
    purge_idx = fn.index('PrintFormat("R_EXIT_MANAGER ORPHAN_CLEANUP')
    assert idx < purge_idx


def test_found_position_resets_debounce_streak():
    ea = read(EA)
    fn = find_function(ea, "void XAU_RExit_ReconcileOrphans()")
    found_branch = fn[fn.index("if(XAU_FindLivePositionByIdentifier("): fn.index("if(XAU_FindLivePositionByIdentifier(") + 300]
    assert "g_rExit[i].notFoundStreak  = 0;" in found_branch
    assert "g_rExit[i].firstNotFoundAt = 0;" in found_branch


def test_history_confirmation_function_exists_and_checks_position_id():
    ea = read(EA)
    fn = find_function(ea, "bool XAU_HistoryConfirmsPositionClosed(ulong positionId)")
    assert "DEAL_POSITION_ID" in fn
    assert "DEAL_ENTRY_OUT" in fn
    assert "HistorySelect(" in fn


def test_orphan_cleanup_calls_history_confirmation_before_purge():
    ea = read(EA)
    fn = find_function(ea, "void XAU_RExit_ReconcileOrphans()")
    idx = fn.index("bool historyConfirms = XAU_HistoryConfirmsPositionClosed(g_rExit[i].positionId);")
    purge_idx = fn.index("ArrayResize(g_rExit, last);")
    assert idx < purge_idx


def test_suspicious_no_history_match_is_distinctly_logged():
    ea = read(EA)
    fn = find_function(ea, "void XAU_RExit_ReconcileOrphans()")
    assert "ORPHAN_CLEANUP_NO_HISTORY_MATCH_SUSPICIOUS" in fn
    assert "ORPHAN_CLEANUP_HISTORY_CONFIRMED_CLOSE" in fn
    assert "SUSPICIOUS: no matching close deal" in fn


# ---------------------------------------------------------------------------
# continuous self-healing re-adoption (the actual gap that left the incident
# position unprotected indefinitely once orphaned)
# ---------------------------------------------------------------------------
def test_reconcile_untracked_positions_function_exists_and_is_throttled():
    ea = read(EA)
    fn = find_function(ea, "void XAU_RExit_ReconcileUntrackedLivePositions()")
    assert "static datetime lastRun = 0;" in fn
    assert "TimeCurrent() - lastRun < 10" in fn
    assert "XAU_ReconcileRExitOnInit();" in fn


def test_reconcile_orphans_always_calls_self_heal_not_just_on_purge():
    ea = read(EA)
    fn = find_function(ea, "void XAU_RExit_ReconcileOrphans()")
    # must be the LAST statement in the function, outside the per-ticket
    # loop, so it runs every call regardless of whether anything was purged
    assert fn.rstrip().endswith("XAU_RExit_ReconcileUntrackedLivePositions();\n}") or \
        "XAU_RExit_ReconcileUntrackedLivePositions();" in fn[fn.rindex("}", 0, len(fn) - 1) - 500:]


def test_recovered_position_logs_distinctly_from_a_restart():
    ea = read(EA)
    fn = find_function(ea, "void XAU_RExit_ReconcileUntrackedLivePositions()")
    assert "R_EXIT_MANAGER_RECOVERED_UNTRACKED_POSITION" in fn
    assert "self-heal, not a restart" in fn


def test_ensure_idx_is_a_noop_for_already_tracked_position_so_self_heal_is_safe():
    ea = read(EA)
    fn = find_function(ea, "int XAU_RExit_EnsureIdx(ulong positionId, ulong currentTicket, bool isBuy, double openPx, double curSL, double lots, bool isRestartReconcile)")
    idx = fn.index("if(idx >= 0)")
    window = fn[idx: idx + 200]
    assert "return idx;" in window
    # must NOT reset peak/trough/stage for an already-tracked position
    assert "peakProfitUSD = 0" not in window
    assert "stageReached = " not in window


if __name__ == "__main__":
    import sys
    import pytest
    sys.exit(pytest.main([__file__, "-q"]))
