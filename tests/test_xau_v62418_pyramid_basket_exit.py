from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def body_between(ea: str, start: str, end: str) -> str:
    start_idx = ea.index(start)
    return ea[start_idx: ea.index(end, start_idx)]


def test_authoritative_ea_copies_are_identical():
    assert read(EA) == read(BACKEND_EA)


def test_basket_telemetry_requires_at_least_two_positions():
    ea = read(EA)
    fn = body_between(ea, "void XAU_UpdateCampaignBasketState(", "string XAU_CampaignBasketDisplayJson(")
    assert "if(!g_campaign[slot].active || g_campaign[slot].activePositionCount < 2)" in fn
    assert "single-position campaigns use the individual exit floor" in fn


def test_basket_one_r_is_fixed_from_core_and_not_redefined_by_add():
    ea = read(EA)
    assert "g_campaign[slot].basketOneRMoney           = coreMoneyRiskUSD;" in ea
    add = body_between(ea, "void XAU_CampaignRegisterAdd(", "string XAU_TryConvertBasketToSingleFloor(")
    assert "basketOneRMoney" not in add


def test_basket_uses_canonical_owner_floor_calculation_for_telemetry():
    ea = read(EA)
    fn = body_between(ea, "void XAU_UpdateCampaignBasketState(", "string XAU_CampaignBasketDisplayJson(")
    assert "XAU_ComputeOwnerRequiredFloorR(g_campaign[slot].basketPeakR, basketOwnerProfile)" in fn
    assert "desiredFloorR = MathMax(basketExistingValidFloorR, basketOwnerRequiredFloorR)" in fn


def test_basket_floor_trigger_is_telemetry_and_cannot_close():
    ea = read(EA)
    fn = body_between(ea, "void XAU_UpdateCampaignBasketState(", "string XAU_CampaignBasketDisplayJson(")
    trigger = fn[fn.index("if(triggerClose)"):]
    assert "legacy_authority=BASKET_FLOOR" in trigger
    assert "action=NO_BASKET_CLOSE" in trigger
    assert "XAU_CloseCampaignBasketAtProtectedFloor(" not in trigger


def test_individual_owner_floor_keeps_running_in_multi_leg_campaign():
    ea = read(EA)
    fn = body_between(ea, "void XAU_RExitCoreLoop()", "void ManagePositions()")
    basket = fn[fn.index("if(basketModeActive)"): fn.index("if(currentR >= InpRFinalTarget)")]
    assert "OWNER_R_EXIT_CAMPAIGN_INHERITANCE" in basket
    assert "continue;" not in basket
    assert "XAU_ComputePrimaryExitFloor(" in fn


def test_legacy_coordinated_basket_close_is_not_used_by_profit_floor_telemetry():
    ea = read(EA)
    assert ea.count("XAU_CloseCampaignBasketAtProtectedFloor(") == 2
    assert 'XAU_CloseCampaignBasketAtProtectedFloor(oppositeDirection, "DIRECTION_EXCLUSIVITY_PROFITABLE_CLOSE_FIRST")' in ea


def test_new_pyramid_does_not_reset_campaign_peak_or_floor():
    ea = read(EA)
    add = body_between(ea, "void XAU_CampaignRegisterAdd(", "string XAU_TryConvertBasketToSingleFloor(")
    assert "basketPeakProfitMoney" not in add
    assert "basketProtectedFloorMoney" not in add
    assert "basketProtectionArmed" not in add


def test_pyramid_add_rejection_near_telemetry_floor_is_preserved():
    ea = read(EA)
    assert "PYRAMID_ADD_REJECTED_BASKET_FLOOR_AT_RISK" in ea
    assert "PYRAMID_ADD_REJECTED_BASKET_CLOSE_IN_PROGRESS" in ea


def test_pyramid_broker_tp_is_restored():
    ea = read(EA)
    assert 'trade.Buy(addLot,Symbol(),0,pyramidSL,pyramidTP,"XAU-SNIPER|"+why)' in ea
    assert 'trade.Sell(addLot,Symbol(),0,pyramidSL,pyramidTP,"XAU-SNIPER|"+why)' in ea


def test_basket_to_single_does_not_transfer_campaign_floor():
    ea = read(EA)
    conversion = body_between(ea, "string XAU_TryConvertBasketToSingleFloor(", "void XAU_CampaignRegisterClose(")
    assert 'return "TELEMETRY_ONLY_NO_FLOOR_TRANSFER";' in conversion
    assert ".guaranteedFloorR = convertedFloorROut" not in conversion


def test_basket_pl_includes_swap_and_commission():
    ea = read(EA)
    fn = body_between(ea, "void XAU_UpdateCampaignBasketState(", "string XAU_CampaignBasketDisplayJson(")
    assert "posInfo.Profit() + posInfo.Swap() + posInfo.Commission()" in fn


def test_command_center_still_reports_basket_telemetry():
    ea = read(EA)
    assert '"\\"pyramid_basket\\":{\\"buy\\":%s,\\"sell\\":%s},"' in ea
    display = body_between(ea, "string XAU_CampaignBasketDisplayJson(", "//+------------------------------------------------------------------+")
    for field in (
        "exit_mode", "campaign_id", "core_ticket", "position_count",
        "basket_one_r_money", "basket_current_pl", "basket_current_r",
        "basket_peak_pl", "basket_peak_r", "protected_floor_r",
    ):
        assert field in display
