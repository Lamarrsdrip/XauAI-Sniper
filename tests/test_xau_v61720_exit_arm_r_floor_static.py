from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.17.20.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def body(src: str, signature: str) -> str:
    idx = src.index(signature)
    start = src.index("{", idx)
    depth = 0
    for i in range(start, len(src)):
        if src[i] == "{":
            depth += 1
        elif src[i] == "}":
            depth -= 1
            if depth == 0:
                return src[start:i + 1]
    raise AssertionError(f"unbalanced braces for {signature}")


def test_current_release_source_is_synced_to_backend():
    assert read(EA) == read(BACKEND_EA)


def test_version_bumped_to_v61720():
    ea = read(BACKEND_EA)
    assert '#define XAUAI_EA_VERSION "v6.17.20"' in ea


def test_header_banner_matches_property_version_for_website_display():
    import re
    ea = read(BACKEND_EA)
    m = re.search(r'v(\d+\.\d+\.\d+)\s*[—\-]+\s*(.+)', ea[:3000])
    assert m is not None
    assert f"v{m.group(1)}" == "v6.17.20"


# ---------------------------------------------------------------------------
# SHARED HELPER
# ---------------------------------------------------------------------------
def test_min_arm_helper_exists_and_floors_by_own_r():
    ea = read(BACKEND_EA)
    fn = body(ea, "double XAU_MinArmUSDForOwnR(double dollarArm, double rDollars)")
    assert "if(rDollars <= 0.0) return dollarArm;" in fn
    assert "return MathMax(dollarArm, rDollars * InpExitArmMinOwnR);" in fn


def test_exit_arm_min_own_r_input_present():
    ea = read(BACKEND_EA)
    assert "input double InpExitArmMinOwnR = 0.20;" in ea


def test_min_arm_formula_numerically_prevents_lot_blind_premature_arm():
    # Simulate the Mac vs VPS scenario directly: same flat $ threshold,
    # different lot-driven rDollars.
    def min_arm(dollar_arm, r_dollars, min_r=0.20):
        if r_dollars <= 0:
            return dollar_arm
        return max(dollar_arm, r_dollars * min_r)

    flat_threshold = 75.0
    mac_r_dollars = 98.0    # small, unfloored lot
    vps_r_dollars = 800.0   # v6.17.17-floored bigger lot, same equity tier

    mac_arm = min_arm(flat_threshold, mac_r_dollars)
    vps_arm = min_arm(flat_threshold, vps_r_dollars)

    # Before the fix, both would arm at the same flat $75 -- 0.77R for Mac,
    # only 0.09R for VPS. After the fix, VPS's arm floors up to 0.20R of its
    # OWN (much bigger) risk, i.e. a much higher dollar figure than Mac's.
    assert vps_arm > mac_arm
    assert vps_arm == vps_r_dollars * 0.20
    assert mac_arm == flat_threshold  # Mac's own-R floor (0.20 * 98 = 19.6) doesn't exceed the flat $75


# ---------------------------------------------------------------------------
# WIRING: all three identified lot-blind sites must route through the helper
# ---------------------------------------------------------------------------
def test_protect_peak_floor_arm_floored_by_own_r():
    ea = read(BACKEND_EA)
    fn = body(ea, "bool XAU_ProtectPeakProfitFloor(ulong ticket, bool isBuy, double openPx, double curPrice,")
    assert "armUSD = XAU_MinArmUSDForOwnR(armUSD, rDollars);" in fn
    floor_idx = fn.index("armUSD = XAU_MinArmUSDForOwnR(armUSD, rDollars);")
    arm_check_idx = fn.index("if(peak < armUSD) return false;")
    assert floor_idx < arm_check_idx


def test_aplus_shield_tiers_floored_by_own_r():
    # Both lines are unique in the file (single call site each) -- checked
    # directly against the full source rather than via body() extraction,
    # since XAU_SmartExit3Layer is large enough that brace-depth extraction
    # is not needed for a unique-string presence/ordering check.
    ea = read(BACKEND_EA)
    assert "double tier1ArmUSD  = XAU_MinArmUSDForOwnR(MathMax(InpAPlusShieldMinArmUSD, refBal * InpAPlusShieldEquityPct / 100.0), rDollars);" in ea
    assert "double tier2ArmUSD  = XAU_MinArmUSDForOwnR(MathMax(InpAPlusShieldMinProtectUSD, refBal * InpAPlusShieldProtectEquityPct / 100.0), rDollars);" in ea
    tier1_idx = ea.index("double tier1ArmUSD  = XAU_MinArmUSDForOwnR(")
    tier1_equity_idx = ea.index("bool   tier1Equity  = (peak >= tier1ArmUSD);")
    assert tier1_idx < tier1_equity_idx


def test_ev_protect_edges_floored_by_own_r():
    ea = read(BACKEND_EA)
    fn = body(ea, "XAU_EV_DECISION XAU_EvaluateExitEV(bool isBuy,")
    assert "double evExitEdgeUSD    = XAU_MinArmUSDForOwnR(InpEVExitEdgeUSD, rDollars);" in fn
    assert "double evMinHoldEdgeUSD = XAU_MinArmUSDForOwnR(InpEVMinHoldEdgeUSD, rDollars);" in fn
    # The direct profitAtRiskUSD>=edge triggers (partial/protect) must use the
    # floored local variable, not the raw flat input, or the fix is a no-op
    # for the exact trigger path implicated by the audit.
    assert "ev.profitAtRiskUSD >= evExitEdgeUSD" in fn
    assert "ev.profitAtRiskUSD >= InpEVExitEdgeUSD" not in fn


# ---------------------------------------------------------------------------
# TELEMETRY: newly requested fields
# ---------------------------------------------------------------------------
def test_profit_quality_struct_has_account_normalized_profit_and_lot_size_influence():
    ea = read(BACKEND_EA)
    struct_body = body(ea, "struct XAU_ProfitQuality")
    assert "double accountNormalizedProfit;" in struct_body
    assert "double lotSizeInfluence;" in struct_body
    telemetry_fn = body(ea, "string XAU_ProfitQualityTelemetry(const XAU_ProfitQuality &q, double profit, double peak, string closeKind)")
    assert "AccountNormalizedProfit=%.2f%%" in telemetry_fn
    assert "LotSizeInfluence=%.2f" in telemetry_fn


def test_assess_profit_quality_takes_lots_open_and_computes_new_fields():
    ea = read(BACKEND_EA)
    fn = body(ea, "XAU_ProfitQuality XAU_AssessProfitQuality(double profit, double peak, double rDollars, double atr,")
    assert "double lotsOpen)" in ea[ea.index("XAU_ProfitQuality XAU_AssessProfitQuality(double profit"): ea.index("XAU_ProfitQuality XAU_AssessProfitQuality(double profit") + 400]
    assert "q.accountNormalizedProfit = (refBalPQ > 0.0) ? (profit / refBalPQ) * 100.0 : 0.0;" in fn
    assert "q.lotSizeInfluence = lotsOpen;" in fn


def test_call_site_passes_lots_open_through():
    ea = read(BACKEND_EA)
    fn = body(ea, "bool XAU_ProtectPeakProfitFloor(ulong ticket, bool isBuy, double openPx, double curPrice,")
    call_idx = fn.index("XAU_ProfitQuality pq = XAU_AssessProfitQuality(")
    window = fn[call_idx: call_idx + 500]
    assert "lotsOpen);" in window


# ---------------------------------------------------------------------------
# SCOPE GUARDS: lot sizing untouched, no new entry-side rules
# ---------------------------------------------------------------------------
def test_lot_size_and_entry_side_untouched_by_this_release():
    ea = read(BACKEND_EA)
    assert "double acctFloorLot = MathMax(InpMinAccountLotFloor, balance / 1000.0 * InpAccountLotFloorPer1000);" in ea
    assert "input double InpMinAccountLotFloor  = 0.10;" in ea


def test_prior_session_fixes_still_intact():
    ea = read(BACKEND_EA)
    assert "input double InpProfitQualityMinR             = 0.80;" in ea      # v6.17.18
    assert "double AccountSizeTPMultiplier()" in ea                          # v6.17.19
    assert "XAU_ScanStateKey(state)" in ea                                    # v6.17.18
    assert 'if(blockClass == "HARD_BLOCK")' in ea                             # v6.17.16
