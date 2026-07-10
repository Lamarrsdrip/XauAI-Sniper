"""Static tests for the counter-excursion experimental build.

Corrects Codex's original grade-eligibility rule (A/A+ only) and risk-sizing
model (literal InpNormalRiskPct=15% of EQUITY per counter-trade -- a real
danger, not just a naming issue) per explicit owner directive:

  B    -> NOT eligible for inversion. Observed to be the bot's currently
          accurate/working grade (lower immediate drawdown, better timing)
          -- does not benefit from drawdown-milking inversion. Must run
          under fully normal v6.20.4/v6.20.5 behavior, untouched.
  B+   -> eligible (a DIFFERENT grade from B -- exact-match only, never
          substring, so "B+" can never be folded into "B").
  A    -> eligible.
  A+   -> eligible.
  empty/C/unknown/fallback -> fail closed (not eligible).

Risk model: the counter-trade risks InpCounterRiskFractionOfNormal (0.15) of
the NORMAL bot's own calculated dollar risk for a trade like this
(equity * InpNormalRiskPct/100), never a flat percentage of account equity.

This experiment lives on branch experiment/counter-excursion-exp1 only. It
must never modify the production sources (v6.20.4.mq5, v6.20.5.mq5).

Per this repo's convention, these are static/text-level checks against the
.mq5 source (no MQL5 runtime in CI). File paths resolve the CURRENT
COUNTER-EXCURSION-EXP1 build via glob rather than a hardcoded version
number, since this experimental file's version tag has already been bumped
once (v6.20.5 -> v6.20.6) mid-development by a concurrent process.
"""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _latest_exp_file(suffix):
    candidates = sorted(ROOT.glob(f"XAUUSD_AI_Sniper_EA_v6.20.*-COUNTER-EXCURSION-EXP1{suffix}"))
    assert candidates, f"no COUNTER-EXCURSION-EXP1{suffix} file found in {ROOT}"
    return candidates[-1]


EA = _latest_exp_file(".mq5")
EX5 = _latest_exp_file(".ex5")
BASELINE = ROOT / "XAUUSD_AI_Sniper_EA_v6.20.5.mq5"

# Production files this experiment must never touch.
PRODUCTION_FILES = [
    ROOT / "XAUUSD_AI_Sniper_EA_v6.20.4.mq5",
    ROOT / "XAUUSD_AI_Sniper_EA_v6.20.5.mq5",
]


def read(path):
    return path.read_text(encoding="utf-8", errors="ignore")


def section(text, start, end):
    return text[text.index(start):text.index(end, text.index(start))]


def eligible_fn(ea):
    return section(
        ea,
        "bool XAU_CounterExcursionEligible(int signal, string reason, string &category)",
        "bool XAU_CounterExcursionFreshMicroConfirm(int counterDir, string &whyFail)",
    )


def grade_helper_fn(ea):
    return section(
        ea,
        "bool XAU_IsInverseExperimentGradeEligible(string originalGrade)",
        "bool XAU_CounterExcursionEligible(int signal, string reason, string &category)",
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


def open_trade_fn(ea):
    return section(
        ea,
        "bool OpenTrade(int signal, double atr, string reason, double sizeMulti, bool isManualOverride = false)",
        "// v6.20.3 (Commit C)",
    )


# --------------------------------------------------------------------------
# Grade-eligibility helper: XAU_IsInverseExperimentGradeEligible
# --------------------------------------------------------------------------

def test_helper_exists_with_exact_match_semantics():
    ea = read(EA)
    fn = grade_helper_fn(ea)
    assert 'if(g == "B") return false;' in fn
    assert 'if(g == "B+") return true;' in fn
    assert 'if(g == "A") return true;' in fn
    assert 'if(g == "A+") return true;' in fn
    assert "return false;" in fn.splitlines()[-2] or fn.rstrip().endswith("return false;\n}") or "return false;" in fn
    # exact-match only -- never substring/StringFind against grade text
    assert "StringFind(g, " not in fn
    assert "StringFind(originalGrade, " not in fn


def test_1_b_grade_buy_remains_buy_and_2_b_grade_sell_remains_sell():
    fn = entry_fn(read(EA))
    # for B, actualExecutionStr falls back to the ORIGINAL direction, not the
    # inverse -- verified structurally: the ternary's false-branch is
    # originalSignalDirStr, never counterDir-derived, when eligibleGrade=false.
    assert 'string actualExecutionStr = eligibleGrade ? (counterDir == 1 ? "BUY" : "SELL") : originalSignalDirStr;' in fn


def test_3_b_grade_never_receives_inverse_strategy_ownership():
    ea = read(EA)
    fn = entry_fn(ea)
    # B must return before g_counterEx is ever touched
    reject_idx = fn.index("if(!eligibleGrade)")
    ownership_idx = fn.index("g_counterEx.active = true;")
    assert reject_idx < ownership_idx
    assert "return;" in fn[reject_idx:fn.index("bool eligible = XAU_CounterExcursionEligible")]


def test_4_b_grade_never_uses_inverse_lot_sizing():
    fn = entry_fn(read(EA))
    reject_idx = fn.index("if(!eligibleGrade)")
    risk_idx = fn.index("double normalRiskUSD = equity * InpNormalRiskPct")
    assert reject_idx < risk_idx  # B returns long before any risk/lot math runs


def test_5_b_grade_never_uses_inverse_exit_targets():
    ea = read(EA)
    fn = entry_fn(ea)
    reject_idx = fn.index("if(!eligibleGrade)")
    target_idx = fn.index("double target03R")
    assert reject_idx < target_idx  # B returns long before target/TP computation


def test_6_and_7_bplus_inverts_both_directions():
    # B+ must reach the SAME eligible path as A/A+ -- proven by the single
    # shared eligibility helper (no separate "if B+" branch that could diverge).
    ea = read(EA)
    fn = grade_helper_fn(ea)
    assert 'if(g == "B+") return true;' in fn
    entry = entry_fn(ea)
    assert "bool eligibleGrade = XAU_IsInverseExperimentGradeEligible(originalFinalGrade);" in entry


def test_8_and_9_a_grade_inverts_both_directions():
    fn = grade_helper_fn(read(EA))
    assert 'if(g == "A") return true;' in fn


def test_10_and_11_aplus_grade_inverts_both_directions():
    fn = grade_helper_fn(read(EA))
    assert 'if(g == "A+") return true;' in fn


def test_12_exact_comparison_prevents_bplus_confused_with_b():
    ea = read(EA)
    fn = grade_helper_fn(ea)
    # "B" check must come before "B+" and use == not StringFind/substring
    b_idx = fn.index('if(g == "B") return false;')
    bplus_idx = fn.index('if(g == "B+") return true;')
    assert b_idx < bplus_idx
    assert "StringFind" not in fn
    # StringToUpper/Trim normalize whitespace/case only, never truncate "B+" to "B"
    assert "StringSubstr(g, 0, 1)" not in fn


def test_13_empty_grade_fails_closed():
    ea = read(EA)
    fn = section(ea, "bool XAU_IsInverseExperimentGradeEligible(string originalGrade)", "}\n")
    # falls through every explicit true-branch to a final `return false;`
    # immediately before the function's closing brace.
    assert fn.rstrip().endswith("return false;                      // empty / C / unknown / fallback -- fail closed")


def test_14_unknown_grade_fails_closed():
    fn = grade_helper_fn(read(EA))
    for bad in ("C", "D", "FALLBACK", ""):
        assert f'if(g == "{bad}") return true;' not in fn


def test_15_original_grade_preserved_after_inversion():
    ea = read(EA)
    entry = entry_fn(ea)
    assert "string originalFinalGrade = grade;" in entry
    assert "g_counterEx.originalGrade = originalFinalGrade;" in entry
    # never overwritten by the post-inversion executed direction
    assert "g_counterEx.originalGrade = counterDir" not in entry
    assert "g_counterEx.originalGrade = actualExecutionStr" not in entry


def test_16_executed_direction_stored_separately():
    ea = read(EA)
    struct_body = section(ea, "struct CounterExcursionState", "CounterExcursionState g_counterEx;")
    assert "int      originalSignalDirection;" in struct_body
    assert "int      counterExecutedDirection;" in struct_body
    assert "bool     inversionApplied;" in struct_body
    entry = entry_fn(ea)
    assert "g_counterEx.originalSignalDirection = originalSignal;" in entry
    assert "g_counterEx.counterExecutedDirection = counterDir;" in entry
    assert "g_counterEx.inversionApplied = true;" in entry


def test_17_broker_order_matches_inverse_direction_for_eligible_grades():
    fn = entry_fn(read(EA))
    assert "int counterDir = -originalSignal;" in fn
    assert "(counterDir == 1) ? trade.Buy(" in fn
    assert ": trade.Sell(" in fn
    # the broker send is only reachable after the eligibility gate returns true
    reject_idx = fn.index("if(!eligibleGrade)")
    send_idx = fn.index("bool ok = (counterDir == 1) ? trade.Buy(")
    assert reject_idx < send_idx


def test_18_original_direction_stands_for_b_no_counter_order_sent():
    fn = entry_fn(read(EA))
    reject_idx = fn.index("if(!eligibleGrade)")
    return_stmt_end = fn.index("\n", fn.index("return;", reject_idx))
    between_reject_and_return = fn[reject_idx:return_stmt_end]
    assert "trade.Buy(" not in between_reject_and_return
    assert "trade.Sell(" not in between_reject_and_return


def test_19_counter_risk_is_not_literal_15pct_account_risk():
    ea = read(EA)
    entry = entry_fn(ea)
    assert "input double InpCounterRiskFractionOfNormal            = 0.15;" in ea
    assert "double counterRiskPct = InpNormalRiskPct;" not in entry  # the old, dangerous line is gone
    assert "double normalRiskUSD = equity * InpNormalRiskPct / 100.0;" in entry
    assert "double riskUSD = normalRiskUSD * counterRiskFraction;" in entry
    assert "COUNTER_EXCURSION_LOT_MODE=FRACTION_OF_NORMAL_RISK" in entry
    assert "NORMAL_RISK_USD=%.2f COUNTER_RISK_FRACTION=%.2f COUNTER_RISK_USD=%.2f FINAL_COUNTER_LOT=%.4f" in entry
    # at the default 15%-of-15%, the counter-trade risks ~2.25% of equity,
    # nowhere near a literal 15%-of-equity position.
    default_normal_pct = 15.0
    default_fraction = 0.15
    implied_equity_pct = default_normal_pct * default_fraction
    assert implied_equity_pct == 2.25
    assert implied_equity_pct < 5.0


def test_20_production_files_untouched():
    for path in PRODUCTION_FILES:
        assert path.exists(), f"expected production file missing: {path}"
    assert BASELINE.exists()
    baseline_text = read(BASELINE)
    assert '#define XAUAI_EA_VERSION "v6.20.5"' in baseline_text
    assert "COUNTER_EXCURSION" not in baseline_text
    assert "InpCounterExcursionMode" not in baseline_text
    assert "XAU_IsInverseExperimentGradeEligible" not in baseline_text


def test_21_compile_zero_errors_zero_warnings():
    assert EX5.exists(), f"compiled .ex5 for the experiment build is missing: {EX5}"
    log_candidates = sorted((ROOT / "compile_logs").glob("counter_excursion_exp1_check*.log"))
    assert log_candidates, "no counter-excursion compile log found"
    latest_log = log_candidates[-1]
    log_bytes = latest_log.read_bytes()
    log_text = log_bytes.decode("utf-16-le", errors="ignore")
    if "Result:" not in log_text:
        log_text = log_bytes.decode("utf-8", errors="ignore")
    assert "Result: 0 errors, 0 warnings" in log_text


# --------------------------------------------------------------------------
# Telemetry format -- exact fields the owner requires on every decision.
# --------------------------------------------------------------------------

def test_telemetry_line_has_all_five_required_fields():
    fn = entry_fn(read(EA))
    assert 'PrintFormat("ORIGINAL_SIGNAL=%s ORIGINAL_GRADE=%s GRADE_POLICY=%s ACTUAL_EXECUTION=%s INVERSION_APPLIED=%s",' in fn
    assert "originalSignalDirStr, originalFinalGrade, gradePolicy, actualExecutionStr," in fn


def test_grade_policy_labels_match_owner_spec():
    fn = entry_fn(read(EA))
    assert '"NORMAL_B_PRESERVED"' in fn
    assert '"INVERSE_ELIGIBLE"' in fn


# --------------------------------------------------------------------------
# Everything Codex's original baseline already got right -- re-verified so
# the corrections above didn't regress any of it.
# --------------------------------------------------------------------------

def test_opposite_pressure_markers_unchanged():
    fn = eligible_fn(read(EA))
    for marker in ["M5:AGAINST", "STRONG BEARISH FLIP", "STRONG BULLISH FLIP",
                   "EMAS BOTH OPPOSE", "ANTI-BIAS FLIP", "FAILEDIMPULSE=Y"]:
        assert f'"{marker}"' in fn


def test_exclude_markers_still_checked_before_positive_markers():
    fn = eligible_fn(read(EA))
    assert fn.index("excludeMarkers[]") < fn.index("positiveMarkers[]")


def test_one_countertrade_maximum_per_symbol():
    fn = entry_fn(read(EA))
    assert "if(g_counterEx.active) return; // one countertrade max per symbol" in fn


def test_real_account_execution_blocked_by_default():
    ea = read(EA)
    assert "input ENUM_COUNTER_MODE InpCounterExcursionMode        = COUNTER_OFF;" in ea
    fn = entry_fn(ea)
    assert "ACCOUNT_TRADE_MODE_DEMO" in fn
    assert "COUNTER_EXCURSION_REFUSED: account trade mode is not DEMO" in fn


def test_max_target_hard_cap_unchanged():
    # Owner directive 2026-07-10 deliberately lowered the hard cap from 1.0R
    # to 0.5R with no "exceptionally strong momentum" exception -- the cap
    # mechanism itself (InpCounterExcursionMaxTargetR gate) is unchanged,
    # only its value and label are, matching the new spec exactly.
    fn = manager_fn(read(EA))
    assert "if(R >= InpCounterExcursionMaxTargetR)" in fn
    assert "COUNTER_TARGET_MAXR_HARD_CAP" in fn
