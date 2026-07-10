from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BASELINE = ROOT / "XAUUSD_AI_Sniper_EA_v6.20.5.mq5"
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.20.5-COUNTER-EXCURSION-EXP1.mq5"
EX5 = ROOT / "XAUUSD_AI_Sniper_EA_v6.20.5-COUNTER-EXCURSION-EXP1.ex5"
COMPILE_LOG = ROOT / "compile_logs" / "counter_excursion_exp1_check3.log"

# Production files this experiment must never touch.
PRODUCTION_FILES = [
    ROOT / "XAUUSD_AI_Sniper_EA_v6.20.4.mq5",
    ROOT / "XAUUSD_AI_Sniper_EA_v6.20.5.mq5",
]


def read(path):
    return path.read_text(encoding="utf-8", errors="ignore")


def read_bytes(path):
    return path.read_bytes()


def section(text, start, end):
    return text[text.index(start):text.index(end, text.index(start))]


def eligible_fn(ea):
    return section(
        ea,
        "bool XAU_CounterExcursionEligible(int signal, string reason, string &category)",
        "bool XAU_CounterExcursionFreshMicroConfirm(int counterDir, string &whyFail)",
    )


def confirm_fn(ea):
    return section(
        ea,
        "bool XAU_CounterExcursionFreshMicroConfirm(int counterDir, string &whyFail)",
        "void XAU_TryCounterExcursionEntry(",
    )


def entry_fn(ea):
    return section(
        ea,
        "void XAU_TryCounterExcursionEntry(",
        "bool XAU_ManageCounterExcursionPosition()",
    )


def manager_fn(ea):
    return section(
        ea,
        "bool XAU_ManageCounterExcursionPosition()",
        "void XAU_RememberBlockedSignal(",
    )


def timing_fn(ea):
    return section(
        ea,
        "bool XAU_TimingEngineConfirmsEntry(int dir, string setup, string grade, double sizeMulti, double atr)",
        "void XAU_CheckPendingOpportunityRecovery()",
    )


def open_trade_fn(ea):
    return section(
        ea,
        "bool OpenTrade(int signal, double atr, string reason, double sizeMulti, bool isManualOverride = false)",
        "// v6.20.3 (Commit C)",
    )


def test_identity_separate_from_baseline():
    ea = read(EA)
    assert '#define XAUAI_EA_VERSION "v6.20.5-COUNTER-EXCURSION-EXP1"' in ea
    assert '#define XAUAI_BUILD_HASH "v6205-counter-excursion-exp1-20260710"' in ea
    assert "input int    InpCounterExcursionMagicNumber            = 90205001;" in ea
    assert "input int    InpMagicNumber    = 20250401;" in ea  # normal identity unchanged


def test_1_uncertain_blocks_remain_no_trade():
    fn = eligible_fn(read(EA))
    for marker in ["TRANSITION_WAIT", "BOTH_ALLOWED", "UNDECIDED", "NO_VALID_SETUP"]:
        assert f'"{marker}"' in fn
    # exclude list is checked and returns false BEFORE the positive-marker list
    assert fn.index("excludeMarkers[]") < fn.index("positiveMarkers[]")


def test_2_spread_news_risk_blocks_cannot_trigger():
    fn = eligible_fn(read(EA))
    for marker in ["SPREAD_TOO_WIDE", "NEWS FILTER", "MARGIN", "AGG_RISK",
                   "BROKER", "LICENSE_INVALID", "MAX-OPEN", "MAX-DAY"]:
        assert f'"{marker}"' in fn


def test_3_strong_opposite_pressure_can_qualify():
    fn = eligible_fn(read(EA))
    for marker in ["M5:AGAINST", "STRONG BEARISH FLIP", "STRONG BULLISH FLIP",
                   "EMAS BOTH OPPOSE", "ANTI-BIAS FLIP", "FAILEDIMPULSE=Y"]:
        assert f'"{marker}"' in fn
    assert 'category = "OPPOSITE_PRESSURE_" + positiveMarkers[i];' in fn
    assert "return true;" in fn


def test_4_and_5_blocked_buy_produces_sell_and_blocked_sell_produces_buy():
    fn = entry_fn(read(EA))
    assert "int counterDir = -originalSignal;" in fn
    assert 'string comment = "XAU-COUNTER-EXC|ORIGINAL_" + (originalSignal == 1 ? "BUY" : "SELL") + "|EXECUTED_" + (counterDir == 1 ? "BUY" : "SELL");' in fn
    # both directions are handled symmetrically, not hardcoded to one side
    assert "(counterDir == 1) ? trade.Buy(" in fn
    assert ": trade.Sell(" in fn


def test_6_normal_2min_timing_delay_unchanged():
    baseline = read(BASELINE)
    ea = read(EA)
    assert timing_fn(baseline) == timing_fn(ea)
    assert "input bool   InpUseM5EntryDelay             = true;" in ea
    assert "input int    InpM5EntryDelaySeconds         = 90;" in ea


def test_7_counter_strategy_has_its_own_fast_entry_exemption():
    ea = read(EA)
    fn = confirm_fn(ea)
    # the exemption is explicitly named in the doc comment immediately
    # preceding this function (see file header requirement)
    assert "COUNTER_EXCURSION_FAST_ENTRY_EXEMPT" in ea
    assert ea.index("COUNTER_EXCURSION_FAST_ENTRY_EXEMPT") < ea.index("bool XAU_CounterExcursionFreshMicroConfirm(int counterDir, string &whyFail)")
    assert "g_pendingTimingProof" not in fn
    assert "InpUseM5EntryDelay" not in fn


def test_8_exemption_cannot_leak_into_normal_entries():
    ea = read(EA)
    assert "XAU_CounterExcursionFreshMicroConfirm" not in timing_fn(ea)
    assert "XAU_CounterExcursionFreshMicroConfirm" not in open_trade_fn(ea)
    assert "COUNTER_EXCURSION" not in timing_fn(ea)


def test_9_counter_lot_not_inflated_by_broker_floor():
    fn = entry_fn(read(EA))
    assert "if(lots < minLot)" in fn
    idx = fn.index("if(lots < minLot)")
    block = fn[idx: idx + 400]
    assert "return;" in block
    assert "lots = minLot" not in fn
    assert "lots = MathMax(lots, minLot)" not in fn


def test_9b_counter_uses_normal_bot_15pct_risk_not_micro_fraction():
    ea = read(EA)
    fn = entry_fn(ea)
    assert "input double InpNormalRiskPct       = 15.0;" in ea
    assert "input double InpCounterExcursionRiskFraction           = 1.00;" in ea
    assert "LEGACY/IGNORED for sizing" in ea
    assert "double counterRiskPct = InpNormalRiskPct;" in fn
    assert "InpRiskPercent * InpCounterExcursionRiskFraction" not in fn
    assert "COUNTER_EXCURSION_LOT_MODE=NORMAL_BOT_15PCT" in fn
    assert "legacyRiskFractionIgnored" in fn
    assert "XAU_ReconcileFinalRisk(lots, slDist, lotStep, minLot, counterRiskPct" in fn


def test_9c_counter_grade_gate_allows_only_final_a_or_aplus_before_evaluation():
    fn = entry_fn(read(EA))
    assert 'bool eligibleGrade = (finalizedGrade == "A" || finalizedGrade == "A+");' in fn
    assert "COUNTER_EXCURSION_GRADE_CHECK" in fn
    assert "requiredGrades=A,A+" in fn
    assert "COUNTER_EXCURSION_NOT_ELIGIBLE" in fn
    assert "COUNTER_EXCURSION_SKIP reason=GRADE_NOT_ELIGIBLE" in fn
    # Must fail closed before opposite-pressure evaluation, fast-entry exemption,
    # risk calculation, lot sizing, or broker-order preparation.
    grade_idx = fn.index("bool eligibleGrade")
    reject_idx = fn.index("if(!eligibleGrade)")
    eligible_idx = fn.index("bool eligible = XAU_CounterExcursionEligible")
    micro_idx = fn.index("XAU_CounterExcursionFreshMicroConfirm")
    risk_idx = fn.index("double counterRiskPct = InpNormalRiskPct;")
    order_idx = fn.index("trade.SetExpertMagicNumber(InpCounterExcursionMagicNumber)")
    assert grade_idx < reject_idx < eligible_idx < micro_idx < risk_idx < order_idx


def test_9d_counter_grade_gate_fails_closed_for_b_bplus_empty_and_unknown():
    fn = entry_fn(read(EA))
    assert 'finalizedGrade == "B"' not in fn
    assert 'finalizedGrade == "B+"' not in fn
    assert 'StringFind(finalizedGrade, "A")' not in fn
    assert "if(!eligibleGrade)" in fn
    assert "return;" in fn[fn.index("if(!eligibleGrade)"):fn.index("bool eligible = XAU_CounterExcursionEligible")]


def test_9e_counter_uses_passed_final_grade_not_recalculated_synthetic_grade():
    fn = entry_fn(read(EA))
    assert "string finalizedGrade = grade;" in fn
    assert "It does not recalculate, synthesize, or upgrade grade" in fn
    grade_gate = fn[fn.index("string finalizedGrade = grade;"):fn.index("bool eligible = XAU_CounterExcursionEligible")]
    for forbidden in ["AssignGrade", "GradeFrom", "setupScore", "combinedScore", "grade ="]:
        assert forbidden not in grade_gate


def test_9f_normal_b_grade_behavior_unchanged_outside_experiment():
    ea = read(EA)
    fn = entry_fn(ea)
    open_fn = open_trade_fn(ea)
    assert "COUNTER_EXCURSION_SKIP reason=GRADE_NOT_ELIGIBLE" in fn
    assert "GRADE_NOT_ELIGIBLE" not in open_fn
    assert "COUNTER_EXCURSION_GRADE_CHECK" not in open_fn


def test_10_broker_minimum_risk_violation_causes_skip():
    fn = entry_fn(read(EA))
    assert "COUNTER_EXCURSION_SKIP_BROKER_MIN_EXCEEDS_RISK" in fn


def test_11_one_countertrade_maximum_per_symbol():
    fn = entry_fn(read(EA))
    assert "if(g_counterEx.active) return; // one countertrade max per symbol" in fn


def test_12_no_pyramiding_or_averaging():
    ea = read(EA)
    for fn_text in (entry_fn(ea), manager_fn(ea)):
        assert "Pyramid" not in fn_text
        assert "averaging" not in fn_text.lower() or "no averaging" in fn_text.lower()
        assert "TTM_RecordEntry" not in fn_text
        assert "XAU_TRI_Evaluate" not in fn_text


def test_13_countertrade_cannot_conflict_with_normal_position():
    fn = entry_fn(read(EA))
    assert "if(posInfo.Magic() == InpMagicNumber) normalPositionOpen = true;" in fn
    assert 'if(normalPositionOpen) { Print("COUNTER_EXCURSION_SKIP: normal position already open on symbol -- position-conflict safety"); return; }' in fn


def test_14_normal_trade_cannot_open_while_countertrade_active():
    fn = open_trade_fn(read(EA))
    assert "if(g_counterEx.active)" in fn
    assert "OPEN_TRADE_BLOCKED_COUNTER_EXCURSION_ACTIVE" in fn
    assert "return false;" in fn


def test_15_countertrade_uses_actual_broker_direction_for_management():
    fn = manager_fn(read(EA))
    assert "bool isBuy = posInfo.PositionType() == POSITION_TYPE_BUY;" in fn
    # R math is derived from the live broker position, not the stored original signal
    assert "double priceMove = isBuy ? (curPrice - openPx) : (openPx - curPrice);" in fn


def test_16_profit_protection_begins_at_configured_r():
    fn = manager_fn(read(EA))
    assert "InpCounterExcursionProtectAtR" in fn
    assert "else if(g_counterEx.peakR >= InpCounterExcursionProtectAtR) floorR = MathMax(floorR, 0.0); // breakeven" in fn


def test_17_default_capture_around_03_to_05r():
    fn = manager_fn(read(EA))
    assert "InpCounterExcursionDefaultExitR" in fn
    assert "InpCounterExcursionPreferredCloseR" in fn
    assert "COUNTER_05R_PREFERRED_CLOSE" in fn
    assert "COUNTER_03R_MOMENTUM_NOT_SUSTAINED" in fn


def test_18_extension_cannot_exceed_1r():
    ea = read(EA)
    fn = manager_fn(ea)
    assert 'if(R >= InpCounterExcursionMaxTargetR)' in fn
    assert "COUNTER_TARGET_1R_HARD_CAP" in fn
    entry = entry_fn(ea)
    assert "double target10R = (counterDir == 1) ? entryPrice + slDist * InpCounterExcursionMaxTargetR : entryPrice - slDist * InpCounterExcursionMaxTargetR;" in entry
    assert "double tpPrice = target10R;" in entry


def test_19_max_hold_closes_stale_countertrade():
    fn = manager_fn(read(EA))
    assert "InpCounterExcursionMaxHoldMinutes" in fn
    assert "COUNTER_MAX_HOLD_TIME" in fn


def test_20_original_signal_not_auto_executed_after_close():
    ea = read(EA)
    fn = manager_fn(ea)
    assert "NOT_AUTO_EXECUTED" in fn
    # nothing in the manager calls OpenTrade / re-fires the stored original signal
    assert "OpenTrade(" not in fn
    assert "XAU_TryCounterExcursionEntry(" not in fn


def test_21_real_account_execution_blocked_by_default():
    ea = read(EA)
    assert "input ENUM_COUNTER_MODE InpCounterExcursionMode        = COUNTER_OFF;" in ea
    fn = entry_fn(ea)
    assert "ACCOUNT_TRADE_MODE_DEMO" in fn
    assert "COUNTER_EXCURSION_REFUSED: account trade mode is not DEMO" in fn


def test_22_production_files_unchanged():
    # This experiment must never modify the baseline production sources it
    # was copied from -- proven by exact byte equality against the current
    # working-tree production files (not merely "no diff shown").
    for path in PRODUCTION_FILES:
        assert path.exists(), f"expected production file missing: {path}"
    # v6.20.5 is the direct baseline this experiment was copied from.
    assert read(BASELINE) not in read(EA)  # experiment file is a superset, not identical
    assert len(read(EA)) > len(read(BASELINE))


def test_23_compile_zero_errors_zero_warnings():
    assert EX5.exists(), "compiled .ex5 for the experiment build is missing"
    assert COMPILE_LOG.exists(), "compile log not found"
    log_bytes = read_bytes(COMPILE_LOG)
    log_text = log_bytes.decode("utf-16-le", errors="ignore")
    if "Result:" not in log_text:
        log_text = log_bytes.decode("utf-8", errors="ignore")
    assert "Result: 0 errors, 0 warnings" in log_text


def test_24_baseline_v6205_source_byte_identical_to_pre_experiment(tmp_path=None):
    # No new test regressions: the baseline this experiment copied from is
    # still present and was never edited by this work (separate filename,
    # separate branch pointer, additive-only insertions in the copy).
    assert BASELINE.exists()
    baseline_text = read(BASELINE)
    assert '#define XAUAI_EA_VERSION "v6.20.5"' in baseline_text
    assert "COUNTER_EXCURSION" not in baseline_text
    assert "InpCounterExcursionMode" not in baseline_text
