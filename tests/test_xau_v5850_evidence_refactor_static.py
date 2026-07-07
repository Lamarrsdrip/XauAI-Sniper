from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
EA = (ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5").read_text()


def test_prop_firm_reference_balance_owns_strategy_budgets():
    assert "double StrategyReferenceBalance()" in EA
    assert "PROP_MODE_ON" in EA
    assert "PropReferenceBalance=" in EA
    assert "LotCalculatedFrom=PROP_REFERENCE_BALANCE" in EA
    assert "ProfitTargetCalculatedFrom=PROP_REFERENCE_BALANCE" in EA
    assert "DrawdownLimitCalculatedFrom=PROP_REFERENCE_BALANCE" in EA
    assert "ExitTargetCalculatedFrom=PROP_REFERENCE_BALANCE" in EA

    assert "double bal = StrategyReferenceBalance();" in EA[EA.index("void RecomputeAutoScale()"):]
    assert "double equity = StrategyReferenceBalance();" in EA[EA.index("double AccountSizeRiskMultiplier()"):]
    # v6.17.7: OpenTrade changed from void to bool (item 4) -- landmark updated.
    assert "double balance = StrategyReferenceBalance();" in EA[EA.index("bool OpenTrade("):]
    assert "double bal = StrategyReferenceBalance();" in EA[EA.index("bool ManageBasket()"):]
    assert "double propReference = StrategyReferenceBalance();" in EA
    assert "g_propFirmAccountStartEquity - equity" in EA


def test_real_equity_still_owns_emergency_prop_firm_survival_lock():
    start = EA.index("string PropFirmLossLockReason()")
    body = EA[start : start + 4200]
    assert "double equity = accInfo.Equity();" in body
    assert "g_propFirmAccountStartEquity - equity" in body
    assert "dailyLossUSD / propReference" in body
    assert "totalLossUSD / propReference" in body


def test_a_plus_requires_timing_and_positioning_not_confirmation_alone():
    assert "bool XAU_APlusPositioningQualified(" in EA
    timing_start = EA.index("bool XAUEntryTimingGuard")
    timing_body = EA[timing_start:]
    assert "XAU_APlusPositioningQualified(" in timing_body
    assert "A+ EVIDENCE DEMOTION" in timing_body
    assert 'grade = "A";' in timing_body
    demotion_start = timing_body.index("if(aPlusBadTiming)")
    demotion_end = timing_body.index("if(wasAPlus && postSweepTrap", demotion_start)
    demotion = timing_body[demotion_start:demotion_end]
    assert "return false" not in demotion


def test_two_losses_trigger_five_hour_cooldown_without_profit_guardian_dependency():
    assert re.search(r"InpTwoLossCooldownMin\s*=\s*300", EA)
    assert "RegisterClosedTradeCooldown(" in EA
    tx_start = EA.index("void OnTradeTransaction")
    tx_body = EA[tx_start : tx_start + 10000]
    assert "RegisterClosedTradeCooldown(wasWin, wasLoss, profit);" in tx_body

    block_start = EA.index("string PG_BlockReason")
    block_body = EA[block_start : block_start + 5000]
    cooldown_pos = block_body.index("pg_pauseUntil")
    guardian_return_pos = block_body.index("if(!InpProfitGuardian) return")
    assert cooldown_pos < guardian_return_pos
    assert "COOLDOWN_ACTIVE" in EA
    assert "PauseUntil=" in EA


def test_legacy_profit_halt_is_time_limited_not_until_tomorrow():
    assert "NO NEW ENTRIES until tomorrow" not in EA
    assert "PROFIT-LOCK COOLDOWN" in EA
    assert "InpProfitLockCooldownMin = 300" in EA


def test_context_gate_uses_cached_indicator_handles():
    # v5.9.0+ caches HTF EMA handles via static locals (hF_ctx/hS_ctx).
    # Handles are released only when the context TF changes, not on every tick.
    start = EA.index("bool ContextGateAllows")
    body = EA[start : EA.index("string PropFirmBaselineKey", start)]
    assert "hF_ctx" in body
    assert "hS_ctx" in body
    assert "IndicatorRelease(hF_ctx)" in body
    assert "IndicatorRelease(hS_ctx)" in body


def test_version_is_current_release():
    assert "v6.4.21" in EA
    assert '\\"ea_version\\":\\"%s\\"' in EA


def test_forensic_growth_audit_logs_entry_size_and_close_diagnosis():
    assert "TRADE-BRAIN AUDIT" in EA
    assert "XAU_AppendTradeBrain(\"OPEN\"" in EA
    assert "XAU_AppendTradeBrain(\"CLOSE\"" in EA
    assert "XAU_AppendTradeBrain(\"POST_CLOSE\"" in EA
    assert "worstFloating" in EA
    assert "givebackPct" in EA


def test_trade_brain_blocks_negative_expectancy_even_when_win_rate_is_not_extreme():
    body = EA[EA.index("bool XAU_TradeBrainPreEntry"):EA.index("void XAU_AppendBlockedMemory")]
    assert "pf < InpTradeBrainMinPF" in body
    assert "poorEntryQuality" in body
    assert "TRADE-BRAIN BLOCK: similar executed trades have poor proven expectancy" in body
