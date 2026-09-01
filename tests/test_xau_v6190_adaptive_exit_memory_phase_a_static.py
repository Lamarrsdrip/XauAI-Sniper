from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.19.0.mq5"
EA_BACKEND = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path):
    return path.read_text(encoding="utf-8", errors="ignore")


def section(text, start, end):
    return text[text.index(start):text.index(end, text.index(start))]


def test_v6190_identity_and_synced_backend():
    ea = read(EA)
    assert '#property version   "6.198"' in ea
    assert '#define XAUAI_EA_VERSION "v6.19.0"' in ea
    assert '#define XAUAI_EA_VERSION_NUM "6.19.0"' in ea
    assert read(EA) == read(EA_BACKEND)


def test_keyed_bias_struct_and_helpers_exist():
    ea = read(EA)
    assert "struct XAU_ExitBiasEntry" in ea
    assert "XAU_ExitBiasEntry g_exitBiasKeys[];" in ea
    assert "int XAU_FindExitBiasKey(string setup, int dir)" in ea
    assert "double XAU_GetExitLearningBias(string setup, int dir)" in ea
    assert "void XAU_UpdateExitLearningBias(string setup, int dir, string verdict)" in ea


def test_min_samples_guardrail_falls_back_to_global_not_zero():
    ea = read(EA)
    fn = section(ea, "double XAU_GetExitLearningBias(string setup, int dir)", "void XAU_UpdateExitLearningBias")
    assert "if(idx < 0 || g_exitBiasKeys[idx].samples < InpExitBiasMinSamples)" in fn
    # Cold start / thin sample must return the pre-existing global bias, never 0
    # or an undefined value -- today's live behavior must be the safe fallback.
    assert "return g_evExitLearningBias;" in fn


def test_decay_is_time_based_and_bounded():
    ea = read(EA)
    fn = section(ea, "double XAU_GetExitLearningBias(string setup, int dir)", "void XAU_UpdateExitLearningBias")
    assert "InpExitBiasDecayDays" in fn
    assert "MathMax(0.0, 1.0 - ageDays / MathMax(1.0, InpExitBiasDecayDays))" in fn


def test_decay_clamps_negative_age_from_backward_clock_moves():
    # Independent-audit finding: without clamping ageDays >= 0, a backward clock
    # jump (VPS NTP resync, snapshot restore) could push decay above 1.0 and let
    # the resolved bias momentarily exceed InpEVLearningBiasMax.
    ea = read(EA)
    fn = section(ea, "double XAU_GetExitLearningBias(string setup, int dir)", "void XAU_UpdateExitLearningBias")
    assert "double ageDays = MathMax(0.0, (double)(TimeCurrent() - g_exitBiasKeys[idx].lastUpdate) / 86400.0);" in fn


def test_update_uses_same_step_and_cap_as_existing_global_mechanism():
    ea = read(EA)
    fn = section(ea, "void XAU_UpdateExitLearningBias(string setup, int dir, string verdict)", "int XAU_FindBrainOpen")
    assert "InpEVLearningBiasStep" in fn
    assert "InpEVLearningBiasMax" in fn
    assert 'verdict == "EXIT_EARLY_LEFT_PROFIT"' in fn
    assert 'verdict == "EXIT_GOOD_AVOIDED_REVERSAL"' in fn
    assert "*= 0.98" in fn  # same neutral-outcome decay as the global mechanism


def test_bounded_array_evicts_oldest_rather_than_growing_unbounded():
    ea = read(EA)
    assert "#define XAU_EXIT_BIAS_MAX_KEYS 40" in ea
    fn = section(ea, "void XAU_UpdateExitLearningBias(string setup, int dir, string verdict)", "int XAU_FindBrainOpen")
    assert "if(n >= XAU_EXIT_BIAS_MAX_KEYS)" in fn
    assert "if(g_exitBiasKeys[i].lastUpdate < g_exitBiasKeys[oldest].lastUpdate) oldest = i;" in fn


def test_abnormal_news_and_spread_conditions_excluded_from_learning():
    ea = read(EA)
    fn = section(ea, "void XAU_EVPostCloseReview(TradeBrainOpen &r, string verdict,", "void XAU_UpdateClosedTradeReviews")
    assert "InpExitBiasExcludeAbnormal" in fn
    assert "PNS_AFTERMATH" in fn and "PNS_DISCOVERY" in fn and "PNS_AVOID" in fn
    assert 'reviewSpreadState == "HIGH" || reviewSpreadState == "EXTREME"' in fn
    assert "SKIPPED_ABNORMAL_CONDITION" in fn
    # The abnormal-condition check must return BEFORE either bias is touched.
    abnormal_idx = fn.index("abnormalCondition = InpExitBiasExcludeAbnormal")
    global_update_idx = fn.index('if(verdict == "EXIT_EARLY_LEFT_PROFIT")')
    assert abnormal_idx < global_update_idx


def test_evaluate_exit_ev_takes_resolved_bias_as_parameter_not_global_read():
    ea = read(EA)
    sig = section(ea, "XAU_EV_DECISION XAU_EvaluateExitEV(bool isBuy,", "{")
    assert "double exitLearningBias)" in sig
    body = section(ea, "XAU_EV_DECISION XAU_EvaluateExitEV(bool isBuy,", "double confidence = XAU_Clamp01")
    # Must not read the raw global directly inside the function anymore.
    assert "g_evExitLearningBias" not in section(ea, "int signal = isBuy ? 1 : -1;", "return ev;\n}")


def test_call_site_resolves_keyed_bias_via_open_trade_registry():
    ea = read(EA)
    fn = section(ea, "int evBrainIdx = XAU_FindBrainOpen(ticket);", "XAU_EV_DECISION ev = XAU_EvaluateExitEV")
    assert 'g_brainOpenTrades[evBrainIdx].setup' in fn
    assert "double resolvedExitBias = XAU_GetExitLearningBias(evSetup, isBuy ? 1 : -1);" in fn


def test_hard_cap_unchanged_from_pre_existing_mechanism():
    ea = read(EA)
    assert 'input double InpEVLearningBiasMax             = 0.18;' in ea


def test_learning_report_extended_with_per_key_table():
    ea = read(EA)
    fn = section(ea, "void XAU_WriteLearningReport()", "string XAU_BlockedMemoryFile()")
    assert "Adaptive Exit Memory (Phase A, v6.19.0)" in fn
    assert "g_exitBiasKeys" in fn
    assert "Confidence" in fn and "Decayed bias actually used" in fn
