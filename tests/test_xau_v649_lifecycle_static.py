from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
EA_ROOT = ROOT / "XAUUSD_AI_Sniper_EA_v6.6.0.mq5"
EA_NAMED = ROOT / "XAUUSD_AI_Sniper_EA_v6.6.0.mq5"
EA_BACKEND = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_v6412_has_clear_version_identity_and_named_source():
    root = read(EA_ROOT)
    backend = read(EA_BACKEND)
    named = read(EA_NAMED)

    assert root == backend == named
    assert '#property version   "6.600"' in root
    assert '#define XAUAI_EA_VERSION "v6.6.0"' in root
    assert '#define XAUAI_EA_VERSION_NUM "6.6.0"' in root


def test_basket_lifecycle_inputs_and_state_exist():
    ea = read(EA_ROOT)

    for token in (
        "InpTradeLifecycleEnable",
        "InpLifecyclePeakMinUSD",
        "InpLifecycleSecondChanceMinUSD",
        "InpLifecycleSecondChancePeakPct",
        "InpLifecycleMaxProfitLossCycles",
        "InpLifecycleAdverseAfterProfitPct",
        "InpLifecycleMaxMinutesAfterPeak",
        "g_basketProfitToLossSeen",
        "g_basketProfitLossCycles",
        "g_basketWasPositiveAfterPeak",
        "g_basketPeakTime",
        "g_basketLastLifecycleLog",
        "XAU_ResetBasketLifecycle",
        "XAU_BasketLifecycleManager",
    ):
        assert token in ea


def test_basket_lifecycle_catches_191_peak_recovery_case():
    ea = read(EA_ROOT)
    basket = ea[ea.index("bool ManageBasket()"):ea.index("//+------------------------------------------------------------------+\n//| v5.8.3")]
    lifecycle = ea[ea.index("bool XAU_BasketLifecycleManager"):ea.index("//+------------------------------------------------------------------+\n//| v4.9.4")]

    assert "XAU_BasketLifecycleManager(totalPnL" in basket
    assert basket.index("XAU_BasketLifecycleManager(totalPnL") < basket.index("// ============ v4.9.7 SMART GUARDS")
    assert "g_basketPeakUSD < lifecyclePeakMin" in lifecycle
    assert "SECOND_CHANCE_PROFIT_EXIT" in lifecycle
    assert "PROFIT_TO_LOSS_WARNING" in lifecycle
    assert "CYCLE_DECAY_EXIT" in lifecycle
    assert "HOLD_REASON_REQUIRED" in lifecycle
    assert "CONTINUATION_HOLD_PROTECTED" in lifecycle
    assert "CONTINUATION_HOLD_REJECTED" in lifecycle
    assert re.search(r"totalPnL\s*<=\s*0\.0", lifecycle)
    assert re.search(r"totalPnL\s*>=\s*secondChanceUSD", lifecycle)


def test_lifecycle_is_included_in_input_hash_and_diagnostics():
    ea = read(EA_ROOT)
    input_hash = ea[ea.index("string XAUAI_InputHash()"):ea.index("string XAUAI_PostNewsStateName()")]
    diag = ea[ea.index("string XAUAI_DiagnosticsText()"):ea.index("void UpdateDashboard")]

    assert "lifecycle=" in input_hash
    for token in (
        "InpTradeLifecycleEnable",
        "InpLifecyclePeakMinUSD",
        "InpLifecycleSecondChanceMinUSD",
        "InpLifecycleSecondChancePeakPct",
        "InpLifecycleMaxProfitLossCycles",
        "InpLifecycleAdverseAfterProfitPct",
        "InpLifecycleMaxMinutesAfterPeak",
    ):
        assert token in input_hash

    assert "Trade lifecycle:" in diag
    assert "Profit/loss cycles:" in diag


def test_open_basket_peak_is_reconstructed_after_reload():
    ea = read(EA_ROOT)
    helper = ea[ea.index("double XAU_ReconstructOpenBasketPeakUSD"):ea.index("bool XAU_BasketLifecycleManager")]
    basket = ea[ea.index("bool ManageBasket()"):ea.index("//+------------------------------------------------------------------+\n//| v5.8.3")]

    assert "CopyLow(Symbol(), PERIOD_M5" in helper
    assert "CopyHigh(Symbol(), PERIOD_M5" in helper
    assert "POSITION_TYPE_BUY" in helper
    assert "POSITION_TYPE_SELL" in helper
    assert "mixed direction" in helper
    assert "PEAK_PROFIT_REACHED BASKET | reconstructed=Y" in basket
    assert "XAU_ReconstructOpenBasketPeakUSD(totalPnL)" in basket
    assert basket.index("XAU_ReconstructOpenBasketPeakUSD(totalPnL)") < basket.index("if(totalPnL > g_basketPeakUSD)")
