"""Static invariants for the audited XauCloud.io production promotion.

These tests guard source routing and authority boundaries. They complement,
but do not claim to replace, MetaEditor compilation or an MT5 real-tick replay.
"""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA_PATH = ROOT / "backend" / "ea_code" / "XauCloud.io.mq5"
EA = EA_PATH.read_text(encoding="utf-8")


def section(start: str, end: str) -> str:
    left = EA.index(start)
    right = EA.index(end, left)
    return EA[left:right]


def test_production_identity_and_v6263_lineage_are_explicit():
    assert EA_PATH.name == "XauCloud.io.mq5"
    assert '#property copyright "XauCloud by emriz.eth"' in EA
    assert '#define XAUAI_EA_VERSION "XauCloud-m10_v6.26.3_PATTERN_ENGINE_BREAKOUT_B_V4_AUDITED"' in EA
    assert '#define XAUAI_BUILD_HASH "pattern-engine-breakout-b-v4-audited-20260808"' in EA


def test_pattern_engine_participates_without_private_order_send_path():
    pattern = section("struct XAU_PatternEvidence", "void XAU_AssessFailureAndSweep")
    assert "XAU_EvaluatePatternEvidence()" in pattern
    assert "patternNet*1.40" in pattern
    assert "-22.0,22.0" in pattern
    assert "rawScore<=0.0 || dir==0 || dir==excludeDir" in pattern
    assert "dirPatternDelta/10.0,-2.2,2.2" in pattern
    assert "trade.Buy" not in pattern
    assert "trade.Sell" not in pattern
    assert "OrderSend" not in pattern

    m10 = section("XAU_M10SignalDecision XAU_EvaluateM10SignalDecision()", "void LogM10SignalAnalysis")
    scoring = section("int ScoreSetups(", "//+------------------------------------------------------------------+\n//| PYRAMID")
    assert "XAU_PatternEvidence patternEvidence=XAU_EvaluatePatternEvidence();" in m10
    assert "baseBuyCaseScore+d.patternBuyContribution" in m10
    assert "baseSellCaseScore+d.patternSellContribution" in m10
    assert "XAU_PatternEvidence setupPattern=XAU_EvaluatePatternEvidence();" in scoring
    assert scoring.count("XAU_ConsiderPatternSetupCandidate(") >= 9
    assert "Do not apply a\n   // second post-hoc adjustment" in scoring


def test_breakout_up_and_down_use_normal_canonical_pipeline():
    assert "InpOwnerBreakoutExecutionMode=OWNER_BREAKOUT_NORMAL" in EA
    authority = section("bool XAU_GlobalNoBreakoutAuthority", "bool XAU_RunNoBreakoutAndSnapshotSelfTests")
    assert "if(InpOwnerBreakoutExecutionMode==OWNER_BREAKOUT_NORMAL) return true;" in authority
    assert "No private breakout engine is added" in authority

    tick = section("void OnTick()", "//+------------------------------------------------------------------+\n//| OPEN TRADE")
    assert "XAU_EvaluateM10SignalDecision();" in tick
    assert "ScoreSetups(setupScore, setupName)" in tick
    assert "M10_CANDIDATE_ENDORSED" in tick
    assert "FinalEntryArbiter(" in tick
    assert "OpenTrade(" in tick


def test_outlook_explicit_sl_cannot_fall_through_to_normal_fixed_sl():
    open_trade = section("bool OpenTrade(", "void LogExit(")
    assert "if(explicitSL > 0.0)" in open_trade
    assert "sl = XAU_ClampGoldStopToMaxDistance(price, requestedOutlookSL, signal);" in open_trade
    assert "if(explicitSL <= 0.0)" in open_trade
    assert "OUTLOOK_SL_CAPPED_PRE_SEND" in open_trade
    assert "double confirmedOwnerSL = (explicitSL > 0.0)" in open_trade
    assert "? XAU_ClampGoldStopToMaxDistance(confirmedOpen, explicitSL, signal)" in open_trade
    assert "OUTLOOK_SL_INVALID_AT_EXECUTION" in open_trade


def test_broker_result_and_stop_modification_paths_fail_closed():
    open_trade = section("bool OpenTrade(", "void LogExit(")
    assert "XAU_ReconcileBrokerOpenTruth" in open_trade
    assert "XAU_BrokerOpenRetcodeAccepted" in open_trade
    assert "OWNER_R_EXIT_INITIAL_SL_UNCONFIRMED" in open_trade

    modify = section("bool SafeModifySL(", "double StrategyReferenceBalance()")
    assert "XAU_NormalizeToTick(newSL)" in modify
    assert "XAU_OwnerProtectedFloorAllowsModify" in modify
    assert "SYMBOL_TRADE_STOPS_LEVEL" in EA
    assert "SYMBOL_TRADE_FREEZE_LEVEL" in EA
    assert "trade.ResultRetcode()" in modify


def test_compatibility_identifiers_remain_intentionally_stable():
    assert '"XAU-SNIPER|ORIG=%s|EXEC=%s|REG=%s|INV=%s|%s"' in EA
    assert "InpMagicNumber" in EA
    assert 'InpAdaptiveTransitionPresetId       = "XAUUSD_AI_Sniper_EA_v6.24.1_ACTIVE.set"' in EA
