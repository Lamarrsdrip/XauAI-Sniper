from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
EXP = ROOT / "XAUUSD_AI_Sniper_EA_v6.19.0-INVERSE-EXECUTION-EXP1.mq5"
PROD = ROOT / "XAUUSD_AI_Sniper_EA_v6.19.0.mq5"


def src() -> str:
    return EXP.read_text(encoding="utf-8", errors="ignore")


def test_experiment_file_is_separate_from_production():
    text = src()
    prod = PROD.read_text(encoding="utf-8", errors="ignore")
    assert "#define XAUAI_INVERSE_EXPERIMENT true" in text
    assert "INVERSE EXECUTION EXPERIMENT -- DEMO ONLY" in text
    assert "XAUAI_INVERSE_EXPERIMENT true" not in prod
    assert 'XAUAI_EA_VERSION "v6.19.0"' in prod


def test_normal_buy_executes_sell_and_normal_sell_executes_buy_for_eligible_grades():
    text = src()
    # inversion now only happens inside the eligible-grade branch (owner
    # correction: the old baseline inverted EVERY grade unconditionally)
    assert "execSignal = -originalSignal;   // MANDATORY for eligible grades: normal BUY -> SELL, normal SELL -> BUY." in text
    assert 'originalSignalDirection=%s executedDirection=%s' in text
    assert 'ORIGINAL_SIGNAL=%s INVERSE_EXECUTION=%s BROKER_ORDER_SENT=%s INVERSION_CONFIRMED=%s' in text
    assert re.search(r"if\(signal == 1\) ok = trade\.Buy", text)
    assert re.search(r"else ok = trade\.Sell", text)


def _eligible_inversion_block(text):
    start = text.index("int    originalSignal = signal;")
    end = text.index("candidateId = reason + \"_\" + IntegerToString((int)TimeCurrent());")
    return text[start:end]


def test_inverse_sl_is_mirrored_from_actual_inverse_price_not_original_absolute_sl():
    text = src()
    assert "execSL    = NormalizeDouble(execPrice - originalSLDist, digits);" in text
    assert "execSL    = NormalizeDouble(execPrice + originalSLDist, digits);" in text
    inversion_block = _eligible_inversion_block(text)
    assert "execSL = originalSL" not in inversion_block
    assert "sl = originalSL" not in inversion_block


def test_inverse_tp_is_actual_one_r_not_original_tp_distance():
    text = src()
    assert "execTP = NormalizeDouble(execPrice + execSLDist, digits);" in text
    assert "execTP = NormalizeDouble(execPrice - execSLDist, digits);" in text
    inversion_block = _eligible_inversion_block(text)
    assert "originalTPDist" not in inversion_block


def test_r_levels_are_calculated_from_actual_inverse_risk():
    text = src()
    assert "double execR03 = NormalizeDouble(execPrice + (execSignal == 1 ? execSLDist * 0.30 : -execSLDist * 0.30), digits);" in text
    assert "double execR05 = NormalizeDouble(execPrice + (execSignal == 1 ? execSLDist * 0.50 : -execSLDist * 0.50), digits);" in text
    assert "double execR10 = NormalizeDouble(execPrice + (execSignal == 1 ? execSLDist : -execSLDist), digits);" in text


def test_inverse_lot_recalculation_uses_broker_risk_math():
    text = src()
    assert "double originalRiskUSD = RiskPerLotForDistance(originalSLDist) * originalLots;" in text
    assert "double inverseRiskPerLot = RiskPerLotForDistance(execSLDist);" in text
    assert "execLots = NormalizeVolumeDown(originalRiskUSD / inverseRiskPerLot);" in text
    assert "INVERSE_EXPERIMENT_SKIP_BROKER_MIN_EXCEEDS_RISK" in text


def test_inverse_profit_manager_protects_captures_and_closes_by_one_r():
    text = src()
    assert "bool XAU_InverseExperimentManagePosition" in text
    assert "rMult >= 0.30" in text
    assert "rMult >= 0.50" in text
    assert "rMult >= 1.0" in text
    assert "INVERSE_EXP_PROTECT" in text
    assert "INVERSE_EXP_CAPTURE_0_5R" in text
    assert "INVERSE_EXP_TP_1R" in text
    assert "INVERSE_EXPERIMENT_EXTEND_TO_1R" in text
    close_func = text[text.index("bool XAU_InverseExperimentClose"):text.index("bool XAU_InverseExperimentManagePosition")]
    assert close_func.index("bool ok = SafePositionClose") < close_func.index("XAU_InverseExperimentRecordClose")


def test_position_management_uses_actual_executed_direction():
    text = src()
    assert "signal = execSignal;" in text
    assert "XAU_BrainRecordOpen(openedPosId, signal, price, sl, tp, lots" in text
    assert "XAU_InverseExperimentRecordOpen(openedPosId, originalSignal, signal, price" in text
    assert "int actualDir = isBuy ? 1 : -1;" in text


def test_experiment_disables_pyramids_reentry_recovery_and_multiple_positions():
    text = src()
    assert "input int    InpMaxOpenTrades  = 1;" in text
    assert "input bool   InpAllowPyramid    = false;" in text
    assert "input int    InpMaxPyramidAdds  = 0;" in text
    assert "input bool   InpUseReEntry     = false;" in text
    assert "if(XAUAI_INVERSE_EXPERIMENT) return;" in text
    assert "INVERSE_EXPERIMENT_ONE_TRADE_ONLY" in text
    assert "g_pendingOpportunity.active = false;" in text


def test_magic_number_is_experimental_and_does_not_collide_with_production_style():
    text = src()
    assert re.search(r"input\s+int\s+InpMagicNumber\s*=\s*90190001;", text)
    assert "INV_EXP|NORMAL_" in text
    assert "ACTUAL_" in text


def test_pre_delay_baseline_has_no_v620_mandatory_entry_delay():
    text = src()
    assert "InpUseM5EntryDelay" not in text
    assert "InpM5EntryDelaySeconds" not in text
    assert "M5_ENTRY_DELAY" not in text


def test_demo_only_guard_and_clear_journal_language_exist():
    text = src()
    assert "INVERSE_EXPERIMENT_REFUSED" in text
    assert "ACCOUNT_TRADE_MODE_DEMO" in text
    assert "NORMAL BOT DECISION:" in text
    assert "EXPERIMENTAL RULE: INVERT EXECUTION" in text
    assert "ACTUAL ACTION:" in text
    assert "TARGET MODE: FAST 0.3R-0.5R CAPTURE; 1R MAXIMUM IF MOMENTUM REMAINS STRONG" in text


def _grade_helper_fn(text):
    start = text.index("bool XAU_IsInverseExperimentGradeEligible(string originalGrade)")
    end = text.index("bool OpenTrade(int signal, double atr, string reason")
    return text[start:end]


def _entry_gate_block(text):
    start = text.index("string originalSignalDirStr = (signal == 1)")
    end = text.index("int    originalSignal = signal;")
    return text[start:end]


# --------------------------------------------------------------------------
# Grade-eligibility correction (owner directive): the original baseline
# inverted EVERY grade unconditionally ("MANDATORY... No exceptions"),
# which is wrong -- B is the bot's currently accurate/working grade and must
# execute normally, un-inverted. B+/A/A+ remain eligible for inversion.
# --------------------------------------------------------------------------

def test_grade_helper_exists_with_exact_match_and_fail_closed_semantics():
    text = src()
    fn = _grade_helper_fn(text)
    assert 'if(g == "B") return false;' in fn
    assert 'if(g == "B+") return true;' in fn
    assert 'if(g == "A") return true;' in fn
    assert 'if(g == "A+") return true;' in fn
    assert "return false;                      // empty / C / unknown / fallback -- fail closed" in fn
    assert fn.rstrip().endswith("}")
    assert "StringFind" not in fn


def test_b_grade_preserved_normal_no_inversion():
    text = src()
    gate = _entry_gate_block(text)
    assert "bool inversionEligible = XAU_IsInverseExperimentGradeEligible(originalFinalGrade);" in gate
    assert '(originalFinalGrade == "B") ? "NORMAL_B_PRESERVED"' in gate
    # the not-eligible branch must reuse the ORIGINAL signal/price/SL/TP/lot untouched
    normal_branch = text[text.index("if(!inversionEligible)"):text.index("else\n   {\n      // From here")]
    assert "execSignal = originalSignal;" in normal_branch
    assert "execPrice  = originalPrice;" in normal_branch
    assert "execSL     = originalSL;" in normal_branch
    assert "execTP     = originalTP;" in normal_branch
    assert "execLots   = originalLots;" in normal_branch
    assert "INVERSION_APPLIED=false" in normal_branch


def test_bplus_a_aplus_remain_eligible_for_inversion():
    text = src()
    fn = _grade_helper_fn(text)
    assert 'if(g == "B+") return true;' in fn
    assert 'if(g == "A") return true;' in fn
    assert 'if(g == "A+") return true;' in fn


def test_exact_comparison_prevents_bplus_confused_with_b():
    text = src()
    fn = _grade_helper_fn(text)
    b_idx = fn.index('if(g == "B") return false;')
    bplus_idx = fn.index('if(g == "B+") return true;')
    assert b_idx < bplus_idx
    assert "StringFind" not in fn
    assert "StringSubstr(g, 0, 1)" not in fn


def test_empty_and_unknown_grade_fail_closed():
    text = src()
    fn = _grade_helper_fn(text)
    for bad in ("C", "D", "FALLBACK", ""):
        assert f'if(g == "{bad}") return true;' not in fn


def test_original_grade_preserved_and_never_overwritten_by_executed_direction():
    text = src()
    gate = _entry_gate_block(text)
    assert "string originalFinalGrade = funnelGrade;" in gate
    # original grade comes from the SAME finalized-grade variable already
    # computed above for telemetry -- never recalculated post-inversion
    assert "originalFinalGrade = execSignal" not in text
    assert "originalFinalGrade = signal" not in text


def test_executed_direction_and_inversion_flag_stored_separately_from_original():
    text = src()
    struct_body = text[text.index("struct XAU_InverseExperimentRecord"):text.index("XAU_InverseExperimentRecord g_inverseExpRecords[];")]
    assert "int      originalSignal;" in struct_body
    assert "int      actualDirection;" in struct_body
    assert "bool     inversionApplied;" in struct_body


def test_b_grade_never_recorded_into_inverse_experiment_dataset():
    text = src()
    idx = text.index("if(inversionEligible)\n         XAU_InverseExperimentRecordOpen(")
    assert idx > 0  # guarded call exists -- B-grade rows never contaminate the experiment CSV


def test_telemetry_has_all_required_fields_both_branches():
    text = src()
    assert 'PrintFormat("ORIGINAL_SIGNAL=%s ORIGINAL_GRADE=%s GRADE_POLICY=%s ACTUAL_EXECUTION=%s INVERSION_APPLIED=false",' in text
    assert 'PrintFormat("ORIGINAL_SIGNAL=%s ORIGINAL_GRADE=%s GRADE_POLICY=%s ACTUAL_EXECUTION=%s INVERSION_APPLIED=true",' in text


def test_risk_sizing_here_is_not_a_flat_equity_percentage():
    # Unlike the separate counter-excursion experiment (which had a real
    # literal-15%-of-equity danger), this build reuses the SAME risk-USD the
    # normal strategy already computed for this exact trade (originalRiskUSD)
    # and only rescales the LOT for the inverted entry's own SL distance --
    # it never introduces a second, independent flat risk-% constant.
    text = src()
    assert "double originalRiskUSD = RiskPerLotForDistance(originalSLDist) * originalLots;" in text
    assert "double counterRiskPct = InpNormalRiskPct;" not in text


def test_production_v6190_untouched():
    prod = PROD.read_text(encoding="utf-8", errors="ignore")
    assert "XAU_IsInverseExperimentGradeEligible" not in prod
    assert "INVERSE EXECUTION EXPERIMENT" not in prod


def test_separate_csv_performance_recording_exists():
    text = src()
    assert "XAUAI_Inverse_Experiment_" in text
    for field in [
        "originalSignal",
        "actualExecution",
        "oneRDistance",
        "r03Level",
        "r05Level",
        "r10Level",
        "mae",
        "mfe",
        "peakR",
        "realizedR",
        "realizedUSD",
        "exitReason",
    ]:
        assert field in text
