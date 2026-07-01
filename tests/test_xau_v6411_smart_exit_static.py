from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
EA_ROOT = ROOT / "XAUUSD_AI_Sniper_EA_v6.5.0.mq5"
EA_NAMED = ROOT / "XAUUSD_AI_Sniper_EA_v6.5.0.mq5"
EA_BACKEND = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_v6412_version_identity_and_synced_sources():
    root = read(EA_ROOT)
    backend = read(EA_BACKEND)
    named = read(EA_NAMED)

    assert root == backend == named
    assert '#property version   "6.500"' in root
    assert '#define XAUAI_EA_VERSION "v6.5.0"' in root
    assert '#define XAUAI_EA_VERSION_NUM "6.5.0"' in root


def test_smart_exit_state_machine_and_inputs_exist():
    ea = read(EA_ROOT)

    for token in (
        "XAU_SMART_EXIT_STATE",
        "XAU_SmartExitStateName",
        "LET_IT_WORK",
        "PROTECT_PROFIT",
        "HOLD_RUNNER",
        "GIVEBACK_WARNING",
        "SECOND_CHANCE_EXIT",
        "THESIS_BROKEN_EXIT",
        "CYCLE_DECAY_EXIT",
        "InpSmartExitEnable",
        "InpSmartExitStrongProfitUSD",
        "InpSmartExitStrongProfitEquityPct",
        "InpSmartExitPartialPct",
        "InpSmartExitPartialIgnoresCloudSafe",
        "InpSmartExitMinRetainUSD",
        "InpSmartExitWeakGivebackPct",
        "InpSmartExitNeutralGivebackPct",
        "InpSmartExitStrongGivebackPct",
        "InpSmartExitWeakLockPct",
        "InpSmartExitStrongLockPct",
        "InpSmartExitM15Confirm",
    ):
        assert token in ea


def test_smart_exit_layers_run_before_legacy_ampl_lock():
    ea = read(EA_ROOT)
    clean = ea[ea.index("bool ManageCleanExitsForPosition"):ea.index("// ============ PHASE 1: BREAKEVEN LOCK @ +1R ============")]

    assert "XAU_SmartExit3Layer(" in clean
    assert clean.index("XAU_SmartExit3Layer(") < clean.index("if(InpAMPL_Enable")
    assert "XAU_SmartExitAllowedGivebackPct" in ea
    assert "XAU_M5M15TrendClean" in ea
    assert "trade.PositionClosePartial" in ea
    assert "CleanMarkPartialTaken(ticket)" in ea


def test_strong_profit_cannot_fall_back_to_negative():
    ea = read(EA_ROOT)
    helper = ea[ea.index("bool XAU_SmartExit3Layer"):ea.index("//+------------------------------------------------------------------+\n//| v6.4.8")]

    assert "peak >= strongProfitUSD" in helper
    assert re.search(r"profitUSD\s*<=\s*0\.0", helper)
    assert "THESIS_BROKEN_EXIT" in helper
    assert "SafePositionClose(ticket" in helper
    assert "full giveback to red" in helper


def test_partial_runner_respects_trend_and_protected_stop():
    ea = read(EA_ROOT)
    helper = ea[ea.index("bool XAU_SmartExit3Layer"):ea.index("//+------------------------------------------------------------------+\n//| v6.4.8")]

    assert "runnerClean" in helper
    assert "floorUSD" in helper
    assert "lockPx" in helper
    assert "PositionClosePartial" in helper
    assert "InpSmartExitPartialIgnoresCloudSafe || !InpCloudSafeDisablePartials" in helper
    assert "HOLD_RUNNER" in helper
    assert "PROTECT_PROFIT" in helper


def test_smart_exit_is_in_hash_diagnostics_and_basket_logs():
    ea = read(EA_ROOT)
    input_hash = ea[ea.index("string XAUAI_InputHash()"):ea.index("string XAUAI_PostNewsStateName()")]
    diag = ea[ea.index("string XAUAI_DiagnosticsText()"):ea.index("void UpdateDashboard")]
    lifecycle = ea[ea.index("bool XAU_BasketLifecycleManager"):ea.index("//+------------------------------------------------------------------+\n//| v4.9.4")]

    assert "smartExit=" in input_hash
    for token in (
        "InpSmartExitEnable",
        "InpSmartExitStrongProfitUSD",
        "InpSmartExitPartialPct",
        "InpSmartExitWeakGivebackPct",
        "InpSmartExitStrongGivebackPct",
    ):
        assert token in input_hash

    assert "Smart exit:" in diag
    assert "GIVEBACK_WARNING BASKET" in lifecycle
    assert "SECOND_CHANCE_EXIT BASKET" in lifecycle
    assert "CYCLE_DECAY_EXIT BASKET" in lifecycle
