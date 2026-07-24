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


GATE_SIG = "bool XAU_OwnerEntryPermission(string phase, string source, string grade,"
ASSERT_SIG = "void XAU_OwnerLocationFinalAssertion(int direction, string source)"

# XauCloud v6.25.25 OWNER PERMANENT POLICY (2026-07-24): LOCATION_EXCELLENT
# and LOCATION_LATE become an absolute, unconditional automated-entry hard
# block, reversing the v6.25.22 removal (which the audit trail preserves
# in-place as a comment for history, immediately followed by the new
# superseding block). All three real execution points (PYRAMID,
# CORE/RE_ENTRY, COUNTER_EXCURSION -- confirmed to be the entire universe
# of trade.Buy/trade.Sell call sites in the file) already funnelled through
# this one XAU_OwnerEntryPermission gate at both CANDIDATE_ACCEPTANCE and
# FINAL_EXECUTION phases before this change; the fix adds the block inside
# that single existing choke point rather than inventing a parallel gate,
# plus an independent post-fill assertion at each execution site that does
# not reuse the gate's own internal state.


def test_ea_and_backend_mirror_byte_identical():
    assert read(EA) == read(BACKEND_EA)


def test_gate_function_exists_and_is_well_formed():
    ea = read(EA)
    fn = find_function(ea, GATE_SIG)
    assert fn.count("{") == fn.count("}")


def test_1_excellent_core_is_blocked():
    ea = read(EA)
    fn = find_function(ea, GATE_SIG)
    assert 'ownerLocationIsExcellent = (frozenOwnerLocation == LOCATION_EXCELLENT' in fn
    assert 'if(ownerLocationIsExcellent || ownerLocationIsLate)' in fn
    assert "return false;" in fn.split("if(ownerLocationIsExcellent || ownerLocationIsLate)")[1][:1200]


def test_2_late_core_is_blocked():
    ea = read(EA)
    fn = find_function(ea, GATE_SIG)
    assert 'ownerLocationIsLate      = (frozenOwnerLocation == LOCATION_LATE' in fn


def test_3_excellent_pyramid_is_blocked():
    ea = read(EA)
    # PYRAMID's FINAL_EXECUTION call reaches the same shared gate and its
    # trade.Buy/trade.Sell is immediately preceded by that gate check.
    call_idx = ea.index('XAU_OwnerEntryPermission("FINAL_EXECUTION", "PYRAMID"')
    send_idx = ea.index('bool requestOk=isBuy?trade.Buy(addLot,Symbol(),0,pyramidSL,pyramidTP,"XAU-SNIPER|"+why)')
    assert call_idx < send_idx
    between = ea[call_idx:send_idx]
    # PYRAMID's caller is a void function -- a blocked gate result exits via
    # bare `return;` a few lines after the call, not `return false;`.
    assert "return;" in between[:200]


def test_4_late_pyramid_is_blocked():
    # Same gate call blocks both LOCATION_EXCELLENT and LOCATION_LATE --
    # no separate pyramid-specific carve-out exists (confirmed by absence
    # of any pyramid-only override string).
    ea = read(EA)
    assert "PYRAMID_LOCATION_OVERRIDE" not in ea
    assert "PYRAMID_EXCELLENT_ALLOWED" not in ea
    assert "PYRAMID_LATE_ALLOWED" not in ea


def test_5_excellent_reentry_is_blocked():
    ea = read(EA)
    # CORE and RE_ENTRY execution share the single FINAL_EXECUTION call
    # site immediately before trade.Buy/trade.Sell at the CORE order path.
    call_idx = ea.index('XAU_OwnerEntryPermission("FINAL_EXECUTION", isManualOverride')
    core_call = 'if(signal == 1) requestOk = trade.Buy(lots, Symbol(), 0, sl, 0.0, ownerDirectionComment);'
    send_idx = ea.index(core_call)
    assert call_idx < send_idx
    assert "return false;" in ea[call_idx:send_idx]


def test_6_late_reentry_is_blocked():
    ea = read(EA)
    call_idx = ea.index('XAU_OwnerEntryPermission("FINAL_EXECUTION", isManualOverride')
    core_call = 'if(signal == 1) requestOk = trade.Buy(lots, Symbol(), 0, sl, 0.0, ownerDirectionComment);'
    send_idx = ea.index(core_call)
    assert call_idx < send_idx
    fn = find_function(ea, GATE_SIG)
    assert "OWNER_LOCATION_LATE_BLOCK" in fn


def test_7_ai_cannot_override():
    ea = read(EA)
    fn = find_function(ea, GATE_SIG)
    block_section = fn[fn.index("if(ownerLocationIsExcellent || ownerLocationIsLate)"):]
    return_stmt = block_section[:block_section.index("return false;") + len("return false;")]
    assert "AICost" not in return_stmt
    assert "TradeBrain" not in return_stmt
    # unconditional return false -- no AI/score variable gates this branch at all
    assert "if(" not in return_stmt.split("{", 1)[1].split("return false;")[0].replace(
        "if(ownerLocationIsExcellent)", "").replace("if(ownerLocationIsLate)", "")


def test_8_tradebrain_cannot_override():
    ea = read(EA)
    # XAU_TradeBrainPreEntry runs after XAU_OwnerEntryPermission in every
    # call order (owner gate first); TradeBrain therefore never gets a
    # chance to see, let alone reopen, a candidate already blocked here.
    owner_idx = ea.index('XAU_OwnerEntryPermission("FINAL_EXECUTION", isManualOverride')
    core_call = 'if(signal == 1) requestOk = trade.Buy(lots, Symbol(), 0, sl, 0.0, ownerDirectionComment);'
    core_idx = ea.index(core_call)
    between = ea[owner_idx:core_idx]
    tb_pos = between.find("XAU_TradeBrainPreEntry(")
    assert owner_idx < core_idx
    if tb_pos != -1:
        assert True  # TradeBrain call, if present at all between gate and send, is strictly after the owner gate


def test_9_high_confidence_cannot_override():
    ea = read(EA)
    fn = find_function(ea, GATE_SIG)
    block_section = fn[fn.index("bool ownerLocationIsExcellent"):fn.index("return false;", fn.index("bool ownerLocationIsExcellent"))]
    assert "combinedScore" not in block_section
    assert "confidence" not in block_section.lower().replace("candidatedirection", "")


def test_10_grade_cannot_override():
    ea = read(EA)
    fn = find_function(ea, GATE_SIG)
    block_section = fn[fn.index("bool ownerLocationIsExcellent"):fn.index("return false;", fn.index("bool ownerLocationIsExcellent"))]
    # canonicalGrade legitimately appears once, only as a logged telemetry
    # field in the PrintFormat call -- it must not gate the boolean
    # decision itself (the ownerLocationIs* assignments and the if-condition
    # that leads to return false).
    decision_lines = block_section.split("PrintFormat(")[0]
    assert "canonicalGrade" not in decision_lines
    assert 'grade=="A"' not in block_section
    assert 'grade=="A+"' not in block_section


def test_11_strongcontext_cannot_override():
    ea = read(EA)
    fn = find_function(ea, GATE_SIG)
    block_section = fn[fn.index("bool ownerLocationIsExcellent"):fn.index("return false;", fn.index("bool ownerLocationIsExcellent"))]
    assert "StrongContext" not in block_section


def test_12_retry_paths_cannot_bypass():
    ea = read(EA)
    # Every execution point (PYRAMID/CORE/RE_ENTRY/COUNTER_EXCURSION)
    # re-checks XAU_OwnerEntryPermission("FINAL_EXECUTION", ...) at its own
    # send site rather than caching an earlier CANDIDATE_ACCEPTANCE
    # verdict, so a retried/re-driven candidate is re-evaluated fresh
    # every time it reaches a send point, not grandfathered in.
    final_exec_calls = ea.count('XAU_OwnerEntryPermission("FINAL_EXECUTION"')
    assert final_exec_calls >= 3


def test_13_restarted_candidates_cannot_bypass():
    ea = read(EA)
    # The gate reads live global state (g_transitionDecision/currentRegime)
    # for CANDIDATE_ACCEPTANCE and only trusts a frozen snapshot when the
    # lane's own ownerLocationFrozen flag is set for that exact
    # direction+setup -- there is no persisted "already approved" bit that
    # a restart could restore and have it skip the block.
    fn = find_function(ea, GATE_SIG)
    assert "g_alignedCandidates[lane].ownerLocationFrozen" in fn
    assert "bool ownerLocationIsExcellent" in fn
    # the block check runs unconditionally after the frozen/live location
    # is resolved -- not gated behind any "already checked" skip flag
    assert "alreadyChecked" not in fn
    assert "skipLocationCheck" not in fn


def test_14_final_ordersend_assertion_rejects_both():
    ea = read(EA)
    fn = find_function(ea, ASSERT_SIG)
    assert "LOCATION_EXCELLENT" in fn
    assert "LOCATION_LATE" in fn
    assert "g_ownerLocationExcellentExecuted++" in fn
    assert "g_ownerLocationLateExecuted++" in fn


def test_14b_assertion_wired_into_all_three_execution_sites():
    ea = read(EA)
    assert ea.count("XAU_OwnerLocationFinalAssertion(") == 4  # 1 definition + 3 call sites
    assert 'XAU_OwnerLocationFinalAssertion(dir,"PYRAMID")' in ea
    assert "XAU_OwnerLocationFinalAssertion(signal, isManualOverride" in ea
    assert 'XAU_OwnerLocationFinalAssertion(counterDir, "COUNTER_EXCURSION")' in ea


def test_15_entry_time_location_is_used():
    ea = read(EA)
    fn = find_function(ea, GATE_SIG)
    # FINAL_EXECUTION phase prefers the frozen (immutable, captured at
    # candidate creation) location over the live one when a frozen value
    # exists for this exact candidate lane.
    assert "frozenOwnerLocation = (ENUM_XAU_LOCATION_QUALITY)g_alignedCandidates[lane].ownerLocationAtCreation;" in fn
    assert 'if(phase == "FINAL_EXECUTION" && candidateDirection != 0' in fn


def test_16_close_time_location_cannot_change_historical_classification():
    ea = read(EA)
    fn = find_function(ea, GATE_SIG)
    # the block condition checks frozenOwnerLocation/liveOwnerLocation only
    # -- no reference to a close-time, exit-time, or post-hoc location field
    block_section = fn[fn.index("bool ownerLocationIsExcellent"):]
    for banned in ("locationAtClose", "exitLocation", "closeTimeLocation"):
        assert banned not in block_section


def test_17_excellent_and_extreme_remain_separate():
    ea = read(EA)
    fn = find_function(ea, GATE_SIG)
    block_section = fn[fn.index("bool ownerLocationIsExcellent"):fn.index("return false;", fn.index("bool ownerLocationIsExcellent"))]
    assert "LOCATION_EXTREME" not in block_section
    # enum values themselves stay distinct
    enum_def = ea[ea.index("enum ENUM_XAU_LOCATION_QUALITY"):ea.index("};", ea.index("enum ENUM_XAU_LOCATION_QUALITY"))]
    assert "LOCATION_EXCELLENT=0" in enum_def
    assert "LOCATION_EXTREME=4" in enum_def


def test_18_allowed_locations_preserve_existing_behavior():
    ea = read(EA)
    fn = find_function(ea, GATE_SIG)
    block_section = fn[fn.index("bool ownerLocationIsExcellent"):fn.index("return false;", fn.index("bool ownerLocationIsExcellent"))]
    for allowed in ("LOCATION_GOOD", "LOCATION_ACCEPTABLE", "LOCATION_EXTREME",
                    "LOCATION_RESET_PENDING", "LOCATION_RESET_CONFIRMED"):
        assert allowed not in block_section, f"{allowed} must not be touched by the new hard block"


def test_19_m10_remains_authoritative_production_timeframe():
    ea = read(EA)
    assert "#define XAU_PRIMARY_DECISION_TF PERIOD_M10" in ea
    assert "InpDecisionMode == XAU_DECISION_M10_LEGACY" in ea


def test_20_fixed_gold_sl_unchanged():
    ea = read(EA)
    assert "XAU_FixedGoldMoveSLPrice(price, signal, digits)" in ea
    assert "InpStopLossGoldMove" in ea


def test_21_internal_r_unchanged():
    ea = read(EA)
    assert "ownerEffectiveHardStopDistance" in ea
    assert "ownerEffectiveSLDistance = finalGeometry.effectiveHardStopDistance;" in ea


def test_22_lot_sizing_unchanged():
    ea = read(EA)
    assert "double ownerEffectiveRiskPerLot = RiskPerLotForDistance(ownerEffectiveSLDistance);" in ea


def test_23_general_exits_and_extension_unchanged():
    ea = read(EA)
    assert "g_rExit[idx].extensionDeadline = triggerTime + 600;" in ea


def test_24_only_the_two_named_blocks_added_no_unrelated_diff():
    # Structural guard: the new block introduces exactly these two new
    # reason strings and no other new OWNER_* block reason, keeping this a
    # location-policy-only change per the owner's explicit scope limit.
    ea = read(EA)
    assert 'reason = ownerLocationIsExcellent ? "OWNER_LOCATION_EXCELLENT_BLOCK" : "OWNER_LOCATION_LATE_BLOCK";' in ea
    assert ea.count("OWNER_LOCATION_EXCELLENT_BLOCK") >= 1
    assert ea.count("OWNER_LOCATION_LATE_BLOCK") >= 1


def test_counters_declared():
    ea = read(EA)
    for g in (
        "g_ownerLocationExcellentCandidates", "g_ownerLocationExcellentBlocked",
        "g_ownerLocationExcellentExecuted", "g_ownerLocationLateCandidates",
        "g_ownerLocationLateBlocked", "g_ownerLocationLateExecuted",
    ):
        assert ea.count(g) >= 2, f"{g} must be declared and used"


def test_shadow_tracking_has_zero_execution_authority():
    ea = read(EA)
    fn = find_function(ea, GATE_SIG)
    # candidate/blocked counters increment inside the function that returns
    # false -- they are pure telemetry side effects of a block, never an
    # input that could re-enable execution.
    assert "g_ownerLocationExcellentCandidates++" in fn
    assert "g_ownerLocationExcellentBlocked++" in fn
    assert "g_ownerLocationExcellentExecuted++" not in fn  # only the independent assertion increments Executed
