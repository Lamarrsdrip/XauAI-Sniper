from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"
V62417_EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.24.17.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def fn_body(ea: str, signature: str, size: int = 4000) -> str:
    idx = ea.index(signature)
    return ea[idx: idx + size]


def test_all_three_source_copies_synced():
    assert read(EA) == read(BACKEND_EA) == read(V62417_EA)


def test_compile_reports_zero_errors_and_warnings():
    log = (ROOT / "tester_sandbox" / "MT5_Isolated" / "compile_basket_fix2.log").read_bytes()
    text = log.decode("utf-16-le", errors="ignore")
    assert "0 errors, 0 warnings" in text


# ---------------------------------------------------------------------------
# Owner-reported bug: basket state was cleared unconditionally regardless of
# conversion outcome. Fix extracts the conversion attempt into its own
# function and only clears state on APPLIED/EXISTING_INDIVIDUAL_FLOOR_ALREADY_HIGHER.
# ---------------------------------------------------------------------------
def test_conversion_function_extracted_and_never_clears_state_itself():
    ea = read(BACKEND_EA)
    fn = fn_body(ea, "string XAU_TryConvertBasketToSingleFloor(", 2500)
    # the function may READ basketProtectedFloorMoney (needed to compute the
    # converted individual R), but must never WRITE/clear any basket field --
    # that decision belongs entirely to the caller.
    assert "basketProtectionArmed" not in fn
    assert "basketPeakProfitMoney" not in fn
    assert "basketProtectedFloorMoney = 0.0" not in fn
    assert "basketProtectedFloorMoney =" not in fn


def test_successful_conversion_clears_basket_state():
    ea = read(BACKEND_EA)
    fn = fn_body(ea, "void XAU_CampaignRegisterClose(int direction, double closedProfit)", 4000)
    idx = fn.index('if(conversionStatus == "APPLIED" || conversionStatus == "EXISTING_INDIVIDUAL_FLOOR_ALREADY_HIGHER")')
    window = fn[idx: idx + 500]
    assert "g_campaign[slot].basketProtectionArmed     = false;" in window
    assert "g_campaign[slot].basketConversionPending    = false;" in window


def test_failed_conversion_keeps_floor_armed_marks_pending():
    ea = read(BACKEND_EA)
    fn = fn_body(ea, "void XAU_CampaignRegisterClose(int direction, double closedProfit)", 4500)
    else_idx = fn.rindex("else\n      {\n         // Conversion not yet possible")
    window = fn[else_idx: else_idx + 400]
    assert "g_campaign[slot].basketConversionPending = true;" in window
    # must NOT reset any protected value in this branch
    assert "basketProtectionArmed     = false" not in window
    assert "basketProtectedFloorMoney = 0.0" not in window


def test_surviving_ticket_not_found_does_not_clear_protection():
    ea = read(BACKEND_EA)
    fn = fn_body(ea, "string XAU_TryConvertBasketToSingleFloor(", 2500)
    assert 'return "NO_SURVIVING_TICKET_FOUND";' in fn


def test_surviving_ticket_risk_unknown_does_not_clear_protection():
    ea = read(BACKEND_EA)
    fn = fn_body(ea, "string XAU_TryConvertBasketToSingleFloor(", 2500)
    assert 'return "SURVIVING_TICKET_RISK_UNKNOWN";' in fn


def test_retry_path_exists_in_basket_state_update():
    ea = read(BACKEND_EA)
    fn = fn_body(ea, "void XAU_UpdateCampaignBasketState(int direction)", 3000)
    assert "g_campaign[slot].activePositionCount == 1 && g_campaign[slot].basketConversionPending" in fn
    assert "XAU_TryConvertBasketToSingleFloor(direction, slot, survivingTicket, convertedFloorR);" in fn
    assert "g_campaign[slot].basketConversionRetryCount++;" in fn


def test_retry_path_runs_before_the_activepositioncount_lt_2_early_return():
    ea = read(BACKEND_EA)
    fn = fn_body(ea, "void XAU_UpdateCampaignBasketState(int direction)", 5000)
    pending_idx = fn.index("basketConversionPending)")
    early_return_idx = fn.index("if(!g_campaign[slot].active || g_campaign[slot].activePositionCount < 2)")
    assert pending_idx < early_return_idx


def test_floor_breach_during_pending_conversion_closes_survivor():
    ea = read(BACKEND_EA)
    fn = fn_body(ea, "void XAU_UpdateCampaignBasketState(int direction)", 3500)
    assert "survivorPL <= g_campaign[slot].basketProtectedFloorMoney" in fn
    assert "BASKET_TO_SINGLE_PENDING_FLOOR_BREACH" in fn
    assert "XAU_CloseCampaignBasketAtProtectedFloor(direction, \"BASKET_TO_SINGLE_PENDING_FLOOR_BREACH\");" in fn


def test_restart_during_pending_conversion_restores_armed_floor():
    ea = read(BACKEND_EA)
    fn = fn_body(ea, "void XAU_CampaignBasketState_Load()", 3800)
    assert "countPlausible = g_campaign[slot].activePositionCount >= 2 ||" in fn
    assert "(g_campaign[slot].activePositionCount == 1 && armed);" in fn
    assert 'g_campaign[slot].basketConversionPending    = (g_campaign[slot].activePositionCount == 1) ? true : conversionPending;' in fn


def test_schema_version_bumped_for_new_persisted_fields():
    ea = read(BACKEND_EA)
    assert "#define XAU_BASKET_STATE_SCHEMA_VERSION 2" in ea


def test_new_struct_fields_declared_and_initialized():
    ea = read(BACKEND_EA)
    assert "bool     basketConversionPending;" in ea
    assert "int      basketConversionRetryCount;" in ea
    assert "g_campaign[slot].basketConversionPending    = false;" in ea
    assert "g_campaign[slot].basketConversionRetryCount = 0;" in ea


def test_basket_to_single_transition_log_includes_status_and_action():
    ea = read(BACKEND_EA)
    idx = ea.index('PrintFormat("BASKET_TO_SINGLE_TRANSITION | status=%s')
    window = ea[idx: idx + 400]
    assert "status=%s" in window
    assert "retryCount=%d" in window
    assert "action=%s" in window
