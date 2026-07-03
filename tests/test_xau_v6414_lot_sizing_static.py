from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.13.0.mq5"
EA_BACKEND = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path):
    return path.read_text(encoding="utf-8", errors="ignore")


def section(text, start, end):
    return text[text.index(start):text.index(end, text.index(start))]


def test_v6414_identity_and_synced_backend():
    ea = read(EA)
    assert '#property version   "6.130"' in ea
    assert '#define XAUAI_EA_VERSION "v6.13.0"' in ea
    assert read(EA) == read(EA_BACKEND)


def test_memory_reducer_has_context_aware_floor_for_a_plus_htf_consensus():
    ea = read(EA)
    assert "InpMemoryAPlusHTFMinLotMulti" in ea
    assert "InpMemoryExactEvidenceMinSamples" in ea
    assert "XAU_MemoryLotFloorForContext" in ea
    memory = section(ea, "bool XAU_MemoryRecommendation", "void XAU_PostTradeConsciousAnalysis")
    assert "XAU_MemoryLotFloorForContext" in memory
    assert "exactEvidence" in memory
    assert "htfConsensus" in memory
    assert "broad aggregate memory" in memory
    assert "lotMulti = MathMax(lotMulti, memoryFloor)" in memory


def test_open_trade_logs_full_lot_sizing_audit_and_no_micro_collapse_reason():
    ea = read(EA)
    open_trade = section(ea, "void OpenTrade", "void LogExit")
    for token in [
        "LOT-SIZING-AUDIT",
        "Base risk percent",
        "Account balance",
        "SL distance",
        "ATR",
        "Raw calculated lot",
        "Broker min/max/step",
        "Risk-math lot",
        "Volatility multiplier",
        "AI confidence multiplier",
        "Strategy/grade multiplier",
        "Recovery/drawdown multiplier",
        "Growth Guard cap",
        "Basket cap",
        "Final lot",
        "microCollapseReason",
    ]:
        assert token in open_trade


def test_lot_math_uses_nearest_safe_step_for_non_excessive_risk_rounding():
    ea = read(EA)
    assert "XAU_NormalizeVolumeForRisk" in ea
    helper = section(ea, "double XAU_NormalizeVolumeForRisk", "double XAU_ProjectProfitUSD")
    assert "MathRound" in helper
    assert "riskOvershootPct" in helper
    assert "InpLotStepMaxRiskOvershootPct" in helper
    assert "MathFloor" in helper

