from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "backend" / "ea_code" / "XauCloud-Pips.mq5"


def source() -> str:
    return EA.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def function(text: str, signature: str) -> str:
    start = text.index(signature)
    opening = text.index("{", start)
    depth = 0
    for index in range(opening, len(text)):
        if text[index] == "{":
            depth += 1
        elif text[index] == "}":
            depth -= 1
            if depth == 0:
                return text[start:index + 1]
    raise AssertionError("unbalanced function")


def test_pips_build_has_an_isolated_identity_and_keeps_the_hard_stop_cap():
    text = source()
    assert 'XauCloud-Pips_v6.27.0_SMART_PROFIT' in text
    assert 'input int    InpMagicNumber    = 20260820;' in text
    assert 'input int    InpCounterExcursionMagicNumber            = 90260851;' in text
    assert 'input int    InpExhaustionCounterMagicNumber            = 90260852;' in text
    assert "XAU_ClampGoldStopToMaxDistance" in text
    assert "XAU_MAX_GOLD_SL_MOVE" in text


def test_first_50_touch_has_no_timer_and_ratchets_a_monotonic_70_percent_floor():
    fn = function(source(), "bool XAU_SmartProfitManage(int idx, ulong ticket, bool isBuy, double currentPips, double currentProfitUSD)")
    assert 'g_rExit[idx].extensionTriggerAuthority = "SMART_PROFIT_FIRST_50";' in fn
    assert "g_rExit[idx].extensionDeadline = 0; // deliberately no timer authority" in fn
    assert "MathMax(InpSmartProfitActivationPips," in fn
    assert "g_rExit[idx].extensionHighestPeakPips * InpSmartProfitPeakRetentionPct / 100.0" in fn
    assert "MathMax(g_rExit[idx].extensionProtectedFloorPips, calculatedFloor)" in fn
    assert 'XAU_RExit_RequestClose(idx, ticket, "SMART_PROFIT_CONFIRMED_REVERSAL")' in fn


def test_smart_profit_is_the_only_post_50_general_exit_owner():
    text = source()
    active = function(text, "bool XAU_General10MExtensionActive(int idx)")
    assert 'g_rExit[idx].extensionTriggerAuthority != "SMART_PROFIT_FIRST_50"' in active
    close = function(text, "bool XAU_RExit_RequestClose(int idx, ulong currentTicket, string reason)")
    assert "XAU_General10MTryArm" not in close
    core = function(text, "void XAU_RExitCoreLoop()")
    smart_call = core.index("if(XAU_SmartProfitManage(idx, ticket, isBuy, currentPips, profit))")
    legacy_extension = core.index("if(XAU_General10MExtensionActive(idx))", smart_call)
    assert smart_call < legacy_extension


def test_production_telemetry_compatibility_is_retained():
    text = source()
    assert "BotMonitorJsonSafe" in text
    assert "account_currency" in text
    assert "XAU_ReportConfirmedPattern" in text
    assert "explicitSL" in text
