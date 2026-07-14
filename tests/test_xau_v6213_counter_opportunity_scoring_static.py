"""
Regression tests for the v6.21.3 COUNTER_EXCURSION opportunity-scoring
redesign (owner rule, 2026-07-13): replaces the all-or-nothing
XAU_CounterExcursionFreshMicroConfirm() PASS/FAIL gate with a weighted
6-positive/2-negative factor score, plus shadow-outcome tracking for
skipped candidates.

Static-source tests, matching this repo's established convention.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.23.1.mq5"
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


SCORE_FN_SIG = "int XAU_CounterExcursionOpportunityScore(int counterDir, string &hardFailReason,"
ENTRY_FN_SIG = "void XAU_TryCounterExcursionEntry(int originalSignal, string setupName, string grade,"


def test_repo_source_is_synced_to_backend():
    assert read(EA) == read(BACKEND_EA)


def test_old_all_or_nothing_confirm_function_is_gone():
    ea = read(EA)
    assert "bool XAU_CounterExcursionFreshMicroConfirm" not in ea
    assert "int XAU_CounterExcursionOpportunityScore" in ea


# ---------------------------------------------------------------------------
# Mandatory hard-fails preserved; momentum/structure moved to scored factors
# ---------------------------------------------------------------------------

def test_mandatory_hard_fails_unchanged():
    fn = body(read(EA), SCORE_FN_SIG)
    assert '"NO_ATR"' in fn
    assert '"BUFFERS_NOT_READY"' in fn
    assert '"SPREAD_UNSAFE"' in fn
    assert '"INSUFFICIENT_ROOM"' in fn
    # each hard fail returns 0 immediately
    assert 'hardFailReason = "NO_ATR"; return 0;' in fn
    assert 'hardFailReason = "SPREAD_UNSAFE"; return 0;' in fn
    assert 'hardFailReason = "INSUFFICIENT_ROOM"; return 0;' in fn


def test_structure_reclaim_is_no_longer_a_hard_fail():
    fn = body(read(EA), SCORE_FN_SIG)
    assert '"ORIGINAL_STRUCTURE_ALREADY_RECLAIMED"' not in fn
    assert "hostileReversal = (breakBarsAgainstCounter >= MathMax(1, InpGoldPullbackConfirmBars));" in fn


def test_directional_opposition_eligibility_gate_untouched():
    ea = read(EA)
    entry_fn = body(ea, ENTRY_FN_SIG)
    # the mandatory "block reason proves real directional opposition" gate
    # (XAU_CounterExcursionEligible) still runs, unchanged, before scoring.
    eligible_idx = entry_fn.index("XAU_CounterExcursionEligible(")
    score_idx = entry_fn.index("XAU_CounterExcursionOpportunityScore(")
    assert eligible_idx < score_idx
    assert "if(!eligible) return;" in entry_fn[eligible_idx:score_idx]


# ---------------------------------------------------------------------------
# Scoring formula: 6 positive factors, 2 negative factors
# ---------------------------------------------------------------------------

def test_six_positive_and_two_negative_factors_present():
    fn = body(read(EA), SCORE_FN_SIG)
    for factor in ("m1Momentum", "m5Momentum", "displacement", "structureSupport",
                   "acceleration", "adverseExcursion", "overextension", "hostileReversal"):
        assert re.search(rf"\b{factor}\s*=", fn), f"missing factor assignment: {factor}"


def test_score_formula_matches_spec():
    fn = body(read(EA), SCORE_FN_SIG)
    formula_idx = fn.rindex("int score =")
    formula = fn[formula_idx:formula_idx + 400]
    for positive in ("m1Momentum", "m5Momentum", "displacement", "structureSupport", "acceleration", "adverseExcursion"):
        assert f"({positive} ? 1 : 0)" in formula
    for negative in ("overextension", "hostileReversal"):
        assert f"({negative} ? 1 : 0)" in formula
    # negatives must be subtracted, not added
    minus_count = len(re.findall(r"-\s*\(", formula))
    assert minus_count >= 2


def test_m1_and_m5_momentum_are_independently_computed():
    fn = body(read(EA), SCORE_FN_SIG)
    assert "PERIOD_M1" in fn
    assert "PERIOD_M5" in fn
    # M1 read must not depend on the M5 momentum score result (independence,
    # per owner spec: "Do not require M1 and M5 both to agree")
    m1_idx = fn.index("m1Momentum = isBuy")
    m5_idx = fn.index("m5Momentum = (m5Raw")
    # both assignments exist and neither is gated behind the other with &&
    assert "m5Momentum &&" not in fn
    assert "m1Momentum &&" not in fn


def test_minimum_score_input_exists_and_is_configurable():
    ea = read(EA)
    assert "input int    InpCounterOpportunityMinScore             = 2;" in ea


# ---------------------------------------------------------------------------
# Telemetry: COUNTER_OPPORTUNITY_SCORE fires for every scored candidate
# ---------------------------------------------------------------------------

def test_opportunity_score_log_fires_before_the_execute_skip_branch():
    fn = body(read(EA), ENTRY_FN_SIG)
    log_idx = fn.index("COUNTER_OPPORTUNITY_SCORE |")
    branch_idx = fn.index("if(!scorePassed)")
    assert log_idx < branch_idx, "COUNTER_OPPORTUNITY_SCORE must log before the execute/skip decision, not just on one branch"
    log_call = fn[fn.rindex("PrintFormat(", 0, log_idx):log_idx + 900]
    for field in ("candidateId", "originalDirection", "counterDirection", "blockReason",
                  "M1Momentum", "M5Momentum", "displacement", "structure", "acceleration",
                  "adverseExcursion", "overextension", "hostileReversal", "score=",
                  "minimumRequired", "decision="):
        assert field in log_call, f"COUNTER_OPPORTUNITY_SCORE missing field {field}"


def test_skip_registers_shadow_track_not_a_trade():
    fn = body(read(EA), ENTRY_FN_SIG)
    skip_idx = fn.index("if(!scorePassed)")
    skip_block = fn[skip_idx:skip_idx + 500]
    assert "XAU_RegisterCounterShadowTrack(" in skip_block
    assert "trade.Buy" not in skip_block
    assert "trade.Sell" not in skip_block
    assert "return;" in skip_block


# ---------------------------------------------------------------------------
# Shadow tracking is observation-only and never places an order
# ---------------------------------------------------------------------------

def test_shadow_manager_never_sends_an_order():
    ea = read(EA)
    manage_fn = body(ea, "void XAU_ManageCounterShadowTracks()")
    assert "trade.Buy" not in manage_fn
    assert "trade.Sell" not in manage_fn
    assert "OrderSend" not in manage_fn
    finalize_fn = body(ea, "void XAU_FinalizeCounterShadowTrack(int i)")
    assert "trade.Buy" not in finalize_fn
    assert "trade.Sell" not in finalize_fn


def test_shadow_manager_runs_unconditionally_from_ontick_like_rexit_core_loop():
    ea = read(EA)
    rexit_idx = ea.index("XAU_RExitCoreLoop();")
    shadow_idx = ea.index("XAU_ManageCounterShadowTracks();", rexit_idx)
    gap = ea[rexit_idx:shadow_idx]
    # must be close together, before any early-return gate, not buried deep
    # inside a conditional block
    assert gap.count("\n") < 15


def test_skipped_outcome_log_has_required_fields():
    ea = read(EA)
    finalize_fn = body(ea, "void XAU_FinalizeCounterShadowTrack(int i)")
    assert "COUNTER_SKIPPED_OUTCOME |" in finalize_fn
    for field in ("candidateId", "score", "R_30s", "R_60s", "R_120s", "R_300s",
                  "MFE_30m", "MAE_30m", "hit_0.2R_before_SL", "hit_0.3R_before_SL", "hit_0.5R_before_SL"):
        assert field in finalize_fn


def test_shadow_track_expires_after_configured_window():
    ea = read(EA)
    assert "input int    InpCounterShadowTrackMinutes              = 30;" in ea
    manage_fn = body(ea, "void XAU_ManageCounterShadowTracks()")
    assert "elapsed >= InpCounterShadowTrackMinutes * 60" in manage_fn
    assert "XAU_FinalizeCounterShadowTrack(i);" in manage_fn


def test_sl_hit_blocks_further_r_checkpoint_progress_in_shadow_track():
    # once slHitFirst is true, 0.2/0.3/0.5R hits must not be recorded from
    # noise after the hypothetical stop -- matches the counterfactual script's
    # own "reached_before_SL" semantics used to validate this redesign.
    fn = body(read(EA), "void XAU_ManageCounterShadowTracks()")
    assert "r >= 0.20 && !g_counterShadow[i].slHitFirst" in fn
    assert "r >= 0.30 && !g_counterShadow[i].slHitFirst" in fn
    assert "r >= 0.50 && !g_counterShadow[i].slHitFirst" in fn
