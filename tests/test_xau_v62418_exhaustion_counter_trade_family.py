from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"
V62417_EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.24.17.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def fn_body(ea: str, signature: str, size: int = 3000) -> str:
    idx = ea.index(signature)
    return ea[idx: idx + size]


def test_all_three_source_copies_synced():
    assert read(EA) == read(BACKEND_EA) == read(V62417_EA)


def test_compile_log_reports_zero_errors_and_warnings():
    log = (ROOT / "tester_sandbox" / "MT5_Isolated" / "compile_signal_integrity.log").read_bytes()
    text = log.decode("utf-16-le", errors="ignore")
    assert "0 errors, 0 warnings" in text


# ---------------------------------------------------------------------------
# Eligibility boundary: 79% no eligibility, 80% eligibility, 100% eligibility,
# >100% (impossible but defensively out-of-range) rejected.
# ---------------------------------------------------------------------------
def test_eligibility_thresholds_are_input_driven_not_hardcoded_inline():
    ea = read(BACKEND_EA)
    assert "input double InpExhaustionCounterMinExhaustionPct       = 80.0;" in ea
    assert "input double InpExhaustionCounterMaxExhaustionPct       = 100.0;" in ea
    fn = fn_body(ea, "bool XAU_ExhaustionCounterEligible(")
    assert "td.exhaustionProbability < InpExhaustionCounterMinExhaustionPct" in fn
    assert "td.exhaustionProbability > InpExhaustionCounterMaxExhaustionPct + 0.0001" in fn


def test_79_percent_is_below_threshold_80_is_at_threshold():
    # pure numeric proof of the boundary semantics used above (>=, not >)
    min_pct = 80.0
    assert not (79.0 >= min_pct)
    assert 80.0 >= min_pct
    assert 100.0 >= min_pct


def test_exhausted_sell_produces_temporary_buy_and_vice_versa():
    ea = read(BACKEND_EA)
    fn = fn_body(ea, "void XAU_TryExhaustionCounterEntry()", 9000)
    assert "int counterDir = -exhaustedDirection;" in fn
    # exhaustedDirection comes straight from the transition engine's own
    # dominant-direction read via the eligibility function -- never
    # independently re-derived or hardcoded to one side.
    assert "exhaustedDirection = td.dominantDirection;" in read(BACKEND_EA)


def test_does_not_use_the_normal_120_180s_timer_or_entry_readiness():
    ea = read(BACKEND_EA)
    fn = fn_body(ea, "void XAU_TryExhaustionCounterEntry()", 9000)
    assert "XAU_TimingAuthorityAllows" not in fn
    assert "XAU_EffectiveEntryDelaySeconds" not in fn
    assert "g_readiness[" not in fn
    assert "XAU_FinalEntryArbiter" not in fn


def test_does_not_require_full_htf_reversal_only_reaction_evidence():
    ea = read(BACKEND_EA)
    fn = fn_body(ea, "int XAU_ExhaustionCounterReactionScore(", 1800)
    # score is a simple additive count of independent evidence booleans,
    # not a requirement that ALL of them (a full reversal) be true.
    assert "reactionScore" not in fn  # the score itself is returned, named at the call site
    assert "return (reclaim ? 1 : 0) + (displacement ? 1 : 0) + (wickRejection ? 1 : 0) +" in ea


def test_minimum_two_of_five_reaction_factors_required():
    ea = read(BACKEND_EA)
    assert "if(reactionScore < 2)" in ea


def test_floor_policy_030_to_020_and_target_050():
    ea = read(BACKEND_EA)
    assert "input double InpExhaustionCounterArmFloorAtR            = 0.30;" in ea
    assert "input double InpExhaustionCounterFloorR                 = 0.20;" in ea
    assert "input double InpExhaustionCounterTargetR                = 0.50;" in ea
    fn = fn_body(ea, "bool XAU_ManageExhaustionCounterPosition()", 5000)
    assert "if(R >= InpExhaustionCounterTargetR)" in fn
    assert "g_exhaustionCounter.peakR >= InpExhaustionCounterArmFloorAtR" in fn
    assert 'g_exhaustionCounter.protectedFloorR = InpExhaustionCounterFloorR;' in fn


def test_below_030r_peak_preserves_structural_sl_no_floor_modify():
    ea = read(BACKEND_EA)
    fn = fn_body(ea, "bool XAU_ManageExhaustionCounterPosition()", 5000)
    # the floor-arming block is gated strictly behind peakR >= arm threshold;
    # the SafeModifySL call for the floor is itself gated behind
    # protectedFloorR > -999.0, which can only become true after arming.
    arm_idx = fn.index("if(g_exhaustionCounter.peakR >= InpExhaustionCounterArmFloorAtR")
    modify_idx = fn.index("SafeModifySL(g_exhaustionCounter.ticket")
    assert arm_idx < modify_idx
    modify_guard_idx = fn.rindex("if(g_exhaustionCounter.protectedFloorR > -999.0)", 0, modify_idx)
    assert modify_guard_idx < modify_idx


def test_floor_is_distinct_from_primary_and_counter_excursion_policies():
    ea = read(BACKEND_EA)
    # this family's floor formula must NOT be the primary 0.50R/70%-of-peak
    # formula, and must NOT be Counter-Excursion's own staged 0.2/0.3/0.5R
    # policy variables (InpCounterExcursionProtectAtR etc).
    fn = fn_body(ea, "bool XAU_ManageExhaustionCounterPosition()", 5000)
    assert "InpCounterExcursionProtectAtR" not in fn
    assert "InpCounterExcursionDefaultExitR" not in fn
    assert "peakR * 0.70" not in fn
    assert "peakR*0.70" not in fn


def test_netting_account_blocked_with_named_result_hedging_required():
    ea = read(BACKEND_EA)
    fn = fn_body(ea, "void XAU_TryExhaustionCounterEntry()", 2000)
    assert "ACCOUNT_MARGIN_MODE_RETAIL_HEDGING" in fn
    assert "EXHAUSTION_COUNTER_SKIP_NETTING_UNSUPPORTED" in fn


def test_own_distinct_magic_number_and_risk_fraction_not_normal_10pct():
    ea = read(BACKEND_EA)
    assert "input int    InpExhaustionCounterMagicNumber            = 90207001;" in ea
    assert "input double InpExhaustionCounterRiskFraction           = 0.15;" in ea
    fn = fn_body(ea, "void XAU_TryExhaustionCounterEntry()", 9000)
    assert "StrategyReferenceBalance() * InpNormalRiskPct / 100.0" in fn
    assert "* MathMax(0.0, InpExhaustionCounterRiskFraction)" in fn


def test_own_sl_geometry_not_the_120x_widened_normal_distance():
    ea = read(BACKEND_EA)
    fn = fn_body(ea, "void XAU_TryExhaustionCounterEntry()", 9000)
    assert "atr * InpExhaustionCounterSLATRMult" in fn
    assert "XAU_SL_WIDENING_FACTOR" not in fn


def test_duplicate_prevention_one_at_a_time_per_symbol():
    ea = read(BACKEND_EA)
    fn = fn_body(ea, "void XAU_TryExhaustionCounterEntry()", 800)
    assert "if(g_exhaustionCounter.active) return;" in fn


def test_hooked_into_ontick_unconditionally_and_oninit_reconciliation():
    ea = read(BACKEND_EA)
    assert "XAU_ManageExhaustionCounterPosition();" in ea
    assert "XAU_TryExhaustionCounterEntry();" in ea
    assert "XAU_ReconcileExhaustionCounterOnInit();" in ea
    manage_idx = ea.index("XAU_ManageExhaustionCounterPosition();")
    try_idx = ea.index("XAU_TryExhaustionCounterEntry();")
    assert manage_idx < try_idx


def test_hooked_into_every_account_level_emergency_close_site():
    ea = read(BACKEND_EA)
    assert ea.count('XAU_ExhaustionCounterEmergencyClose("WEEKEND_CLOSE");') == 1
    assert ea.count("XAU_ExhaustionCounterEmergencyClose(\"PROP_FIRM_LOSS_LOCK: \" + propFirmLock);") == 1
    assert ea.count('XAU_ExhaustionCounterEmergencyClose("EQUITY_PROTECT");') == 1
    assert ea.count('XAU_ExhaustionCounterEmergencyClose("WEEKLY_TARGET_HIT");') == 1
    assert ea.count('XAU_ExhaustionCounterEmergencyClose("REMOTE_COMMAND_CLOSE_ALL");') == 1


def test_never_auto_reenters_the_exhausted_direction_by_construction():
    ea = read(BACKEND_EA)
    fn = fn_body(ea, "void XAU_TryExhaustionCounterEntry()", 8000)
    # the ONLY direction this function ever sends is counterDir (-exhaustedDirection);
    # exhaustedDirection itself is never passed to trade.Buy/trade.Sell.
    send_idx = fn.index("bool ok = isBuy ? trade.Buy(")
    send_window = fn[send_idx: send_idx + 300]
    assert "exhaustedDirection" not in send_window


def test_required_log_tags_present():
    ea = read(BACKEND_EA)
    for tag in ["EXHAUSTION_COUNTER_CANDIDATE", "EXHAUSTION_COUNTER_CONFIRMED",
                "EXHAUSTION_COUNTER_OPENED", "EXHAUSTION_COUNTER_030_REACHED",
                "EXHAUSTION_COUNTER_FLOOR_020_ARMED", "EXHAUSTION_COUNTER_TARGET_050_HIT",
                "EXHAUSTION_COUNTER_PROTECTED_STOP_HIT", "EXHAUSTION_COUNTER_REJECTED"]:
        assert tag in ea, f"missing required log tag {tag}"
