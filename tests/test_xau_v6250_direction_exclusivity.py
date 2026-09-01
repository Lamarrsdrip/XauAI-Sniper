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
#
# v6.25.1 owner directive 2026-07-17 -- the 3-arg XAU_CanOpenDirection is now
# a thin delegate to the 4-arg overload (which also returns a cross-instance
# reservationId), and the actual live-position/pending-order scan moved into
# XAU_CanOpenDirectionLocalScanOnly, called once before and once after the
# atomic cross-instance reservation claim (owner item 4's required
# check-claim-recheck flow). These tests were written against the old
# single-function shape and now assert against the real scan function.
# ---------------------------------------------------------------------------
def test_can_open_direction_delegates_to_four_arg_overload_with_reservation():
    ea = read(EA)
    fn = find_function(ea, "bool XAU_CanOpenDirection(int requestedDirection, string requestingFamily, string &blockReason)")
    assert "XAU_CanOpenDirection(requestedDirection, requestingFamily, blockReason, unusedReservationId, fallbackKey)" in fn


def test_can_open_direction_scans_all_three_managed_magic_numbers():
    ea = read(EA)
    fn = find_function(ea, "bool XAU_CanOpenDirectionLocalScanOnly(int requestedDirection, string requestingFamily, string &blockReason)")
    assert "InpMagicNumber" in fn
    assert "InpCounterExcursionMagicNumber" in fn
    assert "InpExhaustionCounterMagicNumber" in fn


def test_can_open_direction_blocks_on_opposite_position():
    ea = read(EA)
    fn = find_function(ea, "bool XAU_CanOpenDirectionLocalScanOnly(int requestedDirection, string requestingFamily, string &blockReason)")
    assert "bool opposes = (requestedDirection == 1 && !isBuy) || (requestedDirection == -1 && isBuy);" in fn
    idx = fn.index("if(!opposes) continue;")
    window = fn[idx: idx + 500]
    assert "OPPOSITE_EXPOSURE_ACTIVE" in window
    assert "return false;" in window


def test_can_open_direction_checks_pending_orders_too():
    ea = read(EA)
    fn = find_function(ea, "bool XAU_CanOpenDirectionLocalScanOnly(int requestedDirection, string requestingFamily, string &blockReason)")
    assert "OrdersTotal()" in fn
    assert "OPPOSITE_PENDING_ORDER_EXISTS" in fn
    assert "ORDER_TYPE_BUY_LIMIT" in fn and "ORDER_TYPE_SELL_LIMIT" in fn


def test_can_open_direction_allows_same_direction_and_no_exposure():
    ea = read(EA)
    fn = find_function(ea, "bool XAU_CanOpenDirectionLocalScanOnly(int requestedDirection, string requestingFamily, string &blockReason)")
    assert fn.rstrip().endswith("return true;\n}")


def test_five_arg_overload_claims_reservation_and_rechecks_after_claim():
    ea = read(EA)
    # v6.25.30-restore (owner directive 2026-08-03): restored the bounded
    # offline trading lease, which adds a 6th, defaulted-false
    # allowOfflineFallback parameter. Callers that never passed it
    # (PYRAMID/COUNTER_EXCURSION) are byte-unchanged; only the signature
    # string this test searches for grew a trailing default arg.
    fn = find_function(ea, "bool XAU_CanOpenDirection(int requestedDirection, string requestingFamily, string &blockReason,\n                          string &reservationIdOut, string executionKey, bool allowOfflineFallback = false)")
    assert "XAU_CanOpenDirectionLocalScanOnly(requestedDirection, requestingFamily, blockReason)" in fn
    assert fn.count("XAU_CanOpenDirectionLocalScanOnly(") == 2, "must scan before AND after the atomic claim (owner item 4)"
    assert "XAU_ClaimDirectionReservation(requestedDirection, requestingFamily, executionKey," in fn
    assert "reservationIdOut, reservationFailReason, failureClass)" in fn
    assert "XAU_ReleaseDirectionReservation(reservationIdOut)" in fn, "must release the reservation if the post-claim recheck fails"


# ---------------------------------------------------------------------------
# profitable-close-first / losing-blocks transition
#
# v6.25.1 owner directive 2026-07-17 -- the orchestrator no longer assumes
# the normal-campaign basket closer can close every family. It now builds a
# full opposite-exposure inventory across all three managed magic numbers
# (XAU_BuildOppositeExposureInventory) and closes each present family with
# its own owner function (normal -> XAU_CloseCampaignBasketAtProtectedFloor,
# Counter-Excursion -> XAU_RequestCounterExcursionClose, legacy exhaustion
# -> XAU_RequestExhaustionCounterClose).
# ---------------------------------------------------------------------------
def test_transition_builds_full_opposite_exposure_inventory():
    ea = read(EA)
    fn = find_function(ea, "ENUM_XAU_DIRECTION_TRANSITION XAU_HandleOppositeDirectionTransition(int requestedDirection, string requestingFamily, string &detail)")
    assert "XAU_BuildOppositeExposureInventory(oppositeDirection, inventory)" in fn


def test_transition_closes_profitable_opposite_campaign_first():
    ea = read(EA)
    fn = find_function(ea, "ENUM_XAU_DIRECTION_TRANSITION XAU_HandleOppositeDirectionTransition(int requestedDirection, string requestingFamily, string &detail)")
    idx = fn.index("if(oppositePL > 0.0)")
    window = fn[idx:]
    assert "XAU_CloseCampaignBasketAtProtectedFloor(oppositeDirection," in window
    assert "XAU_RequestCounterExcursionClose(" in window
    assert "XAU_RequestExhaustionCounterClose(" in window
    assert "return DIRECTION_TRANSITION_CLOSING_PROFITABLE;" in window[:1600]


def test_transition_closes_each_present_family_at_most_once():
    ea = read(EA)
    fn = find_function(ea, "ENUM_XAU_DIRECTION_TRANSITION XAU_HandleOppositeDirectionTransition(int requestedDirection, string requestingFamily, string &detail)")
    assert "bool closedNormal = false, closedCounterExcursion = false, closedLegacyExhaustion = false;" in fn


def test_transition_never_closes_losing_campaign_to_flip():
    ea = read(EA)
    fn = find_function(ea, "ENUM_XAU_DIRECTION_TRANSITION XAU_HandleOppositeDirectionTransition(int requestedDirection, string requestingFamily, string &detail)")
    idx = fn.rindex('detail = StringFormat("OPPOSITE_EXPOSURE_LOSING_OR_BREAKEVEN')
    window = fn[idx: idx + 700]
    assert "XAU_CloseCampaignBasketAtProtectedFloor" not in window
    assert "XAU_RequestCounterExcursionClose" not in window
    assert "XAU_RequestExhaustionCounterClose" not in window
    assert "return DIRECTION_TRANSITION_BLOCKED_LOSING;" in window


def test_transition_clear_when_no_opposite_campaign():
    ea = read(EA)
    fn = find_function(ea, "ENUM_XAU_DIRECTION_TRANSITION XAU_HandleOppositeDirectionTransition(int requestedDirection, string requestingFamily, string &detail)")
    idx = fn.index("if(count == 0)")
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
    guard_idx = fn.index('XAU_CanOpenDirection(signal, isManualOverride ? "MANUAL_FORCE" : "NORMAL_CORE",')
    send_idx = fn.index("if(signal == 1) requestOk = trade.Buy(lots, Symbol(), 0, sl, 0.0,")
    assert guard_idx < send_idx
    # nothing that sends an order may sit between the guard and the send
    between = fn[guard_idx:send_idx]
    assert "trade.Buy(" not in between and "trade.Sell(" not in between


def test_pyramid_add_calls_hard_guard_before_send():
    ea = read(EA)
    idx = ea.index('bool requestOk=isBuy?trade.Buy(addLot,Symbol(),0,pyramidSL,pyramidTP,"XAU-SNIPER|"+why)')
    preceding = ea[max(0, idx - 1200):idx]
    assert 'XAU_CanOpenDirection(isBuy ? 1 : -1, "PYRAMID", pyramidGuardReason,' in preceding
    assert "pyramidReservationId, pyramidExecutionKey" in preceding


def test_counter_excursion_calls_hard_guard_before_send():
    ea = read(EA)
    idx = ea.index("trade.SetExpertMagicNumber(InpCounterExcursionMagicNumber);\n   bool requestOk = (counterDir == 1) ? trade.Buy(lots")
    preceding = ea[max(0, idx - 1200):idx]
    assert 'XAU_CanOpenDirection(counterDir, "COUNTER_EXCURSION", counterGuardReason,' in preceding
    assert "counterReservationId, counterExecutionKey" in preceding


def test_all_three_send_paths_capture_and_can_release_reservation_on_failure():
    ea = read(EA)
    assert "directionReservationId" in ea and "XAU_ReleaseDirectionReservation(directionReservationId)" in ea
    assert "pyramidReservationId" in ea and "XAU_ReleaseDirectionReservation(pyramidReservationId)" in ea
    assert "counterReservationId" in ea and "XAU_ReleaseDirectionReservation(counterReservationId)" in ea


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
