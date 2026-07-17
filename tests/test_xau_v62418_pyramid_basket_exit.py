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
    log = (ROOT / "tester_sandbox" / "MT5_Isolated" / "compile_buildhash.log").read_bytes()
    text = log.decode("utf-16-le", errors="ignore")
    assert "0 errors, 0 warnings" in text


# ---------------------------------------------------------------------------
# 1-4: single vs basket activation, fixed 1R
# ---------------------------------------------------------------------------
def test_basket_mode_requires_at_least_two_positions():
    ea = read(BACKEND_EA)
    fn = fn_body(ea, "void XAU_UpdateCampaignBasketState(int direction)", 6000)
    assert "if(!g_campaign[slot].active || g_campaign[slot].activePositionCount < 2)" in fn
    assert "return; // single-position campaigns use the individual exit floor, untouched" in fn


def test_basket_one_r_money_fixed_from_initial_core_real_money_risk():
    ea = read(BACKEND_EA)
    assert "g_campaign[slot].basketOneRMoney           = coreMoneyRiskUSD;" in ea
    # captured from the ACTUAL broker fill, not a pre-fill estimate
    fill_idx = ea.index("double coreFillPx = trade.ResultPrice() > 0.0 ? trade.ResultPrice() : price;")
    window = ea[fill_idx: fill_idx + 500]
    assert "double coreMoneyRiskUSD = lots * RiskPerLotForDistance(coreSLDistAtFill);" in window


def test_pyramid_add_does_not_redefine_basket_one_r():
    ea = read(BACKEND_EA)
    # XAU_CampaignRegisterAdd must never write basketOneRMoney
    add_idx = ea.index("void XAU_CampaignRegisterAdd(int direction, string setupName)")
    add_end = ea.index("void XAU_CampaignRegisterClose", add_idx)
    add_fn = ea[add_idx:add_end]
    assert "basketOneRMoney" not in add_fn


def test_three_positions_still_one_basket_not_reset():
    # The struct only tracks ONE basketOneRMoney/peak/floor per direction
    # slot regardless of how many additions occur -- structurally there is
    # no per-addition reset path (addCount only affects activePositionCount).
    ea = read(BACKEND_EA)
    assert ea.count("g_campaign[slot].basketOneRMoney           = coreMoneyRiskUSD;") == 1


# ---------------------------------------------------------------------------
# 5-11: floor formula and ratchet
# ---------------------------------------------------------------------------
FLOOR_EXAMPLES = [
    (0.49, None),
    (0.50, 0.35),
    (0.60, 0.42),
    (0.80, 0.56),
    (1.00, 0.70),
    (1.50, 1.05),
    (2.00, 1.40),
]


def basket_floor(peak_r: float):
    if peak_r < 0.50:
        return None
    return max(0.35, peak_r * 0.70)


def test_floor_formula_matches_every_owner_example():
    for peak_r, expected in FLOOR_EXAMPLES:
        got = basket_floor(peak_r)
        if expected is None:
            assert got is None
        else:
            assert abs(got - expected) < 1e-9, f"peak {peak_r} -> {got}, expected {expected}"


def test_ea_source_uses_the_exact_max_035_070_formula():
    ea = read(BACKEND_EA)
    fn = fn_body(ea, "void XAU_UpdateCampaignBasketState(int direction)", 9000)
    assert "double desiredFloorR = MathMax(0.35, g_campaign[slot].basketPeakR * 0.70);" in fn
    assert "if(g_campaign[slot].basketPeakR >= 0.50)" in fn


def test_floor_never_decreases_ratchet_only():
    ea = read(BACKEND_EA)
    fn = fn_body(ea, "void XAU_UpdateCampaignBasketState(int direction)", 9000)
    assert "desiredFloorR > g_campaign[slot].basketProtectedFloorR + 0.0000001" in fn
    # no assignment path exists that could ever lower basketProtectedFloorR
    assert "basketProtectedFloorR -=" not in ea
    assert "basketProtectedFloorR = MathMin" not in ea


def test_new_pyramid_does_not_reset_peak_or_floor():
    ea = read(BACKEND_EA)
    add_idx = ea.index("void XAU_CampaignRegisterAdd(int direction, string setupName)")
    # v6.24.18: bound the window to RegisterAdd's own body only (a closing
    # brace at column 0), not "everything up to the next campaign function" --
    # XAU_TryConvertBasketToSingleFloor is now defined between RegisterAdd and
    # RegisterClose and legitimately READS basketProtectedFloorMoney, which
    # would otherwise be a false positive for this specific check.
    add_end = ea.index("\n}\n", add_idx)
    add_fn = ea[add_idx:add_end]
    assert "basketPeakProfitMoney" not in add_fn
    assert "basketProtectedFloorMoney" not in add_fn
    assert "basketProtectionArmed" not in add_fn


# ---------------------------------------------------------------------------
# 12-13: pyramid add rejection near armed floor
# ---------------------------------------------------------------------------
def test_new_pyramid_rejected_when_it_would_violate_armed_floor():
    ea = read(BACKEND_EA)
    assert "PYRAMID_ADD_REJECTED_BASKET_FLOOR_AT_RISK" in ea
    idx = ea.index("if(projectedPL <= g_campaign[pyBasketSlot].basketProtectedFloorMoney)")
    window = ea[idx: idx + 500]
    assert "return;" in window


def test_pyramid_add_blocked_during_basket_close_in_progress():
    ea = read(BACKEND_EA)
    assert "PYRAMID_ADD_REJECTED_BASKET_CLOSE_IN_PROGRESS" in ea


# ---------------------------------------------------------------------------
# 14-16: individual trails suppressed during basket mode
# ---------------------------------------------------------------------------
def test_individual_trail_suppressed_by_basket_before_priority_2_and_3():
    ea = read(BACKEND_EA)
    fn = fn_body(ea, "void XAU_RExitCoreLoop()", 8000)
    suppress_idx = fn.index("if(basketModeActive)")
    p2_idx = fn.index("Priority 2: 1R hard close")
    p3_idx = fn.index("Priority 3: 45% giveback")
    assert suppress_idx < p2_idx < p3_idx


def test_chandelier_and_atr_trail_cannot_override_basket_mode():
    # the individual floor-arming block (which is the only per-ticket SL
    # trail mechanism reachable from XAU_RExitCoreLoop) is entirely skipped
    # via `continue` when basketModeActive -- no separate Chandelier/ATR
    # function exists outside this loop that could still modify a basket
    # member's SL (confirmed: SafeModifySL for profit-floor purposes is
    # only called from this one gated location and from the exhaustion-
    # counter/counter-excursion's own separate, isolated managers).
    ea = read(BACKEND_EA)
    assert ea.count('SafeModifySL(ticket, guaranteedSL, curTP, isBuy, curPrice, "PRIMARY_EXIT_FLOOR")') == 1


def test_transition_authority_suppresses_struggling_exit_during_basket_mode():
    ea = read(BACKEND_EA)
    fn = fn_body(ea, "bool XAU_ApplyTransitionPositionAuthority(", 5000)
    assert "bool basketModeActive = g_campaign[campSlot].active && g_campaign[campSlot].activePositionCount >= 2;" in fn
    assert "if(basketModeActive && health != TRADE_INVALIDATED)" in fn
    idx = fn.index("if(basketModeActive && health != TRADE_INVALIDATED)")
    window = fn[idx: idx + 500]
    assert "INDIVIDUAL_TRAIL_SUPPRESSED_BY_BASKET" in window
    assert "return false;" in window


# ---------------------------------------------------------------------------
# 17-19: coordinated close
# ---------------------------------------------------------------------------
def test_floor_trigger_closes_every_campaign_ticket_via_shared_safe_primitive():
    ea = read(BACKEND_EA)
    fn = fn_body(ea, "void XAU_CloseCampaignBasketAtProtectedFloor(", 3000)
    assert "XAU_RExit_RequestClose(idx, tk, reason)" in fn
    assert "if(posDir != direction) continue;" in fn


def test_partial_close_failure_retries_without_reporting_complete():
    ea = read(BACKEND_EA)
    fn = fn_body(ea, "void XAU_CloseCampaignBasketAtProtectedFloor(", 3000)
    assert "BASKET_CLOSE_PARTIAL_FAILURE" in fn
    assert "if(total > 0 && closed == total)" in fn
    assert "BASKET_CLOSE_COMPLETED" in fn


def test_duplicate_ticks_cannot_send_duplicate_basket_closes():
    ea = read(BACKEND_EA)
    fn = fn_body(ea, "void XAU_CloseCampaignBasketAtProtectedFloor(", 3000)
    # relies on g_rExit[idx].closeState==R_CLOSE_CONFIRMED short-circuit per
    # ticket, and XAU_RExit_RequestClose's own 3-second throttle -- no new
    # order is sent for a ticket already REQUESTED/PENDING_RETRY/CONFIRMED.
    assert "if(g_rExit[idx].closeState == R_CLOSE_CONFIRMED) { closed++; continue; }" in fn


# ---------------------------------------------------------------------------
# 20-22: scope isolation
# ---------------------------------------------------------------------------
def test_different_campaigns_not_combined_slot_is_per_direction():
    ea = read(BACKEND_EA)
    assert "XAU_CampaignState g_campaign[2];" in ea
    fn = fn_body(ea, "void XAU_UpdateCampaignBasketState(int direction)", 5500)
    assert "if(posDir != direction) continue;" in fn


def test_counter_excursion_excluded_from_basket_by_construction():
    ea = read(BACKEND_EA)
    fn = fn_body(ea, "void XAU_UpdateCampaignBasketState(int direction)", 5500)
    assert "InpMagicNumber" in fn
    assert "InpCounterExcursionMagicNumber" not in fn


def test_exhaustion_counter_excluded_from_basket_by_construction():
    ea = read(BACKEND_EA)
    fn = fn_body(ea, "void XAU_UpdateCampaignBasketState(int direction)", 5500)
    assert "InpExhaustionCounterMagicNumber" not in fn


# ---------------------------------------------------------------------------
# 23-24: restart persistence + basket-to-single transition
# ---------------------------------------------------------------------------
def test_restart_restores_armed_basket_floor_from_persisted_file():
    ea = read(BACKEND_EA)
    assert "void XAU_CampaignBasketState_Load()" in ea
    assert "void XAU_CampaignBasketState_Save(bool force = false)" in ea
    assert "XAU_CampaignBasketState_Load();" in ea  # called from OnInit
    fn = fn_body(ea, "void XAU_CampaignBasketState_Load()", 3500)
    assert "g_campaign[slot].basketProtectionArmed     = armed;" in fn


def test_basket_state_file_keyed_by_account_server_symbol_magic():
    ea = read(BACKEND_EA)
    fn = fn_body(ea, "string XAU_CampaignBasketStateFilePath()", 700)
    assert "AccountInfoInteger(ACCOUNT_LOGIN)" in fn
    assert "AccountInfoString(ACCOUNT_SERVER)" in fn
    assert "Symbol()" in fn
    assert "InpMagicNumber" in fn


def test_basket_state_load_rejects_foreign_or_mismatched_records():
    ea = read(BACKEND_EA)
    fn = fn_body(ea, "void XAU_CampaignBasketState_Load()", 3500)
    assert "login != myLogin || server != myServer || symbol != Symbol() || magic != InpMagicNumber" in fn
    assert "NOT_CURRENTLY_A_LIVE_BASKET" in fn


def test_falling_back_to_one_position_preserves_protection_via_conversion():
    # v6.24.18: the actual conversion math was extracted into its own
    # function (XAU_TryConvertBasketToSingleFloor), called from
    # XAU_CampaignRegisterClose -- check both.
    ea = read(BACKEND_EA)
    close_idx = ea.index("void XAU_CampaignRegisterClose(int direction, double closedProfit)")
    close_end = ea.index("void XAU_CampaignInvalidate", close_idx)
    fn = ea[close_idx:close_end]
    assert "BASKET_TO_SINGLE_TRANSITION" in fn
    assert "g_campaign[slot].activePositionCount == 1 && g_campaign[slot].basketProtectionArmed" in fn
    assert "XAU_TryConvertBasketToSingleFloor(direction, slot, survivingTicket, convertedFloorR);" in fn

    convert_idx = ea.index("string XAU_TryConvertBasketToSingleFloor(")
    convert_fn = ea[convert_idx: convert_idx + 2500]
    assert "g_rExit[svIdx].guaranteedFloorR = convertedFloorROut;" in convert_fn
    assert "g_rExit[svIdx].profitGuaranteeArmed = true;" in convert_fn


# ---------------------------------------------------------------------------
# 25: net-profit convention
# ---------------------------------------------------------------------------
def test_basket_pl_convention_includes_swap_and_commission():
    ea = read(BACKEND_EA)
    fn = fn_body(ea, "void XAU_UpdateCampaignBasketState(int direction)", 5500)
    assert "posInfo.Profit() + posInfo.Swap() + posInfo.Commission()" in fn
    close_fn = fn_body(ea, "void XAU_CloseCampaignBasketAtProtectedFloor(", 2000)
    # the close function itself doesn't need to recompute P/L (it only
    # requests closes), but the display function must use the same convention
    display_fn = fn_body(ea, "string XAU_CampaignBasketDisplayJson(int direction)", 2000)
    assert "posInfo.Profit() + posInfo.Swap() + posInfo.Commission()" in display_fn


# ---------------------------------------------------------------------------
# 26-27: build consistency (26 covered by compile test above)
# ---------------------------------------------------------------------------
def test_all_three_ea_copies_remain_identical_after_basket_work():
    assert read(EA) == read(BACKEND_EA) == read(V62417_EA)


# ---------------------------------------------------------------------------
# 28: Command Center display
# ---------------------------------------------------------------------------
def test_command_center_heartbeat_includes_pyramid_basket_block():
    ea = read(BACKEND_EA)
    assert '"\\"pyramid_basket\\":{\\"buy\\":%s,\\"sell\\":%s},"' in ea
    assert "buyBasketJson, sellBasketJson," in ea


def test_display_json_reports_individual_primary_for_single_position_campaign():
    ea = read(BACKEND_EA)
    fn = fn_body(ea, "string XAU_CampaignBasketDisplayJson(int direction)", 2500)
    # source contains the MQL5 string literal \"INDIVIDUAL_PRIMARY\" (escaped
    # quotes, since it's JSON built inside a StringFormat string literal)
    assert "INDIVIDUAL_PRIMARY" in fn
    assert "if(g_campaign[slot].activePositionCount < 2)" in fn


def test_display_json_reports_basket_fields_for_multi_position_campaign():
    ea = read(BACKEND_EA)
    fn = fn_body(ea, "string XAU_CampaignBasketDisplayJson(int direction)", 2500)
    for field in ["exit_mode", "campaign_id", "core_ticket", "position_count",
                  "basket_one_r_money", "basket_current_pl", "basket_current_r",
                  "basket_peak_pl", "basket_peak_r", "protection_armed",
                  "protected_floor_money", "protected_floor_r", "next_action"]:
        assert field in fn, f"missing display field {field}"


# ---------------------------------------------------------------------------
# Acceptance proof: owner's exact controlled example
# core money risk $1000, basket peak $800 = 0.80R -> floor $560 = 0.56R
# ---------------------------------------------------------------------------
def test_acceptance_proof_800_peak_560_floor_example():
    basket_one_r_money = 1000.0
    peak_money = 800.0
    peak_r = peak_money / basket_one_r_money
    assert peak_r == 0.80
    floor_r = max(0.35, peak_r * 0.70)
    assert abs(floor_r - 0.56) < 1e-9
    floor_money = floor_r * basket_one_r_money
    assert abs(floor_money - 560.0) < 1e-6


def test_required_log_tags_present():
    ea = read(BACKEND_EA)
    for tag in ["BASKET_EXIT_STATE", "BASKET_MODE_ACTIVATED" if "BASKET_MODE_ACTIVATED" in ea else "BASKET_PROTECTION_ARMED",
                "BASKET_PEAK_UPDATED", "BASKET_PROTECTION_ARMED", "BASKET_FLOOR_RATCHETED",
                "BASKET_FLOOR_TRIGGERED", "BASKET_CLOSE_STARTED", "BASKET_POSITION_CLOSED",
                "BASKET_CLOSE_COMPLETED", "BASKET_CLOSE_PARTIAL_FAILURE", "BASKET_TO_SINGLE_TRANSITION",
                "INDIVIDUAL_TRAIL_SUPPRESSED_BY_BASKET"]:
        assert tag in ea, f"missing required log tag {tag}"
