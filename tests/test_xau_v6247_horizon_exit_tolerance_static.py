"""v6.24.7: exit-hierarchy precedence documented; PEAK_RETRACE tolerance
becomes horizon-aware for SWING_RUNNER/INTRADAY_TREND tickets.

Design constraint verified here: the change is additive-only (MathMax
against the existing InpPreservationMode-derived threshold), so it can
only ever make the EA MORE tolerant of normal noise for trend/swing
trades -- never less tolerant than today's baseline for any trade,
including SCALP or unclassified/legacy tickets opened before this version.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.24.7.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"
COMPILE_LOG = ROOT / "compile_logs" / "v6247_horizon_exit_tolerance_compile.log"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def test_repo_source_is_synced_to_backend():
    assert read(EA) == read(BACKEND_EA)


def test_version_bumped_to_v6247():
    ea = read(BACKEND_EA)
    assert '#define XAUAI_EA_VERSION "v6.24.7"' in ea


def test_compile_clean():
    log = read(COMPILE_LOG)
    assert "Result: 0 errors, 0 warnings" in log


def test_exit_hierarchy_precedence_documented_above_manage_positions():
    ea = read(BACKEND_EA)
    doc_idx = ea.index("EXIT-HIERARCHY PRECEDENCE")
    fn_idx = ea.index("void ManagePositions()")
    assert doc_idx < fn_idx
    assert fn_idx - doc_idx < 2000  # documentation sits directly above it


def test_ttm_record_stores_horizon_from_the_snapshot_opentrade_used():
    ea = read(BACKEND_EA)
    assert "ENUM_XAU_TRADE_HORIZON horizon;" in ea
    assert "r.horizon            = g_latestDecisionSnapshot.horizon;" in ea


def test_peak_retrace_widening_is_additive_only_via_mathmax():
    ea = read(BACKEND_EA)
    section = ea[ea.index("horizon-aware tolerance, additive only"):][:900]
    assert "effRetracePct = MathMax(effRetracePct, 90.0);" in section
    assert "effPeakMin    = MathMax(effPeakMin, 200.0);" in section
    # never a raw assignment that could narrow tolerance below the existing baseline
    assert "effRetracePct =" not in section.replace("effRetracePct = MathMax(effRetracePct, 90.0);", "")
    assert "effPeakMin =" not in section.replace("effPeakMin    = MathMax(effPeakMin, 200.0);", "").replace(" ", "")


def test_horizon_widening_only_applies_to_swing_runner_and_intraday_trend():
    ea = read(BACKEND_EA)
    section = ea[ea.index("horizon-aware tolerance, additive only"):][:900]
    assert "XAU_HORIZON_SWING_RUNNER" in section
    assert "XAU_HORIZON_INTRADAY_TREND" in section
    assert "XAU_HORIZON_SCALP" not in section
    assert "XAU_HORIZON_REVERSAL" not in section
    assert "XAU_HORIZON_PYRAMID_ADD" not in section


def test_legacy_or_unclassified_tickets_are_unaffected():
    # ttmIdx<0 (no TTM slot, e.g. a position opened before this version, or
    # pyramid/Counter-Excursion which never call TTM_RecordEntry) must fall
    # straight through to the pre-existing InpPreservationMode-only logic.
    ea = read(BACKEND_EA)
    section = ea[ea.index("horizon-aware tolerance, additive only"):][:900]
    assert "retraceTtmIdx >= 0" in section


# ---------------------------------------------------------------------------
# Behavioral mirror of the widening formula
# ---------------------------------------------------------------------------

XAU_HORIZON_SCALP = "SCALP"
XAU_HORIZON_INTRADAY_TREND = "INTRADAY_TREND"
XAU_HORIZON_SWING_RUNNER = "SWING_RUNNER"
XAU_HORIZON_REVERSAL = "REVERSAL"
XAU_HORIZON_PYRAMID_ADD = "PYRAMID_ADD"


def effective_retrace_threshold(preservation_mode: bool, inp_retrace_pct: float,
                                 inp_peak_min: float, horizon: str | None) -> tuple:
    eff_retrace = max(inp_retrace_pct, 90.0) if preservation_mode else inp_retrace_pct
    eff_peak_min = max(inp_peak_min, 200.0) if preservation_mode else inp_peak_min
    if horizon in (XAU_HORIZON_SWING_RUNNER, XAU_HORIZON_INTRADAY_TREND):
        eff_retrace = max(eff_retrace, 90.0)
        eff_peak_min = max(eff_peak_min, 200.0)
    return eff_retrace, eff_peak_min


def test_scalp_horizon_unaffected_preservation_off():
    retrace, peak_min = effective_retrace_threshold(False, 50.0, 100.0, XAU_HORIZON_SCALP)
    assert (retrace, peak_min) == (50.0, 100.0)


def test_intraday_trend_gets_more_tolerance_even_with_preservation_off():
    retrace, peak_min = effective_retrace_threshold(False, 50.0, 100.0, XAU_HORIZON_INTRADAY_TREND)
    assert retrace == 90.0
    assert peak_min == 200.0


def test_swing_runner_never_narrower_than_preservation_mode_baseline():
    # preservation mode already set a HIGHER bar (95%) than the horizon
    # floor (90%) -- horizon widening must not pull it back down
    retrace, peak_min = effective_retrace_threshold(True, 95.0, 500.0, XAU_HORIZON_SWING_RUNNER)
    assert retrace == 95.0
    assert peak_min == 500.0


def test_unclassified_horizon_falls_through_to_preservation_mode_only():
    retrace, peak_min = effective_retrace_threshold(True, 80.0, 150.0, None)
    assert retrace == 90.0  # from preservation mode, not horizon
    assert peak_min == 200.0
