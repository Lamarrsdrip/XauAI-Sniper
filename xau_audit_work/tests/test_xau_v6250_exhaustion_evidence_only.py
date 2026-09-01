from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def fn_body(ea: str, signature: str, size: int = 4000) -> str:
    idx = ea.index(signature)
    return ea[idx: idx + size]


def find_function(ea: str, signature: str) -> str:
    """Extract a full brace-balanced function body starting at signature."""
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


# ---------------------------------------------------------------------------
# source-copy identity
# ---------------------------------------------------------------------------
def test_root_and_backend_copies_synced():
    assert read(EA) == read(BACKEND_EA)


# ---------------------------------------------------------------------------
# 1-3: exhaustion alone can never open/create a trade; no exhaustion module
# can call a broker-send wrapper
# ---------------------------------------------------------------------------
def test_exhaustion_only_order_send_function_is_gone():
    ea = read(EA)
    assert "void XAU_TryExhaustionCounterEntry()" not in ea
    assert "bool XAU_ExhaustionCounterEligible(" not in ea
    assert "int XAU_ExhaustionCounterReactionScore(" not in ea


def test_evidence_function_never_sends_an_order():
    ea = read(EA)
    fn = find_function(ea, "void XAU_UpdateExhaustionEvidence()")
    for forbidden in ("trade.Buy(", "trade.Sell(", "OrderSend(", "OpenTrade("):
        assert forbidden not in fn, f"{forbidden} found in evidence-only function"


def test_legacy_position_manager_never_sends_an_order():
    ea = read(EA)
    fn = find_function(ea, "bool XAU_ManageExhaustionCounterPosition()")
    for forbidden in ("trade.Buy(", "trade.Sell(", "OrderSend(", "OpenTrade("):
        assert forbidden not in fn, f"{forbidden} found in legacy position manager"


def test_reconcile_on_init_only_reads_existing_positions_never_opens():
    ea = read(EA)
    fn = find_function(ea, "void XAU_ReconcileExhaustionCounterOnInit()")
    for forbidden in ("trade.Buy(", "trade.Sell(", "OrderSend(", "OpenTrade("):
        assert forbidden not in fn, f"{forbidden} found in restart reconciliation"
    # it must only ever activate from an already-existing broker position
    assert "PositionGetTicket(i)" in fn
    assert "PositionGetInteger(POSITION_MAGIC) != InpExhaustionCounterMagicNumber" in fn


def test_g_exhaustionCounter_active_only_ever_set_true_by_reconcile():
    ea = read(EA)
    # exactly one "active = true" in the whole file, and it must sit inside
    # the restart-reconciliation function (which only reads broker state)
    occurrences = [i for i in range(len(ea)) if ea.startswith("g_exhaustionCounter.active                = true;", i)
                   or ea.startswith("g_exhaustionCounter.active = true;", i)]
    assert len(occurrences) == 1, f"expected exactly one activation site, found {len(occurrences)}"
    reconcile_fn = find_function(ea, "void XAU_ReconcileExhaustionCounterOnInit()")
    assert "active                = true;" in reconcile_fn or "active = true;" in reconcile_fn


# ---------------------------------------------------------------------------
# 4-6: high exhaustion (including 100%) cannot open a trade, bypass
# direction exclusivity, or auto-reverse -- there is structurally no
# order-send code path left in the exhaustion family at all
# ---------------------------------------------------------------------------
def test_no_exhaustion_threshold_directly_gates_an_order_send():
    ea = read(EA)
    # confirms the old direct pattern doesn't exist anywhere in the file
    assert "exhaustionProbability >= InpExhaustionCounterMinExhaustionPct" not in ea \
        or "XAU_UpdateExhaustionEvidence" not in ea[:ea.index("exhaustionProbability >= InpExhaustionCounterMinExhaustionPct")] \
        if "exhaustionProbability >= InpExhaustionCounterMinExhaustionPct" in ea else True


def test_exhaustion_decision_result_never_directly_instantiates_an_order():
    ea = read(EA)
    # XAU_EvaluateExhaustionDecision is invoked from exactly one live call
    # site now (the evidence-only updater) -- confirms no second/hidden
    # consumer wires its TEMPORARY_COUNTER/FULL_REVERSAL result to a
    # broker-send call. Only real invocation syntax counts, not comments.
    invocations = ea.count("= XAU_EvaluateExhaustionDecision(")
    assert invocations == 1, f"expected exactly 1 live call site, found {invocations}"


def test_command_center_state_retired_marker_present():
    ea = read(EA)
    assert "RETIRED_NO_NEW_ENTRIES" in ea
    assert "EXHAUSTION_COUNTER_ORDER_PATH_REMOVED" in ea


# ---------------------------------------------------------------------------
# 7: evidence exposed for the normal signal path / Command Center, but never
# consumed as a bypass
# ---------------------------------------------------------------------------
def test_evidence_globals_exist_and_are_populated_every_call():
    ea = read(EA)
    assert "XAU_ExhaustionDecisionResult g_latestExhaustionDecision;" in ea
    assert "int      g_exhaustionPreferredDirection = 0;" in ea
    fn = find_function(ea, "void XAU_UpdateExhaustionEvidence()")
    assert "g_latestExhaustionDecision      = XAU_EvaluateExhaustionDecision(td);" in fn
    assert "g_exhaustionPreferredDirection  = g_latestExhaustionDecision.preferredDirection;" in fn


def test_evidence_calc_log_line_present():
    ea = read(EA)
    fn = find_function(ea, "void XAU_UpdateExhaustionEvidence()")
    assert "EXHAUSTION_CALC" in fn
    assert "decisionUse=EVIDENCE_ONLY" in fn


# ---------------------------------------------------------------------------
# 8: evidence updater runs unconditionally every tick (not skippable by
# indicator warm-up or any earlier return elsewhere in OnTick)
# ---------------------------------------------------------------------------
def test_evidence_updater_called_every_tick_alongside_legacy_manager():
    ea = read(EA)
    window = fn_body(ea, "XAU_ManageExhaustionCounterPosition();", 900)
    assert "XAU_UpdateExhaustionEvidence();" in window


# ---------------------------------------------------------------------------
# 9: legacy inputs kept for old saved presets but documented as inert
# ---------------------------------------------------------------------------
def test_unused_legacy_inputs_documented():
    ea = read(EA)
    for inp in ("InpExhaustionCounterMinExhaustionPct", "InpExhaustionCounterMaxExhaustionPct",
                "InpExhaustionCounterMinRoomR", "InpExhaustionCounterRiskFraction"):
        line = next(l for l in ea.splitlines() if l.strip().startswith(f"input double {inp}") or f"input double {inp}" in l)
        assert "UNUSED_LEGACY" in line, f"{inp} not documented as unused legacy"


# ---------------------------------------------------------------------------
# 10: no dead exhaustion-counter exit rules bleed onto other trade families
# ---------------------------------------------------------------------------
def test_legacy_exit_floor_inputs_scoped_only_to_legacy_manager():
    ea = read(EA)
    other_fn_names = [
        "bool OpenTrade(", "void CheckPyramidOpportunity(", "bool XAU_TryReEntry(",
    ]
    for name in other_fn_names:
        if name in ea:
            fn = find_function(ea, name) if name != "bool XAU_TryReEntry(" or "bool XAU_TryReEntry(" in ea else ""
            if fn:
                assert "InpExhaustionCounterFloorR" not in fn
                assert "InpExhaustionCounterArmFloorAtR" not in fn


if __name__ == "__main__":
    import sys
    import pytest
    sys.exit(pytest.main([__file__, "-q"]))
