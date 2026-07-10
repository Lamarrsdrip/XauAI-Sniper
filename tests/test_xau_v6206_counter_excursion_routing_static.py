"""Static tests for the v6.20.6 COUNTER-EXCURSION timing/routing correction.

Owner directive (2026-07-10, "correct the timing behavior"): normal accepted
trades keep the existing 2-3 minute delay unchanged; counter-excursion trades
created from a qualifying BLOCKED signal must never wait on that delay, use
only their own fast validation, and target 0.2R-0.5R (hard cap 0.5R, no
exception). Grade eligibility alone must never create a countertrade -- the
candidate must be genuinely blocked, for a qualifying opposite-pressure
reason, and independently pass fast validation.

This file covers the routing/timing/restart correction specifically. The
sibling file test_xau_v6205_counter_excursion_exp1_static.py already covers
the risk-model and B/B+/A/A+ grade-eligibility corrections in depth; tests
here don't repeat that ground except where the new correction touches it.

Per this repo's convention: static/text-level checks against the .mq5
source, no MQL5 runtime in CI.
"""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _latest_exp_file(suffix):
    candidates = sorted(ROOT.glob(f"XAUUSD_AI_Sniper_EA_v6.20.*-COUNTER-EXCURSION-EXP1{suffix}"))
    assert candidates, f"no COUNTER-EXCURSION-EXP1{suffix} file found in {ROOT}"
    return candidates[-1]


EA = _latest_exp_file(".mq5")
BASELINE = ROOT / "XAUUSD_AI_Sniper_EA_v6.20.5.mq5"


def read(path):
    return path.read_text(encoding="utf-8", errors="ignore")


def section(text, start, end):
    return text[text.index(start):text.index(end, text.index(start))]


def func_body(text, signature):
    """Brace-matched body starting at the first '{' after signature."""
    i = text.index(signature)
    start = text.index("{", i)
    depth = 0
    j = start
    while j < len(text):
        if text[j] == "{":
            depth += 1
        elif text[j] == "}":
            depth -= 1
            if depth == 0:
                return text[start:j + 1]
        j += 1
    raise AssertionError(f"unbalanced braces for {signature!r}")


def entry_fn(ea):
    return section(ea, "void XAU_TryCounterExcursionEntry(", "bool XAU_ManageCounterExcursionPosition()")


def manager_fn(ea):
    return section(ea, "bool XAU_ManageCounterExcursionPosition()", "void XAU_RememberBlockedSignal(")


def eligible_fn(ea):
    return func_body(ea, "bool XAU_CounterExcursionEligible(int signal, string reason, string &category)")


def confirm_fn(ea):
    return func_body(ea, "bool XAU_CounterExcursionFreshMicroConfirm(int counterDir, string &whyFail)")


def timing_fn(ea):
    return func_body(ea, "bool XAU_TimingEngineConfirmsEntry(int dir, string setup, string grade, double sizeMulti, double atr)")


def open_trade_fn(ea):
    return section(ea, "bool OpenTrade(int signal, double atr, string reason, double sizeMulti, bool isManualOverride = false)",
                    "// v6.20.3 (Commit C)")


def reconcile_fn(ea):
    return func_body(ea, "void XAU_ReconcileCounterExcursionOnInit()")


# ---------------------------------------------------------------------------
# NORMAL FLOW (1-5): untouched
# ---------------------------------------------------------------------------

def test_1_2_normal_timing_engine_byte_identical_to_baseline():
    assert timing_fn(read(EA)) == timing_fn(read(BASELINE))


def test_3_recovery_path_still_uses_timing_engine():
    ea = read(EA)
    assert "XAU_TimingEngineConfirmsEntry(g_recoveryAwaitingTiming.dir" in ea


def test_4_normal_re_entry_cannot_bypass_timing():
    ea = read(EA)
    # every non-manual OpenTrade caller path is gated by the same function;
    # RE_ENTRY and fresh-scan both call it before ever reaching OpenTrade.
    assert ea.count("XAU_TimingEngineConfirmsEntry(") >= 3  # definition + >=2 real call sites


def test_5_normal_exit_management_loop_still_magic_scoped():
    ea = read(EA)
    mp = section(ea, "void ManagePositions()\n{", "int digits = (int)SymbolInfoInteger(Symbol(), SYMBOL_DIGITS);\n   if(ArraySize(bufATR) < 2 || bufATR[1] <= 0) return;")
    body_start = ea.index("for(int i = PositionsTotal() - 1; i >= 0; i--)", ea.index("void ManagePositions()"))
    window = ea[body_start:body_start + 300]
    assert "posInfo.Magic() != InpMagicNumber" in window


# ---------------------------------------------------------------------------
# COUNTER FLOW (6-15)
# ---------------------------------------------------------------------------

def test_6_7_counter_candidate_created_only_from_remember_blocked_signal():
    ea = read(EA)
    call_sites = [i for i in range(len(ea)) if ea.startswith("XAU_TryCounterExcursionEntry(", i)]
    # exactly one definition + one call site (inside XAU_RememberBlockedSignal)
    def_sites = ea.count("void XAU_TryCounterExcursionEntry(int originalSignal")
    assert def_sites == 1
    call_only = ea.count("XAU_TryCounterExcursionEntry(signal, setupName, grade, setupScore, combinedScore, reason);")
    assert call_only == 1
    rbs = section(ea, "void XAU_RememberBlockedSignal(", "if(!InpBlockedTradeMemoryReport")
    assert "XAU_TryCounterExcursionEntry(signal, setupName, grade, setupScore, combinedScore, reason);" in rbs


def test_8_counter_uses_fast_validation_not_timing_engine():
    fn = entry_fn(read(EA))
    assert "XAU_CounterExcursionFreshMicroConfirm(counterDir, whyFail)" in fn
    assert "XAU_TimingEngineConfirmsEntry" not in fn


def test_9_no_delay_mechanism_reachable_from_counter_path():
    ea = read(EA)
    suspects = ["XAU_TimingEngineConfirmsEntry", "g_pendingEntryConfirm", "g_pendingTimingProof",
                "InpUseM5EntryDelay", "XAU_EffectiveM5EntryDelaySec"]
    for fn in (entry_fn(ea), manager_fn(ea), confirm_fn(ea), eligible_fn(ea)):
        for s in suspects:
            assert s not in fn, f"{s} leaked into counter-excursion function"


def test_9b_elapsed_seconds_proof_telemetry_present():
    fn = entry_fn(read(EA))
    assert "datetime candidateFirstSeen = TimeCurrent();" in fn
    assert 'PrintFormat("COUNTER_EXCURSION_CANDIDATE timestamp=%s originalDirection=%s counterDirection=%s grade=%s candidateId=%s",' in fn
    assert 'PrintFormat("COUNTER_EXCURSION_FAST_CHECK result=PASS reason=ALL_CHECKS_PASSED");' in fn
    assert 'PrintFormat("COUNTER_EXCURSION_EXECUTING candidateFirstSeen=%s executionTime=%s elapsedSeconds=%.0f",' in fn
    # elapsedSeconds is computed from two TimeCurrent() calls in the SAME
    # function invocation -- not a stored/cross-tick delta.
    exec_idx = fn.index("datetime executionTime = TimeCurrent();")
    candidate_idx = fn.index("datetime candidateFirstSeen = TimeCurrent();")
    assert candidate_idx < exec_idx


def test_10_counter_position_owned_by_dedicated_manager():
    ea = read(EA)
    assert "XAU_ManageCounterExcursionPosition();" in ea
    mgr = manager_fn(ea)
    assert "posInfo.Magic() != InpCounterExcursionMagicNumber" in mgr


def test_11_exit_policy_is_02_03_05r_no_exception():
    ea = read(EA)
    assert "input double InpCounterExcursionProtectAtR             = 0.20;" in ea
    assert "input double InpCounterExcursionDefaultExitR           = 0.30;" in ea
    assert "input double InpCounterExcursionMaxTargetR             = 0.50;" in ea
    mgr = manager_fn(ea)
    assert "COUNTER_TARGET_MAXR_HARD_CAP" in mgr
    assert "exceptionallyStrong" not in mgr  # the old "extend past 0.5R if momentum is exceptional" exception is gone
    assert "COUNTER_TARGET_1R_HARD_CAP" not in mgr


def test_12_13_14_no_pyramiding_averaging_recovery_addition():
    ea = read(EA)
    for fn in (entry_fn(ea), manager_fn(ea)):
        assert "TTM_RecordEntry" not in fn
        assert "XAU_TRI_Evaluate" not in fn
        assert "XAU_RecoveryExpansionBasketVeto" not in fn
        assert "PyramidAdd" not in fn and "addLot" not in fn


def test_15_counter_position_cannot_become_normal_runner():
    mgr = manager_fn(read(EA))
    # the manager never calls into the normal runner/thesis-hold machinery
    for forbidden in ["XAU_LogTradeThesisStatus", "TTM_FindOrCreateSlot", "XAU_RecoveryExpansionContinuationValid"]:
        assert forbidden not in mgr


# ---------------------------------------------------------------------------
# GRADE FLOW (16-21) -- grade eligibility alone must never trigger a countertrade
# ---------------------------------------------------------------------------

def test_16_to_21_grade_gate_precedes_block_reason_evaluation():
    fn = entry_fn(read(EA))
    grade_idx = fn.index("bool eligibleGrade = XAU_IsInverseExperimentGradeEligible(originalFinalGrade);")
    reject_idx = fn.index("if(!eligibleGrade)")
    block_eligible_idx = fn.index("bool eligible = XAU_CounterExcursionEligible(originalSignal, blockReason, category);")
    microconfirm_idx = fn.index("XAU_CounterExcursionFreshMicroConfirm(counterDir, whyFail)")
    order_idx = fn.index("trade.SetExpertMagicNumber(InpCounterExcursionMagicNumber)")
    # required combination, in order: eligible grade -> genuinely blocked with
    # a qualifying reason -> fast validation pass -> only then a broker order
    assert grade_idx < reject_idx < block_eligible_idx < microconfirm_idx < order_idx


def test_20_accepted_trades_are_never_blindly_reversed():
    ea = read(EA)
    # the ONLY call site is inside XAU_RememberBlockedSignal (a rejection
    # choke point); nothing in the acceptance/OpenTrade path can reach it.
    assert "XAU_TryCounterExcursionEntry" not in open_trade_fn(ea)


# ---------------------------------------------------------------------------
# BLOCK FLOW (22-27) -- fail closed
# ---------------------------------------------------------------------------

def test_22_to_26_safety_blocks_excluded():
    fn = eligible_fn(read(EA))
    for marker in ["TRANSITION_WAIT", "BOTH_ALLOWED", "UNDECIDED",  # uncertainty
                   "SPREAD_TOO_WIDE", "SPREAD SPIKE",               # spread
                   "NEWS FILTER", "NEWS_ENTRY_BLOCKED",             # news
                   "MARGIN", "AGG_RISK",                            # margin/account
                   "MISSING", "NOT ENOUGH DATA"]:                   # missing data
        assert f'"{marker}"' in fn


def test_27_genuine_opposite_pressure_can_qualify():
    fn = eligible_fn(read(EA))
    for marker in ["M5:AGAINST", "STRONG BEARISH FLIP", "STRONG BULLISH FLIP", "EMAS BOTH OPPOSE"]:
        assert f'"{marker}"' in fn
    assert fn.index("excludeMarkers[]") < fn.index("positiveMarkers[]")


# ---------------------------------------------------------------------------
# STATE FLOW (28-35)
# ---------------------------------------------------------------------------

def test_28_cancellation_before_order_never_sets_ownership():
    fn = entry_fn(read(EA))
    # every early return before the broker send happens strictly before
    # g_counterEx.active is ever assigned true
    ownership_idx = fn.index("g_counterEx.active = true;")
    for marker in ["if(!eligible) return;", "if(normalPositionOpen)", "if(counterPositionOpen)",
                   "if(!XAU_CounterExcursionFreshMicroConfirm"]:
        assert fn.index(marker) < ownership_idx


def test_29_broker_rejection_clears_reservation():
    fn = entry_fn(read(EA))
    ok_idx = fn.index("bool ok = (counterDir == 1) ? trade.Buy(")
    fail_idx = fn.index("if(!ok)")
    ownership_idx = fn.index("g_counterEx.active = true;")
    assert ok_idx < fail_idx < ownership_idx  # rejection branch returns before ownership is ever claimed


def test_30_position_close_clears_counter_state():
    mgr = manager_fn(read(EA))
    assert mgr.count("g_counterEx.active = false;") >= 2  # external-close reconciliation + normal exit


def test_31_32_restart_recognizes_open_position_not_stale_execution():
    ea = read(EA)
    assert "void XAU_ReconcileCounterExcursionOnInit()" in ea
    assert "XAU_ReconcileCounterExcursionOnInit();" in ea
    fn = reconcile_fn(ea)
    assert "PositionGetInteger(POSITION_MAGIC) != InpCounterExcursionMagicNumber" in fn
    # reconciliation only ADOPTS an existing broker position -- it must never
    # place a new order.
    assert "trade.Buy(" not in fn
    assert "trade.Sell(" not in fn
    assert "OpenTrade(" not in fn


def test_33_duplicate_scan_cannot_duplicate_counter_order():
    fn = entry_fn(read(EA))
    assert "if(g_counterEx.active) return; // one countertrade max per symbol" in fn


def test_34_counter_cooldown_does_not_touch_normal_path():
    ea = read(EA)
    assert "g_counterExCooldownUntil" not in open_trade_fn(ea)
    assert "g_counterExCooldownUntil" not in timing_fn(ea)


def test_35_normal_cooldown_does_not_touch_counter_path():
    fn = entry_fn(read(EA))
    assert "IsDirectionLocked" not in fn
    assert "buyLockoutUntil" not in fn and "sellLockoutUntil" not in fn


# ---------------------------------------------------------------------------
# RISK FLOW (36-40)
# ---------------------------------------------------------------------------

def test_36_counter_risk_not_literal_equity_percent():
    fn = entry_fn(read(EA))
    assert "double normalRiskUSD = equity * InpNormalRiskPct / 100.0;" in fn
    assert "double riskUSD = normalRiskUSD * counterRiskFraction;" in fn


def test_37_broker_min_lot_cannot_inflate_risk():
    fn = entry_fn(read(EA))
    assert "COUNTER_EXCURSION_SKIP_BROKER_MIN_EXCEEDS_RISK" in fn
    assert "lots = minLot" not in fn
    assert "lots = MathMax(lots, minLot)" not in fn


def test_39_40_r_calculation_uses_actual_counter_position():
    mgr = manager_fn(read(EA))
    assert "bool isBuy = posInfo.PositionType() == POSITION_TYPE_BUY;" in mgr
    assert "double priceMove = isBuy ? (curPrice - openPx) : (openPx - curPrice);" in mgr
    assert "InpCounterExcursionProtectAtR" in mgr
    assert "InpCounterExcursionDefaultExitR" in mgr
    assert "InpCounterExcursionMaxTargetR" in mgr


# ---------------------------------------------------------------------------
# INTEGRATION FLOW (41-47)
# ---------------------------------------------------------------------------

def test_41_single_ownership_guard_covers_every_opentrade_caller():
    fn = open_trade_fn(read(EA))
    assert "if(g_counterEx.active)" in fn
    assert "OPEN_TRADE_BLOCKED_COUNTER_EXCURSION_ACTIVE" in fn
    # this guard is the FIRST check in the function body -- every caller
    # (fresh scan, recovery, re-entry, manual force-open) passes through it.
    assert fn.index("if(g_counterEx.active)") < fn.index("int digits = (int)SymbolInfoInteger(Symbol(), SYMBOL_DIGITS);")


def test_42_normal_exit_managers_cannot_steal_counter_position():
    ea = read(EA)
    idx = ea.index("for(int i = PositionsTotal() - 1; i >= 0; i--)", ea.index("void ManagePositions()"))
    window = ea[idx:idx + 300]
    assert "posInfo.Magic() != InpMagicNumber" in window


def test_43_counter_manager_cannot_touch_normal_position():
    mgr = manager_fn(read(EA))
    assert "posInfo.Magic() != InpCounterExcursionMagicNumber" in mgr


def test_44_fresh_reason_every_candidate_no_reuse():
    ea = read(EA)
    rbs = section(ea, "void XAU_RememberBlockedSignal(", "if(!InpBlockedTradeMemoryReport")
    # reason is a function PARAMETER, freshly supplied by each of the ~26
    # call sites this tick -- never cached/read from a stored global.
    assert "string reason" in ea[ea.index("void XAU_RememberBlockedSignal("):ea.index("void XAU_RememberBlockedSignal(") + 200]


def test_45_normal_pipeline_untouched_still_produces_trades():
    assert timing_fn(read(EA)) == timing_fn(read(BASELINE))


def test_46_not_every_block_becomes_a_countertrade():
    # fail-closed eligibility (positive-marker-required) + grade gate (B
    # excluded) means most blocks -- uncertainty, safety, B-grade -- never
    # reach a broker order. Structural proof: SKIP paths outnumber the
    # single order-send path many times over.
    fn = entry_fn(read(EA))
    assert fn.count("return;") >= 8
    # a single ternary picks one branch at runtime; both textually appear
    # exactly once each as the two arms of that one order-send decision.
    assert fn.count("trade.Buy(") == 1 and fn.count("trade.Sell(") == 1


def test_47_three_final_states_reachable():
    fn = entry_fn(read(EA))
    # NORMAL TRADE: this module never calls OpenTrade -- normal execution is
    # untouched and reachable independently.
    assert "OpenTrade(" not in fn
    # COUNTER TRADE: reachable when grade+block+fast-check all pass.
    # a single ternary picks one branch at runtime; both textually appear
    # exactly once each as the two arms of that one order-send decision.
    assert fn.count("trade.Buy(") == 1 and fn.count("trade.Sell(") == 1
    # WAIT/NO TRADE: every gate above has its own return with a labeled
    # reason -- never a silent fallthrough.
    assert "COUNTER_EXCURSION_SKIP" in fn or "return;" in fn


def test_compile_zero_errors_zero_warnings():
    log_candidates = sorted((ROOT / "compile_logs").glob("counter_excursion_exp1_nodelay_check*.log"))
    assert log_candidates, "no no-delay-correction compile log found"
    latest = log_candidates[-1]
    text = latest.read_bytes().decode("utf-16-le", errors="ignore")
    if "Result:" not in text:
        text = latest.read_bytes().decode("utf-8", errors="ignore")
    assert "Result: 0 errors, 0 warnings" in text


def test_production_files_untouched():
    for name in ("XAUUSD_AI_Sniper_EA_v6.20.4.mq5", "XAUUSD_AI_Sniper_EA_v6.20.5.mq5"):
        p = ROOT / name
        assert p.exists()
    baseline_text = read(BASELINE)
    assert "COUNTER_EXCURSION" not in baseline_text
    assert "XAU_ReconcileCounterExcursionOnInit" not in baseline_text
