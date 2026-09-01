from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.17.17.mq5"
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


def test_version_bumped_to_v61717():
    ea = read(BACKEND_EA)
    assert '#define XAUAI_EA_VERSION "v6.17.17"' in ea


def test_header_banner_matches_property_version_for_website_display():
    import re
    ea = read(BACKEND_EA)
    m = re.search(r'v(\d+\.\d+\.\d+)\s*[—\-]+\s*(.+)', ea[:3000])
    assert m is not None
    assert f"v{m.group(1)}" == "v6.17.17"


# ---------------------------------------------------------------------------
# User-directed floor: 0.10 @ $1k, 0.25 @ $3k, 0.50 @ $6k. Formula:
# max(0.10, balance/1000 * 0.08333). Verified numerically against all three
# targets exactly.
# ---------------------------------------------------------------------------
def test_floor_inputs_match_exact_user_targets():
    ea = read(BACKEND_EA)
    assert "input double InpMinAccountLotFloor  = 0.10;" in ea
    assert "input double InpAccountLotFloorPer1000 = 0.08333;" in ea


def test_floor_formula_produces_exact_user_targets():
    def floor_lot(balance, min_floor=0.10, per_1000=0.08333):
        return max(min_floor, balance / 1000.0 * per_1000)
    assert abs(floor_lot(1000) - 0.10) < 0.001
    assert abs(floor_lot(3000) - 0.25) < 0.001
    assert abs(floor_lot(6000) - 0.50) < 0.001


def test_floor_applied_after_risk_reconciliation_not_before():
    # Must run AFTER XAU_ReconcileFinalRisk so it reliably overrides the
    # risk cap and every other upstream reducer, regardless of source --
    # this is what makes it robust without having to find/neuter each
    # individual reducer separately.
    ea = read(BACKEND_EA)
    reconcile_idx = ea.index("if(!XAU_ReconcileFinalRisk(lots, slDist, lotStep, minLot, riskPct,")
    floor_idx = ea.index("double acctFloorLot = MathMax(InpMinAccountLotFloor, balance / 1000.0 * InpAccountLotFloorPer1000);")
    assert reconcile_idx < floor_idx


def test_floor_applied_before_execute_print():
    ea = read(BACKEND_EA)
    floor_idx = ea.index("double acctFloorLot = MathMax(InpMinAccountLotFloor, balance / 1000.0 * InpAccountLotFloorPer1000);")
    exec_idx = ea.index('Print("EXECUTING: ", signal > 0 ? "BUY" : "SELL",')
    assert floor_idx < exec_idx


def test_floor_only_raises_never_lowers():
    ea = read(BACKEND_EA)
    marker = "double acctFloorLot = MathMax(InpMinAccountLotFloor, balance / 1000.0 * InpAccountLotFloorPer1000);"
    idx = ea.index(marker)
    window = ea[idx: idx + 900]
    assert "if(acctFloorLot > lots)" in window
    assert "if(flooredLots > lots)" in window


def test_floor_still_respects_broker_step_min_max():
    ea = read(BACKEND_EA)
    marker = "double acctFloorLot = MathMax(InpMinAccountLotFloor, balance / 1000.0 * InpAccountLotFloorPer1000);"
    idx = ea.index(marker)
    window = ea[idx: idx + 900]
    assert "MathFloor(acctFloorLot / lotStep) * lotStep" in window
    assert "MathMax(minLot, MathMin(maxLot, flooredLots))" in window


def test_floor_logs_when_it_overrides_the_risk_cap():
    ea = read(BACKEND_EA)
    assert "ACCOUNT-LOT-FLOOR:" in ea
    marker = "ACCOUNT-LOT-FLOOR:"
    idx = ea.index(marker)
    window = ea[max(0, idx - 200): idx + 400]
    assert "user-chosen: minimum lot overrides the risk cap" in window


def test_prior_session_fixes_still_intact():
    ea = read(BACKEND_EA)
    assert 'if(blockClass == "HARD_BLOCK")' in ea  # v6.17.16
    assert "bool XAU_TryForceOpenTrade(int dir, string setup, string grade, string originalBlocker," in ea  # v6.17.15
    assert "input double InpMaxRiskPctEquity = 5.0;" in ea  # v6.17.14
