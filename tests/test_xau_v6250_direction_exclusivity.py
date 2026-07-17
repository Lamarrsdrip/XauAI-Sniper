from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def find_function(ea: str, signature: str) -> str:
    start = ea.index(signature)
    open_idx = ea.index("{", start)
    depth = 0
    i = open_idx
    while i < len(ea):
        if ea[i] == "{":
            depth += 1
        elif ea[i] == "}":
            depth -= 1
            if depth == 0:
                return ea[start:i + 1]
        i += 1
    raise AssertionError(f"unbalanced braces for {signature}")


def fn_body(ea: str, signature: str, size: int = 4000) -> str:
    idx = ea.index(signature)
    return ea[idx: idx + size]


def test_root_and_backend_copies_synced():
    assert read(EA) == read(BACKEND_EA)


# ---------------------------------------------------------------------------
# one canonical authority, no duplicates
# ---------------------------------------------------------------------------
def test_exactly_one_canonical_direction_authority_defined():
    ea = read(EA)
    assert ea.count("bool XAU_CanOpenDirection(int requestedDirection, string requestingFamily, string &blockReason)") == 1


def test_exactly_one_transition_orchestrator_defined():
    ea = read(EA)
    assert ea.count("ENUM_XAU_DIRECTION_TRANSITION XAU_HandleOppositeDirectionTransition(") == 1


# ---------------------------------------------------------------------------
# hard safety net semantics
# ---------------------------------------------------------------------------
def test_can_open_direction_scans_all_three_managed_magic_numbers():
    ea = read(EA)
    fn = find_function(ea, "bool XAU_CanOpenDirection(int requestedDirection, string requestingFamily, string &blockReason)")
    assert "InpMagicNumber" in fn
    assert "InpCounterExcursionMagicNumber" in fn
    assert "InpExhaustionCounterMagicNumber" in fn


def test_can_open_direction_blocks_on_opposite_position():
    ea = read(EA)
    fn = find_function(ea, "bool XAU_CanOpenDirection(int requestedDirection, string requestingFamily, string &blockReason)")
    assert "bool opposes = (requestedDirection == 1 && !isBuy) || (requestedDirection == -1 && isBuy);" in fn
    idx = fn.index("if(!opposes) continue;")
    window = fn[idx: idx + 500]
    assert "OPPOSITE_EXPOSURE_ACTIVE" in window
    assert "return false;" in window


def test_can_open_direction_checks_pending_orders_too():
    ea = read(EA)
    fn = find_function(ea, "bool XAU_CanOpenDirection(int requestedDirection, string requestingFamily, string &blockReason)")
    assert "OrdersTotal()" in fn
    assert "OPPOSITE_PENDING_ORDER_EXISTS" in fn
    assert "ORDER_TYPE_BUY_LIMIT" in fn and "ORDER_TYPE_SELL_LIMIT" in fn


def test_can_open_direction_allows_same_direction_and_no_exposure():
    ea = read(EA)
    fn = find_function(ea, "bool XAU_CanOpenDirection(int requestedDirection, string requestingFamily, string &blockReason)")
    assert fn.rstrip().endswith("return true;\n}")


# ---------------------------------------------------------------------------
# profitable-close-first / losing-blocks transition
# ---------------------------------------------------------------------------
def test_transition_closes_profitable_opposite_campaign_first():
    ea = read(EA)
    fn = find_function(ea, "ENUM_XAU_DIRECTION_TRANSITION XAU_HandleOppositeDirectionTransition(int requestedDirection, string requestingFamily, string &detail)")
    idx = fn.index("if(oppositePL > 0.0)")
    window = fn[idx: idx + 700]
    assert "XAU_CloseCampaignBasketAtProtectedFloor(oppositeDirection," in window
    assert "return DIRECTION_TRANSITION_CLOSING_PROFITABLE;" in window


def test_transition_never_closes_losing_campaign_to_flip():
    ea = read(EA)
    fn = find_function(ea, "ENUM_XAU_DIRECTION_TRANSITION XAU_HandleOppositeDirectionTransition(int requestedDirection, string requestingFamily, string &detail)")
    idx = fn.rindex("detail = StringFormat(\"OPPOSITE_CAMPAIGN_LOSING_OR_BREAKEVEN")
    window = fn[idx: idx + 700]
    assert "XAU_CloseCampaignBasketAtProtectedFloor" not in window
    assert "return DIRECTION_TRANSITION_BLOCKED_LOSING;" in window


def test_transition_clear_when_no_opposite_campaign():
    ea = read(EA)
    fn = find_function(ea, "ENUM_XAU_DIRECTION_TRANSITION XAU_HandleOppositeDirectionTransition(int requestedDirection, string requestingFamily, string &detail)")
    idx = fn.index("if(!oppositeHasPositions)")
    window = fn[idx: idx + 200]
    assert "return DIRECTION_TRANSITION_CLEAR;" in window


# ---------------------------------------------------------------------------
# every broker-send path wired
# ---------------------------------------------------------------------------
def test_opentrade_calls_transition_orchestrator_before_sizing_and_is_not_manual_exempt():
    ea = read(EA)
    fn = find_function(ea, "bool OpenTrade(int signal, double atr, string reason, double sizeMulti, bool isManualOverride = false)")
    idx = fn.index("XAU_HandleOppositeDirectionTransition(signal,")
    # the cross-instance-lock guard (the first `if(!isManualOverride ...)`
    # block in this function) must be fully closed -- brace-balanced --
    # before the direction-exclusivity call appears, proving it is NOT
    # nested inside that manual-exempt guard.
    guard_start = fn.index("if(!isManualOverride && XAU_CrossInstanceEntryLockActive(signal))")
    open_idx = fn.index("{", guard_start)
    depth = 0
    i = open_idx
    while i < len(fn):
        if fn[i] == "{":
            depth += 1
        elif fn[i] == "}":
            depth -= 1
            if depth == 0:
                break
        i += 1
    guard_close_idx = i
    assert guard_close_idx < idx, "direction-exclusivity call must come after the cross-instance-lock guard is fully closed, not nested inside it"


def test_opentrade_has_final_hard_guard_immediately_before_broker_send():
    ea = read(EA)
    fn = find_function(ea, "bool OpenTrade(int signal, double atr, string reason, double sizeMulti, bool isManualOverride = false)")
    guard_idx = fn.index("XAU_CanOpenDirection(signal, isManualOverride ? \"MANUAL_FORCE\" : reason, sendGuardReason)")
    send_idx = fn.index("if(signal == 1) ok = trade.Buy(lots, Symbol(), 0, sl, tp,")
    assert guard_idx < send_idx
    # nothing that sends an order may sit between the guard and the send
    between = fn[guard_idx:send_idx]
    assert "trade.Buy(" not in between and "trade.Sell(" not in between


def test_pyramid_add_calls_hard_guard_before_send():
    ea = read(EA)
    idx = ea.index('bool ok=isBuy?trade.Buy(addLot,Symbol(),0,pyramidSL,pyramidTP,"XAU-SNIPER|"+why)')
    preceding = ea[max(0, idx - 600):idx]
    assert 'XAU_CanOpenDirection(isBuy ? 1 : -1, "PYRAMID", pyramidGuardReason)' in preceding


def test_counter_excursion_calls_hard_guard_before_send():
    ea = read(EA)
    idx = ea.index("trade.SetExpertMagicNumber(InpCounterExcursionMagicNumber);\n   bool ok = (counterDir == 1) ? trade.Buy(lots")
    preceding = ea[max(0, idx - 600):idx]
    assert 'XAU_CanOpenDirection(counterDir, "COUNTER_EXCURSION", counterGuardReason)' in preceding


def test_no_second_competing_direction_check_exists():
    ea = read(EA)
    # guards against a future/parallel implementation of the same concept
    # under a different name
    forbidden_names = ["XAU_DirectionLock(", "XAU_ExclusiveDirectionGate(", "XAU_OneDirectionOnly("]
    for name in forbidden_names:
        assert name not in ea


if __name__ == "__main__":
    import sys
    import pytest
    sys.exit(pytest.main([__file__, "-q"]))
