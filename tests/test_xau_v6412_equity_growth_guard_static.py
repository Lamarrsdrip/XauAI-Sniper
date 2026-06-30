from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
EA_ROOT = ROOT / "XAUUSD_AI_Sniper_EA_v6.4.6.mq5"
EA_NAMED = ROOT / "XAUUSD_AI_Sniper_EA_v6.4.14.mq5"
EA_BACKEND = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def section(ea: str, start: str, end: str) -> str:
    return ea[ea.index(start):ea.index(end, ea.index(start))]


def test_v6412_version_identity_and_synced_sources():
    root = read(EA_ROOT)
    backend = read(EA_BACKEND)
    named = read(EA_NAMED)

    assert root == backend == named
    assert '#property version   "6.4.14"' in root
    assert '#define XAUAI_EA_VERSION "v6.4.14"' in root
    assert '#define XAUAI_EA_VERSION_NUM "6.4.14"' in root
    assert '#define XAUAI_BUILD_HASH "v6414-lot-sizing-audit-20260630"' in root


def test_xau_money_conversion_uses_order_calc_profit_not_raw_tick_value():
    ea = read(EA_ROOT)

    assert "double XAU_MoneyPerLotForDistance" in ea
    assert "double XAU_ProjectProfitUSD" in ea

    money_helper = section(ea, "double XAU_MoneyPerLotForDistance", "double RiskPerLotForDistance")
    assert "OrderCalcProfit" in money_helper
    assert "ORDER_TYPE_BUY" in money_helper
    assert "ORDER_TYPE_SELL" in money_helper
    assert "SYMBOL_TRADE_CONTRACT_SIZE" in money_helper

    risk_helper = section(ea, "double RiskPerLotForDistance", "double CurrentAggregateRiskToSL")
    assert "XAU_MoneyPerLotForDistance(dist)" in risk_helper
    assert "SYMBOL_TRADE_TICK_VALUE" not in risk_helper
    assert "SYMBOL_TRADE_TICK_SIZE" not in risk_helper

    aggregate_helper = section(ea, "double CurrentAggregateRiskToSL", "string SetupNameFromType")
    assert "XAU_ProjectProfitUSD(" in aggregate_helper
    assert "SYMBOL_TRADE_TICK_VALUE" not in aggregate_helper
    assert "SYMBOL_TRADE_TICK_SIZE" not in aggregate_helper


def test_growth_guard_inputs_and_daily_profit_lock_exist():
    ea = read(EA_ROOT)

    for token in (
        "InpGrowthGuardEnable",
        "InpGrowthMaxTradeLossEquityPct",
        "InpGrowthMaxBasketLossEquityPct",
        "InpGrowthBadEntryMaxMinutes",
        "InpGrowthBadEntryAdverseATR",
        "InpGrowthBadEntryLossEquityPct",
        "InpGrowthMinEntryRR",
        "InpGrowthPreferEntryRR",
        "InpGrowthDailyLockArmPct",
        "InpGrowthDailyLockGivebackPct",
        "InpGrowthDailyStrongLockArmPct",
        "InpGrowthDailyStrongLockPct",
        "InpGrowthOversizeLossPauseMin",
        "InpGrowthConsecutiveLossPauseMin",
        "InpGrowthLossAfterWinPauseMin",
        "InpGrowthRequireProtectedBaseForPyramid",
        "InpGrowthBlockRecoveryReEntryAfterSL",
        "g_growthPauseUntil",
        "g_growthDailyPeakProfit",
        "g_growthLossStreak",
        "g_growthLastWinProfit",
    ):
        assert token in ea


def test_open_trade_blocks_bad_rr_and_caps_lots_using_real_money():
    ea = read(EA_ROOT)
    open_trade = section(ea, "void OpenTrade", "void XAU_AppendTradeBrain")

    assert "XAU_GrowthGuardEntryBlockReason" in open_trade
    assert "GROWTH_RR_BLOCK" in open_trade
    assert "InpGrowthMinEntryRR" in open_trade
    assert "RiskPerLotForDistance(slDist)" in open_trade
    assert "XAU_ProjectProfitUSD(signal == 1" in open_trade
    assert "slDollarPerLotRaw = RiskPerLotForDistance(slDist)" in open_trade
    assert "XAU_GrowthGuardCapLots" in open_trade
    assert "(slDist / tickSize) * tickValue" not in open_trade


def test_loss_exit_runs_before_ai_and_clean_exit_can_cut_fast_bad_entries():
    ea = read(EA_ROOT)
    manage = section(ea, "void ManagePositions()", "// v4.7.3/v4.7.4")

    assert "XAU_GrowthGuardManagePosition" in manage
    assert manage.index("XAU_GrowthGuardManagePosition") < manage.index("XAU_ProtectPeakProfitFloor")
    assert manage.index("XAU_GrowthGuardManagePosition") < manage.index("AI DIRECTOR")

    loss_guard = section(ea, "bool XAU_GrowthGuardManagePosition", "bool XAU_GrowthGuardCanPyramid")
    assert "BAD_ENTRY_EMERGENCY_EXIT" in loss_guard
    assert "THESIS_BROKEN_EXIT" in loss_guard
    assert "GROWTH_HARD_LOSS_EXIT" in loss_guard
    assert "InpGrowthBadEntryMaxMinutes" in loss_guard
    assert "InpGrowthMaxTradeLossEquityPct" in loss_guard
    assert "InpGrowthMaxBasketLossEquityPct" in loss_guard
    assert "trade.PositionClose(ticket)" in loss_guard


def test_pyramid_and_reentry_are_blocked_until_base_or_thesis_is_clean():
    ea = read(EA_ROOT)
    pyramid = section(ea, "void CheckPyramidOpportunity()", "//+------------------------------------------------------------------+\n//| OPEN TRADE")
    reentry = section(ea, "void CheckReEntryOpportunity()", "//+------------------------------------------------------------------+\n//| SMC ENTRY LAYER")

    assert "XAU_GrowthGuardCanPyramid" in pyramid
    assert "GROWTH_PYRAMID_BLOCK" in ea
    assert "baseProtected" in pyramid
    assert "recoveryLikely" in pyramid
    assert "InpGrowthRequireProtectedBaseForPyramid" in ea

    assert "XAU_GrowthGuardReEntryAllowed" in reentry
    assert "GROWTH_REENTRY_BLOCK" in ea
    assert "InpGrowthBlockRecoveryReEntryAfterSL" in ea
    assert reentry.index("XAU_GrowthGuardReEntryAllowed") < reentry.index("OpenTrade(")


def test_closed_trade_updates_growth_pause_and_daily_lock_state():
    ea = read(EA_ROOT)
    cooldown = section(ea, "void RegisterClosedTradeCooldown", "// +------------------------------------------------------------------+\n// | v6.0.1")
    input_hash = section(ea, "string XAUAI_InputHash()", "string XAUAI_PostNewsStateName()")

    assert "XAU_GrowthGuardOnClosedTrade(wasWin, wasLoss, profit)" in cooldown
    assert "GROWTH_OVERSIZE_LOSS_PAUSE" in ea
    assert "GROWTH_CONSEC_LOSS_PAUSE" in ea
    assert "GROWTH_LOSS_AFTER_WIN_PAUSE" in ea
    assert "XAU_GrowthGuardEntryBlockReason" in ea
    assert re.search(r"dayProfit\s*<=\s*g_growthDailyPeakProfit\s*-\s*lockGivebackUSD", ea)

    assert "growthGuard=" in input_hash
    for token in (
        "InpGrowthGuardEnable",
        "InpGrowthMaxTradeLossEquityPct",
        "InpGrowthMinEntryRR",
        "InpGrowthDailyLockArmPct",
        "InpGrowthRequireProtectedBaseForPyramid",
    ):
        assert token in input_hash
