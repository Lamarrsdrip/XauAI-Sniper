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


FN_SIG = "void XAU_CreateReentryState(bool wasSLHitExact)"


# XauCloud final-production audit finding XC-002: InpMaxReEntriesPerDay
# ("Hard cap on re-entries per trading day", default 1) was declared and
# documented (log line at REENTRY_STATE_CREATED / the setup-print banner)
# but was never actually compared against todayReEntryCount anywhere in
# the file -- a re-entry state could be armed and executed an unlimited
# number of times per day despite the documented "hard cap". Root-cause
# fix: XAU_CreateReentryState now refuses to arm g_reentryState when the
# daily count has already been reached, before InpUseReEntry/wasLoss ever
# lets execution proceed. This does not add a new owner restriction --
# InpMaxReEntriesPerDay already existed and was already documented as a
# hard cap; this makes the code honor the input it already exposes.
#
# Adversarial-review follow-up: the first version of this fix read
# todayReEntryCount without accounting for the fact that its authoritative
# daily reset lives in UpdateDrawdownState(), which is called AFTER
# XAU_CreateReentryState() on the same close event (position-close
# handler: XAU_CreateReentryState then RecordCloseForStreak then
# UpdateDrawdownState). That meant the first close of a new day would read
# yesterday's stale count and wrongly block a legitimate re-entry. Fixed
# by re-deriving the day boundary inline (reading todayLossResetDay
# read-only) before the cap comparison, without taking over ownership of
# writing todayLossResetDay itself.


def test_root_and_backend_copies_synced():
    assert read(EA) == read(BACKEND_EA)


def test_exactly_one_canonical_create_reentry_state_function():
    ea = read(EA)
    assert ea.count(FN_SIG) == 1


def test_daily_cap_is_enforced_before_arming_reentry_state():
    ea = read(EA)
    fn = find_function(ea, FN_SIG)
    assert "if(todayReEntryCount >= InpMaxReEntriesPerDay)" in fn
    cap_idx = fn.index("if(todayReEntryCount >= InpMaxReEntriesPerDay)")
    arm_idx = fn.index("g_reentryState.active = true;")
    assert cap_idx < arm_idx, "daily cap check must run before the re-entry state is armed"


def test_daily_cap_block_returns_without_arming_state():
    ea = read(EA)
    fn = find_function(ea, FN_SIG)
    idx = fn.index("if(todayReEntryCount >= InpMaxReEntriesPerDay)")
    window = fn[idx: idx + 320]
    assert "return;" in window
    assert "REENTRY_BLOCKED_DAILY_CAP" in window


def test_daily_cap_check_runs_after_use_reentry_and_was_loss_gate():
    ea = read(EA)
    fn = find_function(ea, FN_SIG)
    gate_idx = fn.index("if(!InpUseReEntry || !lastClose.wasLoss)")
    cap_idx = fn.index("if(todayReEntryCount >= InpMaxReEntriesPerDay)")
    assert gate_idx < cap_idx


def test_day_boundary_rederived_before_cap_check_reads_stale_count():
    ea = read(EA)
    fn = find_function(ea, FN_SIG)
    # the day-boundary re-derivation must run, and reset the counter, BEFORE
    # the cap comparison -- otherwise the first close of a new day reads
    # yesterday's stale todayReEntryCount and false-blocks a legitimate
    # re-entry (the exact bug an adversarial review caught in the first cut
    # of this fix).
    assert "TimeToStruct(todayLossResetDay, dtLastReentry);" in fn
    rederive_idx = fn.index("TimeToStruct(todayLossResetDay, dtLastReentry);")
    reset_idx = fn.index("todayReEntryCount = 0;", rederive_idx)
    cap_idx = fn.index("if(todayReEntryCount >= InpMaxReEntriesPerDay)")
    assert rederive_idx < reset_idx < cap_idx


def test_day_boundary_rederivation_does_not_write_todayLossResetDay():
    ea = read(EA)
    fn = find_function(ea, FN_SIG)
    # UpdateDrawdownState() remains the sole owner of the authoritative
    # todayLossResetDay field -- this function may only read it.
    assert "todayLossResetDay =" not in fn
    assert "todayLossResetDay=" not in fn


def test_input_and_counter_untouched_by_this_fix():
    ea = read(EA)
    # sanity: this is an enforcement fix, not a new restriction -- the
    # input default and reset/increment sites are unchanged
    assert "input int    InpMaxReEntriesPerDay = 1;" in ea
    assert "todayReEntryCount = 0;" in ea
    assert "todayReEntryCount++;" in ea


if __name__ == "__main__":
    import sys
    import pytest
    sys.exit(pytest.main([__file__, "-q"]))
