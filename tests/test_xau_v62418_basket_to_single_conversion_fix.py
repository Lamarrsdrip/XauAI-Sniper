from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def body_between(ea: str, start: str, end: str) -> str:
    return ea[ea.index(start): ea.index(end, ea.index(start))]


def test_authoritative_source_copies_synced():
    assert read(EA) == read(BACKEND_EA)


def test_basket_conversion_is_diagnostic_only_and_never_mutates_r_state():
    ea = read(EA)
    fn = body_between(
        ea,
        "string XAU_TryConvertBasketToSingleFloor(",
        "void XAU_CampaignRegisterClose(",
    )
    assert 'return "TELEMETRY_ONLY_NO_FLOOR_TRANSFER";' in fn
    assert "diagnostic" in ea
    assert "g_rExit[svIdx].guaranteedFloorR = convertedFloorROut" not in fn
    assert "g_rExit[svIdx].profitGuaranteeArmed = true" not in fn
    assert "XAU_RExit_EnsureIdx(" not in fn


def test_campaign_close_clears_legacy_basket_snapshot_and_keeps_leg_floor():
    ea = read(EA)
    fn = body_between(ea, "void XAU_CampaignRegisterClose(", "void XAU_CampaignInvalidate(")
    assert "KEEP_SURVIVOR_PER_LEG_OWNER_FLOOR" in fn
    assert "g_campaign[slot].basketProtectionArmed     = false;" in fn
    assert "g_campaign[slot].basketProtectedFloorMoney = 0.0;" in fn
    assert "g_campaign[slot].basketConversionPending    = false;" in fn
    assert "BASKET_FLOOR_KEPT_ARMED_PENDING_RETRY" not in fn


def test_restart_migration_discards_stale_single_leg_basket_floor():
    ea = read(EA)
    fn = body_between(ea, "void XAU_UpdateCampaignBasketState(", "string XAU_CampaignBasketDisplayJson(")
    migration = fn[: fn.index("if(!g_campaign[slot].active || g_campaign[slot].activePositionCount < 2)")]
    assert "basketConversionPending || g_campaign[slot].basketProtectionArmed" in migration
    assert "CLEAR_LEGACY_BASKET_TELEMETRY_KEEP_PER_LEG_OWNER_FLOOR" in migration
    assert "g_campaign[slot].basketProtectedFloorR     = 0.0;" in migration
    assert "g_rExit[" not in migration


def test_pyramid_leg_still_inherits_only_frozen_profile():
    ea = read(EA)
    pyramid = body_between(ea, "void CheckPyramidOpportunity()", "//+------------------------------------------------------------------+\n//| TICK")
    assert "int inheritedProfile=g_campaign[XAU_CampaignSlot(dir)].ownerExitProfile;" in pyramid
    assert "OWNER_R_EXIT_FLOOR_INHERITED" not in pyramid
    assert ".guaranteedFloorR =" not in pyramid


def test_basket_schema_remains_backward_readable_for_migration():
    ea = read(EA)
    assert "#define XAU_BASKET_STATE_SCHEMA_VERSION 6" in ea
    assert "bool     basketConversionPending;" in ea
    assert "int      basketConversionRetryCount;" in ea
