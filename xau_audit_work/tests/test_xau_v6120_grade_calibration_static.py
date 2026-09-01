from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.12.0.mq5"


def body(src: str, name: str) -> str:
    start = src.index(name)
    brace = src.index("{", start)
    depth = 0
    for i in range(brace, len(src)):
        if src[i] == "{":
            depth += 1
        elif src[i] == "}":
            depth -= 1
            if depth == 0:
                return src[start : i + 1]
    raise AssertionError(f"Could not find body for {name}")


def test_late_bad_location_cannot_remain_clean_a_plus():
    src = EA.read_text()
    timing = body(src, "bool XAUEntryTimingGuard")
    assert "XAU_APlusEntryLocationQualified(" in timing
    assert "badLocation" in timing
    assert "betterValue" in timing
    assert "aPlusLocationQualified" in timing
    assert "XAU_APlusPositioningQualified" in timing
    assert "aPlusLocationQualified;" in timing


def test_continuation_quality_keeps_local_location_penalty_visible():
    src = EA.read_text()
    timing = body(src, "bool XAUEntryTimingGuard")
    assert "localDirectionalRoomATR < InpXAU_MinDirectionalRoomATR" in timing
    assert "value=no" not in timing  # runtime literal should come from betterValue, not fixed text
    assert "CALIBRATED_ENTRY_QUALITY" in timing
    assert "entryTimingQuality=" in timing
    assert "extensionRisk=" in timing
    assert "expectedMAERisk=" in timing
    assert "effectiveRRQuality=" in timing


def test_high_grade_size_floor_does_not_override_timing_risk_reduction():
    src = EA.read_text()
    trade_flow = src[src.index("double finalSzMultSoftReduced") : src.index("// ======= PRE-OPENTRADE LOT AUDIT")]
    assert "bool timingQualityReduced = (lta_timing < 0.999)" in trade_flow
    assert "&& !timingQualityReduced" in trade_flow
    assert "A+/A FLOOR SKIPPED (TIMING-RISK)" in trade_flow


def test_ev_protect_does_not_choke_positive_hold_ev_runner():
    src = EA.read_text()
    smart_exit = body(src, "bool XAU_SmartExit3Layer")
    assert "evHoldEdgeStrong" in smart_exit
    assert "evThesisHealthyProtect" in smart_exit
    assert "InpSmartExitStrongLockPct" in smart_exit
    assert "EV_PROTECT_RUNNER_BREATHE" in smart_exit


def test_ampl_widens_trail_for_healthy_aligned_runner():
    src = EA.read_text()
    clean = src[src.index("// ============ v6.4.3 ADAPTIVE MOMENTUM PROFIT LOCK") : src.index("// ============ END AMPL")]
    assert "amplRunnerHealthy" in clean
    assert "MathMax(trailATR, InpStructureChandelierATR2 * 0.55)" in clean
    assert "AMPL_RUNNER_BREATHE" in clean
