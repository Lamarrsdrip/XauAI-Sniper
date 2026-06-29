from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
EA_ROOT = ROOT / "XAUUSD_AI_Sniper_EA_v6.4.6.mq5"
EA_BACKEND = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_v6411_version_and_backend_copy_match():
    root = read(EA_ROOT)
    backend = read(EA_BACKEND)

    assert root == backend
    assert '#property version   "6.4.11"' in root
    assert '#define XAUAI_EA_VERSION "v6.4.11"' in root
    assert '#define XAUAI_EA_VERSION_NUM "6.4.11"' in root
    assert '#define XAUAI_BUILD_HASH "v6411-smart-exit-3layer-20260630"' in root


def test_protected_peak_floor_inputs_helpers_and_logs_exist():
    ea = read(EA_ROOT)

    for token in (
        "InpProtectedPeakFloorEnable",
        "InpProtectedPeakMinUSD",
        "InpProtectedPeakLockPct",
        "InpProtectedPeakMinRetainUSD",
        "InpProtectedPeakGivebackExitPct",
        "InpProtectedPeakCloseOnFloorBreak",
        "InpProtectedPeakBasketCloseRed",
        "XAU_ProtectPeakProfitFloor",
        "XAU_CurrentSLLockUSD",
        "XAU_ClearProfitFloor",
        "PEAK_PROFIT_REACHED",
        "PROFIT_FLOOR_SET",
        "CONTINUATION_HOLD_WITH_PROTECTION",
        "CONTINUATION_EXIT_PROFIT_PROTECTED",
        "GIVEBACK_LIMIT_TRIGGERED",
    ):
        assert token in ea


def test_protected_peak_floor_runs_before_ai_hold_and_clean_exits():
    ea = read(EA_ROOT)
    manage = ea[ea.index("void ManagePositions()"):ea.index("// v4.7.3/v4.7.4 — TP AUTO-EXTEND")]

    assert manage.index("XAU_ProtectPeakProfitFloor") < manage.index("CheckPositionWithAI")
    assert manage.index("XAU_ProtectPeakProfitFloor") < manage.index("ManageCleanExitsForPosition")
    assert "AI DIRECTOR EXIT HOLD" in manage


def test_floor_break_can_close_even_when_continuation_wants_to_hold():
    ea = read(EA_ROOT)
    helper = ea[ea.index("bool XAU_ProtectPeakProfitFloor"):ea.index("//+------------------------------------------------------------------+\n//| v4.9.4 — BASKET PROTECT")]

    assert re.search(r"profit\s*<=\s*floorUSD", helper)
    assert re.search(r"givebackPct\s*>=\s*InpProtectedPeakGivebackExitPct", helper)
    assert "trade.PositionClose(ticket)" in helper
    assert "lastExitReason = StringFormat(\"CONTINUATION_EXIT_PROFIT_PROTECTED" in helper
    assert "trendAligned" in helper and "momentumScore" in helper


def test_basket_protection_no_longer_breathes_red_after_meaningful_peak():
    ea = read(EA_ROOT)
    basket = ea[ea.index("bool ManageBasket()"):ea.index("//+------------------------------------------------------------------+\n//| v5.8.3 — CLEAN EXITS")]

    assert "InpProtectedPeakBasketCloseRed" in basket
    assert "BASKET_LOCK_BREATHE" in basket
    assert "CONTINUATION_EXIT_PROFIT_PROTECTED BASKET" in basket
    assert "GIVEBACK_LIMIT_TRIGGERED BASKET" in basket
    assert re.search(r"totalPnL\s*<=\s*0\s*&&\s*InpProtectedPeakBasketCloseRed", basket)


def test_input_hash_includes_protected_profit_floor_settings():
    ea = read(EA_ROOT)
    input_hash = ea[ea.index("string XAUAI_InputHash()"):ea.index("string XAUAI_PostNewsStateName()")]

    assert "protectedPeak=" in input_hash
    for token in (
        "InpProtectedPeakFloorEnable",
        "InpProtectedPeakMinUSD",
        "InpProtectedPeakLockPct",
        "InpProtectedPeakMinRetainUSD",
        "InpProtectedPeakGivebackExitPct",
        "InpProtectedPeakCloseOnFloorBreak",
        "InpProtectedPeakBasketCloseRed",
    ):
        assert token in input_hash
