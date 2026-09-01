"""Static source tests for v6.20.3 Commits A/B/C.

Commit A: telemetry completeness (structured quality fields, in-hold
checkpoints, OPEN/CLOSE reconciliation, version/build-hash on every row).
Commit B: XAU_AntiRepeatLossActive wired into the recovery path.
Commit C: cross-instance entry lock, and full removal of the immediateConfirm
delay bypass so the M5 entry delay applies to every grade with no exemption.

Per this repo's existing test convention (see test_xau_v6202_command_safety_static.py),
these are static/text-level checks against the .mq5 source, not runtime
execution -- MQL5 has no CI-runnable interpreter here, so the established
practice in this repo is to assert on function-body text.
"""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.20.3.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def mql_body(src: str, signature: str) -> str:
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


# --------------------------------------------------------------------------
# Commit A -- telemetry completeness
# --------------------------------------------------------------------------

def test_trade_brain_header_has_v6203_columns():
    ea = read(EA)
    fn = mql_body(ea, "void XAU_AppendTradeBrain(string eventName, TradeBrainOpen &r,")
    for col in ("eaVersion", "buildHash", "magicNumber", "setupQuality",
                "entryTimingQuality", "extensionRisk", "expectedMAERisk",
                "effectiveRRQuality", "finalCalibratedConfidence", "blockClass",
                "candlesSinceSignal", "missedMoveDistance", "missedMoveATR",
                "signalFirstSeenPrice"):
        assert f'"{col}"' in fn, f"missing new column {col} in trade-brain header"
    assert "XAUAI_EA_VERSION" in fn
    assert "XAUAI_BUILD_HASH" in fn
    assert "InpMagicNumber" in fn


def test_trade_brain_open_struct_has_quality_fields():
    ea = read(EA)
    struct_body = mql_body(ea, "struct TradeBrainOpen")
    for field in ("qualitySetup", "qualityTiming", "qualityExtensionRisk",
                  "qualityMAERisk", "qualityEffectiveRR", "qualityFinalConfidence",
                  "qualityBlockClass", "qualityCandlesSinceSignal",
                  "qualityMissedMoveDistance", "qualityMissedMoveATR",
                  "qualitySignalFirstSeenPrice", "checkpointNextIdx"):
        assert field in struct_body, f"TradeBrainOpen missing {field}"


def test_entry_quality_globals_are_captured_inside_timing_guard_not_a_new_signature():
    # Regression guard: the capture must be a side effect inside
    # XAUEntryTimingGuard (existing widely-called signature untouched), not a
    # new by-ref parameter that would require updating every call site.
    ea = read(EA)
    sig = "bool XAUEntryTimingGuard(int signal, string setupName, double setupScore, double combinedScore,\n                         string &grade, double &lotMulti, string &reason)"
    assert sig in ea, "XAUEntryTimingGuard signature must be unchanged"
    fn = mql_body(ea, "bool XAUEntryTimingGuard(int signal, string setupName, double setupScore, double combinedScore,")
    assert "g_lastEntryQ_SetupQuality       = setupQuality;" in fn
    assert "g_lastEntryQ_FinalConfidence    = finalCalibratedConfidence;" in fn
    assert "g_lastEntryQ_BlockClass = blockClass;" in fn


def test_reconciliation_runs_from_oninit():
    ea = read(EA)
    oninit = mql_body(ea, "int OnInit()")
    assert "XAU_ReconcileTradeBrainOnInit();" in oninit
    fn = mql_body(ea, "void XAU_ReconcileTradeBrainOnInit()")
    assert "PositionsTotal()" in fn
    assert "HistorySelect(lookbackFrom, TimeCurrent())" in fn
    assert "RECONCILED_AFTER_RESTART" in fn
    assert "RECONCILED_POST_RESTART" in fn


def test_has_close_row_scanner_does_not_use_fixed_column_skip():
    ea = read(EA)
    fn = mql_body(ea, "bool XAU_TradeBrainHasCloseRow(ulong posId)")
    # Must scan to end-of-line, not a hardcoded column count, since the
    # schema grew from 26 to 39 columns in this same release and older rows
    # in an existing file have fewer trailing fields.
    assert "FileIsLineEnding(h)" in fn
    assert "for(int c = 0; c <" not in fn


def test_in_hold_checkpoint_hooked_into_clean_exit_management():
    ea = read(EA)
    fn = mql_body(ea, "void XAU_CheckInHoldCheckpoint(ulong ticket, int minsOpen, double rMult, double floatingUSD, double peakUSD)")
    assert "g_checkpointMinutes" in fn
    assert '"CHECKPOINT"' in fn
    manage_sig = "bool ManageCleanExitsForPosition(ulong ticket, bool isBuy, double openPx, double curPrice,"
    manage_fn = mql_body(ea, manage_sig)
    assert "XAU_CheckInHoldCheckpoint(ticket, minsOpen, rMult, rMult * rDollars, peak);" in manage_fn


# --------------------------------------------------------------------------
# Commit B -- recovery guard wiring
# --------------------------------------------------------------------------

def test_recovery_path_consults_anti_repeat_loss_guard():
    ea = read(EA)
    fn = mql_body(ea, "void XAU_CheckPendingOpportunityRecovery()")
    assert "XAU_AntiRepeatLossActive(dir)" in fn
    assert "reason=ANTI_REPEAT_LOSS_ACTIVE" in fn
    # Must be checked before the ATR/fresh-data gate, i.e. early/fail-fast,
    # and must return without opening a trade.
    guard_idx = fn.index("XAU_AntiRepeatLossActive(dir)")
    atr_idx = fn.index("NO_FRESH_DATA")
    assert guard_idx < atr_idx


# --------------------------------------------------------------------------
# Commit C -- cross-instance entry lock
# --------------------------------------------------------------------------

def test_cross_instance_lock_keyed_by_symbol_magic_and_direction():
    ea = read(EA)
    fn = mql_body(ea, "string XAU_EntryLockGVKey(int dir)")
    assert "Symbol()" in fn
    assert "InpMagicNumber" in fn
    assert 'dir == 1 ? "BUY" : "SELL"' in fn


def test_open_trade_checks_lock_early_and_claims_atomically_right_before_send():
    ea = read(EA)
    fn = mql_body(ea, "bool OpenTrade(int signal, double atr, string reason, double sizeMulti, bool isManualOverride = false)")
    # Early, cheap fail-fast check (not yet the real claim).
    assert "XAU_CrossInstanceEntryLockActive(signal)" in fn
    assert "!isManualOverride && XAU_CrossInstanceEntryLockActive(signal)" in fn
    # The REAL atomic claim happens separately, right before the broker send
    # -- not immediately after the early check -- per the adversarial-review
    # fix: claiming too early left the lock phantom-held for the full window
    # even when a later hard gate (margin/risk/broker) rejected the trade.
    assert "XAU_TryClaimEntryLock(signal)" in fn
    lock_check_idx = fn.index("XAU_CrossInstanceEntryLockActive(signal)")
    backstop_idx = fn.index("XAU_ExhaustionReversalGuard(")
    claim_idx = fn.index("XAU_TryClaimEntryLock(signal)")
    send_idx = fn.index("trade.Buy(lots, Symbol()")
    # Ordering: early check < backstop < ... < atomic claim < broker send.
    assert lock_check_idx < backstop_idx < claim_idx < send_idx


def test_entry_lock_claim_uses_compare_and_swap_not_plain_get_then_set():
    ea = read(EA)
    fn = mql_body(ea, "bool XAU_TryClaimEntryLock(int dir)")
    assert "GlobalVariableSetOnCondition(" in fn


def test_entry_lock_respects_enable_toggle_and_window_input():
    ea = read(EA)
    assert "input bool   InpCrossInstanceEntryLockEnable" in ea
    assert "input int    InpCrossInstanceEntryLockSec" in ea
    active_fn = mql_body(ea, "bool XAU_CrossInstanceEntryLockActive(int dir)")
    assert "InpCrossInstanceEntryLockEnable" in active_fn
    assert "InpCrossInstanceEntryLockSec" in active_fn


# --------------------------------------------------------------------------
# Commit C (same-day follow-up) -- no grade may bypass the M5 entry delay
# --------------------------------------------------------------------------

def test_no_grade_can_take_a_zero_wait_bypass():
    ea = read(EA)
    fn = mql_body(ea, "bool XAU_TimingEngineConfirmsEntry(int dir, string setup, string grade, double sizeMulti, double atr)")
    # The old immediate-return bypass text must be gone entirely -- not
    # merely gated off, actually removed, so there is no dead branch that a
    # future edit could accidentally re-enable by flipping one condition.
    assert "IMMEDIATE_APLUS_MOMENTUM" not in fn
    assert "IMMEDIATE_CLEAN_EVIDENCE" not in fn
    assert 'ENTRY_ALLOWED (no wait' not in fn


def test_delay_duration_is_unconditional_for_every_grade():
    ea = read(EA)
    fn = mql_body(ea, "bool XAU_TimingEngineConfirmsEntry(int dir, string setup, string grade, double sizeMulti, double atr)")
    assert "double delaySec = XAU_EffectiveM5EntryDelaySec();" in fn
    # Must not be conditional on grade or immediateConfirm anywhere in this
    # function -- i.e. no ternary assigning a different (shorter) value to
    # delaySec based on tcls.immediateConfirm.
    assert "delaySec = (tcls.immediateConfirm" not in fn
    assert "InpM5EntryDelayMinSeconds\n                            : XAU_EffectiveM5EntryDelaySec()" not in fn


def test_first_signal_always_registers_a_pending_window_never_executes_same_tick():
    ea = read(EA)
    fn = mql_body(ea, "bool XAU_TimingEngineConfirmsEntry(int dir, string setup, string grade, double sizeMulti, double atr)")
    assert "g_pendingEntryConfirm.active          = true;" in fn
    assert "g_pendingEntryConfirm.firstSeenTime   = TimeCurrent();" in fn


def test_fallback_close_record_explicitly_initializes_new_fields():
    # Adversarial-review finding: OnTradeTransaction's "open record not
    # found" fallback branch set every pre-existing TradeBrainOpen field
    # explicitly except the 12 new ones, relying on implicit zero-init.
    ea = read(EA)
    idx = ea.index('brainRec.entryReason = "fallback: open record not found";')
    window = ea[idx:idx + 1200]
    for field in ("qualitySetup", "qualityTiming", "qualityBlockClass", "checkpointNextIdx"):
        assert f"brainRec.{field}" in window, f"fallback branch still relies on implicit init for {field}"


def test_entry_quality_globals_have_freshness_markers_and_are_gated_on_read():
    # Adversarial-review finding: recovery/force-open paths never call
    # XAUEntryTimingGuard, so without freshness tracking, XAU_BrainRecordOpen
    # would copy whichever signal's numbers happened to be sitting in the
    # globals -- possibly a rejected or opposite-direction signal.
    ea = read(EA)
    assert "int      g_lastEntryQ_Dir" in ea
    assert "string   g_lastEntryQ_Setup" in ea
    assert "datetime g_lastEntryQ_CapturedAt" in ea
    fn = mql_body(ea, "void XAU_BrainRecordOpen(ulong posId, int signal, double entryPrice, double sl, double tp,")
    assert "entryQFresh" in fn
    assert "g_lastEntryQ_Dir == signal" in fn
    assert "g_lastEntryQ_Setup == setupName" in fn


def test_checkpoint_restore_skips_already_elapsed_thresholds():
    # Adversarial-review finding: restoring a position after an EA reload
    # always set checkpointNextIdx=0 regardless of the position's real age,
    # so a 3-hour-old restored position fired all 8 CHECKPOINT rows at once
    # on the very next tick, each stamping current data against a past
    # minute-mark that had already elapsed.
    ea = read(EA)
    fn = mql_body(ea, "void XAU_ReconcileTradeBrainOnInit()")
    assert "elapsedMin" in fn
    assert "g_checkpointMinutes[ci] <= elapsedMin" in fn


def test_effective_delay_clamped_between_60_and_120_seconds_by_default():
    ea = read(EA)
    assert "input int    InpM5EntryDelaySeconds         = 90;" in ea
    assert "input int    InpM5EntryDelayMinSeconds      = 60;" in ea
    assert "input int    InpM5EntryDelayMaxSeconds      = 120;" in ea
    fn = mql_body(ea, "double XAU_EffectiveM5EntryDelaySec()")
    assert "InpM5EntryDelayMinSeconds" in fn and "InpM5EntryDelayMaxSeconds" in fn and "InpM5EntryDelaySeconds" in fn


def test_input_hash_includes_v6203_behavioral_controls():
    ea = read(EA)
    fn = mql_body(ea, "string XAUAI_InputHash()")
    for marker in (
        "InpUseM5EntryDelay",
        "InpM5EntryDelaySeconds",
        "InpM5EntryDelayMinSeconds",
        "InpM5EntryDelayMaxSeconds",
        "InpCancelIfPriceMovedTooFarATR",
        "InpCrossInstanceEntryLockEnable",
        "InpCrossInstanceEntryLockSec",
        "InpExitArmMinOwnR",
    ):
        assert marker in fn, f"XAUAI_InputHash missing {marker}"
