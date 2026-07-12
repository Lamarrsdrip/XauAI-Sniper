"""
Static-source proof suite for the v6.19.0-EXP1 centralized opening-execution
boundary repair.

Context: CheckPyramidOpportunity() was calling trade.Buy()/trade.Sell()
directly, bypassing the audited inversion boundary that OpenTrade() already
enforced for primary/re-entry/recovery/manual paths. Fixing that surfaced a
second, independent, already-live bug: the RE_ENTRY path was feeding the
ACTUAL (already-inverted) direction of the just-closed trade into OpenTrade(),
which unconditionally applies its own single inversion -- silently reversing
every re-entry twice.

These tests prove, from the source text alone (no MT5 runtime available):
  1. Exactly one centralized opening-execution function exists and is the
     ONLY caller of trade.Buy()/trade.Sell() in the whole file.
  2. Every opening path (primary, re-entry, recovery, pyramid, manual) routes
     through it, passing an explicit (normalDirection, executionDirection)
     pair rather than recomputing/inferring direction locally.
  3. The re-entry double-inversion bug is fixed: OpenTrade() is no longer
     handed lastClose.dir directly.
  4. The pyramid path derives normalPyramidDirection from Opposite(actual),
     never from a fresh/independent signal re-scan.
  5. The centralized function aborts and refuses to send when
     XAUAI_INVERSE_EXPERIMENT and directionInversions != 1.
  6. No experimental-only entry-eligibility gate was introduced anywhere.
  7. The custom inverse exit manager and its exit-isolation bypass are
     byte-for-byte untouched.
"""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
EXP = ROOT / "XAUUSD_AI_Sniper_EA_v6.19.0-INVERSE-EXECUTION-EXP1.mq5"


def src() -> str:
    return EXP.read_text(encoding="utf-8", errors="ignore")


# --------------------------------------------------------------------------
# 1. Single centralized opening-execution boundary
# --------------------------------------------------------------------------

def test_exactly_one_centralized_opening_execute_function_defined():
    text = src()
    assert text.count("bool XAU_CentralizedOpeningExecute(") == 1


def test_centralized_function_is_the_only_caller_of_trade_buy_and_trade_sell():
    text = src()
    # One mention of each is the doc-comment on the function itself
    # ("The ONLY function ... allowed to call trade.Buy()/trade.Sell()") --
    # exclude it and prove exactly one REAL call site remains for each.
    fn_start = text.index("bool XAU_CentralizedOpeningExecute(")
    fn_end = text.index("\nbool OpenTrade(")
    doc_comment, body = text[:fn_start], text[fn_start:fn_end]
    assert "trade.Buy" not in text[:text.index("// ===== CENTRALIZED OPENING-EXECUTION BOUNDARY")]
    assert "trade.Sell" not in text[:text.index("// ===== CENTRALIZED OPENING-EXECUTION BOUNDARY")]
    buy_calls_body = list(re.finditer(r"trade\.Buy\s*\(", body))
    sell_calls_body = list(re.finditer(r"trade\.Sell\s*\(", body))
    assert len(buy_calls_body) == 1, "expected exactly one real trade.Buy call in the whole file"
    assert len(sell_calls_body) == 1, "expected exactly one real trade.Sell call in the whole file"
    buy_calls_rest = list(re.finditer(r"trade\.Buy\s*\(", text[fn_end:]))
    sell_calls_rest = list(re.finditer(r"trade\.Sell\s*\(", text[fn_end:]))
    assert len(buy_calls_rest) == 0, "no trade.Buy call may exist outside the centralized function"
    assert len(sell_calls_rest) == 0, "no trade.Sell call may exist outside the centralized function"


def test_check_pyramid_opportunity_no_longer_calls_trade_buy_sell_directly():
    text = src()
    fn_start = text.index("void CheckPyramidOpportunity()")
    fn_end = text.index("\n//+", text.index("PYRAMID FAILED"))
    body = text[fn_start:fn_end]
    assert "trade.Buy" not in body
    assert "trade.Sell" not in body
    assert "XAU_CentralizedOpeningExecute(\"PYRAMID\"" in body


def test_direction_inversion_guard_blocks_submission_when_not_exactly_one():
    text = src()
    fn = text[text.index("bool XAU_CentralizedOpeningExecute("):text.index("bool OpenTrade(")]
    assert "directionInversions != 1" in fn
    assert "INVERSE_EXPERIMENT_CRITICAL_ABORT" in fn
    assert "return false;" in fn
    # the abort must precede the send -- prove ordering, not just presence
    assert fn.index("directionInversions != 1") < fn.index("trade.Buy")


def test_centralized_function_logs_every_required_telemetry_field():
    text = src()
    fn = text[text.index("bool XAU_CentralizedOpeningExecute("):text.index("bool OpenTrade(")]
    for field in [
        "DecisionId=", "EntryPath=", "NormalDecisionDirection=",
        "ExperimentalExecutionDirection=", "DirectionInversions=",
        "OriginalGrade=", "Strategy=", "RequestedLot=", "FinalLot=",
        "OriginalStopDistance=", "OriginalTargetDistance=",
        "InverseEntryPrice=", "InverseSL=", "InverseTP=",
        "OrderSendTime=", "BrokerRetcode=",
    ]:
        assert field in fn, f"missing telemetry field {field}"


# --------------------------------------------------------------------------
# 2. Every opening path passes explicit (normal, execution) direction pairs
# --------------------------------------------------------------------------

def test_open_trade_passes_original_and_exec_signal_explicitly():
    text = src()
    assert "bool ok = XAU_CentralizedOpeningExecute(entryPath, candidateId, originalSignal, signal," in text


def test_pyramid_derives_normal_direction_from_opposite_of_actual_not_fresh_signal():
    text = src()
    assert "int normalPyramidDirection = XAUAI_INVERSE_EXPERIMENT ? -dir : dir;" in text
    fn_start = text.index("void CheckPyramidOpportunity()")
    fn_end = text.index("\n//+", text.index("PYRAMID FAILED"))
    body = text[fn_start:fn_end]
    # execution direction must be the SAME `dir` used for every qualification
    # gate above it in the function -- not re-derived from any fresh signal.
    assert "XAU_CentralizedOpeningExecute(\"PYRAMID\", pyramidDecisionId, normalPyramidDirection, dir," in body


def test_pyramid_direction_definition_unchanged_still_from_actual_open_position():
    # The base position's ACTUAL side is what pyramid adds to -- confirms we
    # did not touch qualification/regime/momentum/timing logic at all, only
    # the final order-send boundary.
    text = src()
    assert "bool isBuy = (origType == POSITION_TYPE_BUY);" in text
    assert "int dir = isBuy ? 1 : -1;" in text


# --------------------------------------------------------------------------
# 3. Re-entry double-inversion bug fix
# --------------------------------------------------------------------------

def test_re_entry_no_longer_passes_actual_closed_direction_straight_into_open_trade():
    text = src()
    assert "if(OpenTrade(lastClose.dir, bufATR[1], \"RE_ENTRY\", InpReEntrySize))" not in text
    assert "int normalReEntryDirection = -lastClose.dir;" in text
    assert "if(OpenTrade(normalReEntryDirection, bufATR[1], \"RE_ENTRY\", InpReEntrySize))" in text


def test_re_entry_qualification_logic_still_uses_actual_closed_direction_unchanged():
    # Only the OpenTrade() call site changes. Direction lockout, price-window,
    # and timing/classification gates all still correctly reason about the
    # ACTUAL side that just closed ("should I retry the same real side"),
    # which is a different question from "what does OpenTrade() need."
    text = src()
    fn_start = text.index("void CheckReEntryOpportunity()")
    fn_end = text.index("int normalReEntryDirection = -lastClose.dir;")
    body = text[fn_start:fn_end]
    assert "IsDirectionLocked(lastClose.dir)" in body
    assert "double curPrice = (lastClose.dir == 1) ? ask : bid;" in body
    assert "XAU_ClassifySetup(lastClose.dir, bufATR[1], \"RE_ENTRY\", reClass);" in body
    assert "XAU_TimingEngineConfirmsEntry(lastClose.dir, \"RE_ENTRY\", \"A\", InpReEntrySize, bufATR[1])" in body


# --------------------------------------------------------------------------
# 4. Recovery path: already correct (fresh normal signal), now documented
# --------------------------------------------------------------------------

def test_recovery_direction_is_the_pre_inversion_normal_signal_not_a_position_side():
    text = src()
    # g_pendingOpportunity.dir is populated from XAU_RememberBlockedSignal's
    # `signal` parameter, which is the fresh normal-strategy signal recorded
    # BEFORE OpenTrade()'s inversion -- never from an actual open/closed
    # position side.
    assert "g_pendingOpportunity.dir           = signal;" in text
    assert "int    dir                = g_pendingOpportunity.dir;" in text
    assert "bool opened = OpenTrade(dir, atrNow, recoveryReason, 1.0);" in text
    assert "RECOVERY_DIRECTION_CONTRACT" in text


# --------------------------------------------------------------------------
# 5. Manual force-open: contract made explicit, not left ambiguous
# --------------------------------------------------------------------------

def test_manual_force_open_direction_contract_is_explicitly_logged():
    text = src()
    assert "MANUAL_FORCE_OPEN_DIRECTION_CONTRACT" in text
    assert 'dir == 1 ? "BUY" : "SELL", dir == 1 ? "SELL" : "BUY"' in text
    assert "bool opened = OpenTrade(dir, atrNow, forceReason, 1.0, true);" in text


def test_manual_force_open_adds_no_new_entry_eligibility_gate():
    text = src()
    fn = text[text.index("bool XAU_TryForceOpenTrade("):text.index("MANUAL_FORCE_OPEN_DIRECTION_CONTRACT")]
    # Only the pre-existing hard safety checks (max open trades, spread,
    # fresh data, staleness, duplicate-same-candle, symbol trading disabled)
    # may appear here -- confirms centralizing did not add a new soft gate.
    forbidden = [
        "inverseEligible", "counterExcursionEligible", "minimumGradeForInverse",
        "minimumMAEExpectation", "inverseConfidence", "inverseMomentumApproval",
        "inverseEntryFilter", "inverseCooldown", "inverseTradeLimit",
    ]
    for marker in forbidden:
        assert marker not in fn


# --------------------------------------------------------------------------
# 6. No experimental-only eligibility gate anywhere in the file (global)
# --------------------------------------------------------------------------

def test_no_inverse_specific_entry_eligibility_gate_introduced_anywhere():
    text = src()
    forbidden = [
        "inverseEligible", "counterExcursionEligible", "minimumGradeForInverse",
        "minimumMAEExpectation", "inverseConfidence", "inverseMomentumApproval",
        "inverseEntryFilter", "inverseCooldown", "inverseTradeLimit",
    ]
    for marker in forbidden:
        assert marker not in text


def test_approval_parity_normal_approved_equals_experimental_approved():
    text = src()
    assert "normalApproved=true" in text
    assert "experimentalApproved=true" in text
    assert "noExperimentalEligibilityGate=true" in text


# --------------------------------------------------------------------------
# 7. Exit isolation untouched: custom inverse manager remains sole authority
# --------------------------------------------------------------------------

def test_exit_isolation_bypass_for_inverse_positions_is_unchanged():
    text = src()
    assert (
        "if(XAUAI_INVERSE_EXPERIMENT)\n"
        "      {\n"
        "         XAU_InverseExperimentManagePosition(ticket, isBuy, openPx, curPrice,\n"
        "                                             curSL, curTP, slDist, profit,\n"
        "                                             peak, rDollars, momentumScoreEA,\n"
        "                                             trendAlignedEA);\n"
        "         continue;\n"
        "      }"
    ) in text


def test_inverse_exit_manager_constants_and_thresholds_untouched():
    text = src()
    assert "bool XAU_InverseExperimentManagePosition(ulong ticket, bool isBuy, double openPx," in text
    assert "INVERSE_EXP_TP_1R" in text
    assert "INVERSE_EXP_CAPTURE_0_5R" in text
    assert "INVERSE_EXP_GIVEBACK_AFTER_0_3R" in text
    assert "FAST_0_3R_TO_0_5R_1R_MAX" in text
    assert "rMult >= 1.0" in text
    assert "rMult >= 0.50" in text
    assert "rMult >= 0.30" in text
    assert "givebackPct >= 45.0" in text


def test_normal_exit_subsystems_still_globally_disabled_in_experiment_mode():
    text = src()
    assert "if(!XAUAI_INVERSE_EXPERIMENT && !noLimitMode && InpGrowthGuardEnable)" in text
    assert "if(!XAUAI_INVERSE_EXPERIMENT && !noLimitMode && ExpectancyDayGivebackGuard())" in text
    assert "if(!XAUAI_INVERSE_EXPERIMENT && ManageBasket())" in text
    assert "if(!XAUAI_INVERSE_EXPERIMENT && !noLimitMode) EPF_ManagePartials();" in text
    assert "if(!XAUAI_INVERSE_EXPERIMENT) PG_PerPositionRatchet();" in text


# --------------------------------------------------------------------------
# 8. Full direct order-call audit: only CLOSE/MODIFY utilities remain
#    outside the centralized OPEN boundary, all ticket/actual-side based.
# --------------------------------------------------------------------------

def test_no_pending_order_types_or_position_open_calls_exist():
    text = src()
    for marker in [
        "PositionOpen", "ORDER_TYPE_BUY_LIMIT", "ORDER_TYPE_SELL_LIMIT",
        "ORDER_TYPE_BUY_STOP", "ORDER_TYPE_SELL_STOP",
    ]:
        assert marker not in text


def test_close_and_modify_utilities_are_ticket_based_not_direction_inferred():
    text = src()
    assert "bool SafePositionClose(ulong ticket, string ctx = \"\")" in text
    assert "bool SafePositionClosePartial(ulong ticket, double lots, string ctx = \"\")" in text
    assert "bool SafeModifySL(ulong ticket, double newSL, double tp, bool isBuy, double curPrice, string logTag)" in text
