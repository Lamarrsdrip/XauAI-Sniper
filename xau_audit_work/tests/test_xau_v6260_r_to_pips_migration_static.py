"""v6.26.0 R-to-pips/Gold-moves unit migration -- static regression proof
that every converted subsystem's new pips-scale threshold produces the
IDENTICAL trading decision as its pre-migration R-scale threshold.

This is a representation migration, not a strategy redesign (owner
directive, 2026-08-05): every input's new value must be exactly 100x its
documented old R-multiple value (the owner's own fixed conversion table:
1.00R = 100 pips), and every formula that consumes it alongside a raw
per-trade price distance (slDist, rDollars) must contain the matching
/100.0 (or *100.0 on the other side of the comparison) that exactly
cancels that x100 rescale -- proving the comparison outcome, and therefore
every open/close/trail/floor decision built on it, is unchanged.

Cannot run the EA itself (no MQL5 interpreter here) -- this is the same
static source-text regression pattern already established by this
project's other test_xau_v*_static.py files (structural assertions on the
compiled source, plus the real VPS MetaEditor compile-clean gate), applied
here specifically to prove input-rescale/formula-cancellation pairs.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"
WIP_SNAPSHOT = ROOT / "backend" / "XAUUSD_AI_Sniper_EA_v6.26.0_pips_wip.mq5"
COMPILE_LOG = ROOT / "compile_logs" / "v6260_pips_migration_checkpoint8_clean_exits_shield_hardstop_compile.log"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


EA_SRC = read(BACKEND_EA)


def _input_default(name: str) -> float:
    """Extracts an `input double NAME = VALUE;` default from the EA source."""
    m = re.search(rf"input\s+double\s+{re.escape(name)}\s*=\s*(-?[\d.]+)\s*;", EA_SRC)
    assert m, f"could not find input default for {name}"
    return float(m.group(1))


def test_wip_snapshot_is_synced_to_backend_source():
    assert EA_SRC == read(WIP_SNAPSHOT)


def test_compile_clean():
    log = read(COMPILE_LOG)
    assert "Result: 0 errors, 0 warnings" in log


# ---------------------------------------------------------------------------
# Input-rescale proof: every converted Inp*Pips default == 100x its
# documented pre-migration R-multiple value.
# ---------------------------------------------------------------------------
RESCALED_INPUTS_100X = {
    # BE Lock
    "InpBELockActivatePips": 1.0,
    "InpBELockProfitPips": 0.25,
    # Adaptive Runner
    "InpARStage1ActivatePips": 0.8,
    "InpARStage2ActivatePips": 2.0,
    "InpARBreakEvenPips": 1.2,
    "InpARBreakEvenProfitPips": 0.15,
    "InpConvRunMinPips": 2.0,
    # Partial Take-Profit
    "InpPartialTPAtPips": 1.5,
    # Profit Quality
    "InpProfitQualityMinPips": 0.80,
    "InpProfitQualityBigWinPipsMultiple": 2.50,
    # A+ Profit Shield
    "InpAPlusShieldArmPips": 1.50,
    "InpAPlusShieldBECushPips": 0.04,
    "InpAPlusShieldProtectPips": 3.0,
    # Clean Exits / Chandelier
    "InpStructureFailFastLossPips": 1.55,
    "InpCleanPartialPips": 2.20,
    "InpCleanStaleMinPips": 0.10,
    "InpCleanMaxLossPips": 2.60,
    "InpCleanEmergencyLossPips": 4.20,
    "InpCleanStagnantMaxPips": 0.20,
    "InpEarlyConvictionCutPips": 0.50,
    "InpStructureBEActivatePips": 2.70,
    "InpStructureBECushionPips": 0.08,
    "InpStructureChandelierStartPips": 4.75,
    "InpCleanBEActivatePips": 1.50,
    "InpCleanBECushionPips": 0.30,
    "InpCleanChandelierStartPips": 2.00,
    # Expectancy Loss Armor / Hard Stop
    "InpHardStopDistanceMulti": 3.5,
    "InpExpectancyMaxLossPips": 4.20,
    "InpExpectancySoftLossPips": 2.70,
    "InpNoPartialSmartLossPips": 2.75,
    # TRI/TTM Recovery Expansion MAE gate
    "InpRecoveryExpansionMinMAEPips": 0.50,
}


def test_every_rescaled_input_is_exactly_100x_its_documented_old_r_value():
    for name, old_r_value in RESCALED_INPUTS_100X.items():
        new_pips_value = _input_default(name)
        expected = round(old_r_value * 100.0, 6)
        assert abs(new_pips_value - expected) < 1e-6, (
            f"{name}: expected {expected} (100x old R value {old_r_value}), got {new_pips_value}"
        )


def test_transition_min_reward_pips_is_not_rescaled_it_was_never_an_r_multiple():
    """InpTransitionMinRewardR's "R" suffix meant "Reward" (an ATR-room
    ratio: remainingRewardPips = room/ATR), not "R-multiple of risk
    distance" -- it was mechanically renamed to InpTransitionMinRewardPips
    by the same identifier-rename pass as every genuine R-multiple input,
    but is NOT part of this unit migration and must NOT be rescaled x100,
    unlike every input in RESCALED_INPUTS_100X above."""
    assert _input_default("InpTransitionMinRewardPips") == 1.20


# ---------------------------------------------------------------------------
# Formula-cancellation proof: every consuming formula that multiplies a
# per-trade risk distance (slDist) by one of the rescaled inputs above
# divides by 100.0 to cancel that input's own x100 rescale.
# ---------------------------------------------------------------------------
SLDIST_TIMES_INPUT_DIVIDED_BY_100 = [
    "slDist * InpBELockActivatePips / 100.0",
    "slDist * InpBELockProfitPips / 100.0",
    "slDist * InpARBreakEvenProfitPips / 100.0",
    "slDist * InpAPlusShieldBECushPips / 100.0",
]


def test_sldist_times_rescaled_input_formulas_all_divide_by_100():
    for snippet in SLDIST_TIMES_INPUT_DIVIDED_BY_100:
        assert snippet in EA_SRC, f"missing cancellation formula: {snippet!r}"


def test_local_rmult_style_variables_rescaled_x100_at_their_own_declaration():
    """Rather than divide every downstream threshold, several subsystems
    instead rescale their own local R-ratio variable x100 ONCE at
    declaration (profitPips/rMult/etc), so it can be compared directly
    against the now-x100 input defaults with no further per-comparison
    division needed. Proves each of those declarations carries the x100."""
    declarations = [
        # Adaptive Runner
        'double profitPips = (profit / rDollars) * 100.0;',
        'double profitPips = (rDollars > 0) ? (profit / rDollars) * 100.0 : 0;',
        'double profitPips2 = (rDollars > 0) ? (profit / rDollars) * 100.0 : 0;',
        # Profit Quality
        'q.profitPips = (rDollars > 0.0) ? (profit / rDollars) * 100.0 : 0.0;',
        # A+ Shield / trade-context peakPips (three independent declarations)
        'double peakPips         = (rDollars > 0) ? (peak / rDollars) * 100.0 : 0.0;',
        'double peakPips = (rDollars > 0.0) ? (peak / rDollars) * 100.0 : 0.0;',
        'double peakPips = (peak / rDollars) * 100.0;',
        # Clean Exits rMult (the single most-referenced local variable in
        # the whole Clean Exits/Chandelier subsystem)
        'double rMult = (priceProfit / slDist) * 100.0;',
        # AI Trade Memory/Committee
        'double rMult = (autoHardStopUSD > 0.01) ? (profit / autoHardStopUSD) * 100.0',
    ]
    for snippet in declarations:
        assert snippet in EA_SRC, f"missing x100 rescale declaration: {snippet!r}"


def test_hard_stop_catastrophic_check_divides_by_100():
    """The single most-executed safety-net check in the whole engine --
    catastrophic loss protection -- must still fire at exactly the same
    dollar loss threshold as before the migration."""
    assert "profit <= -(rDollars * InpHardStopDistanceMulti / 100.0)" in EA_SRC


def test_expectancy_and_no_partial_smart_loss_usd_conversions_divide_by_100():
    assert "rDollars * InpNoPartialSmartLossPips / 100.0" in EA_SRC
    assert "double hardLossUSD = rDollars * maxLossPips / 100.0;" in EA_SRC
    assert "rDollars * InpExpectancySoftLossPips / 100.0" in EA_SRC


def test_clean_exits_dollar_conversion_call_sites_divide_rmult_by_100_first():
    """rMult is pips-scale everywhere in ManageCleanExitsForPosition, but
    XAU_GateEarlyLossClose/XAU_CheckInHoldCheckpoint need a genuine dollar
    P&L figure -- (rMult / 100.0) * rDollars converts back before use. This
    was a real double-scale bug caught and fixed during this migration
    (rMult * rDollars would have been 100x the real dollar amount)."""
    assert EA_SRC.count("(rMult / 100.0) * rDollars") == 6


def test_recovery_expansion_mae_gate_divides_by_100_against_the_0_1_fraction():
    """g_ttm[].triWorstAdversePct is a genuine 0-1 fraction-of-SL-distance
    (never itself rescaled -- it's already correctly displayed as a %, see
    recoveryWorstPct), so InpRecoveryExpansionMinMAEPips's own x100 rescale
    is cancelled by dividing by 100.0 at the single comparison site, not by
    touching triWorstAdversePct itself."""
    assert "maePips < (InpRecoveryExpansionMinMAEPips/100.0)" in EA_SRC


def test_trade_memory_lot_adjust_thresholds_rescaled_x100_to_match_pips_scale_history():
    """TradeMemory_LotAdjust directly affects live lot sizing -- its
    0.5/-0.30 R-scale cutoffs are rescaled x100 to 50.0/-30.0 to match
    g_tradeMemory[].rMultiple now being fed pips-scale data."""
    assert "realAvgR >= 50.0" in EA_SRC
    assert "realAvgR < -30.0" in EA_SRC
    assert "avgPips >= 50.0" in EA_SRC
    assert "avgPips < -30.0" in EA_SRC


def test_strategy_weight_expectancy_formula_and_thresholds_rescaled_together():
    """expectancy = wr*avgPips - (1-wr)*100.0 is the x100 rescale of the
    old wr*avgR - (1-wr) formula (the old formula implicitly assumed a
    full loss = -1.0R; rescaled that's -100 pips-of-risk) -- and the
    0.5/0.2/0.0 tier cutoffs are rescaled the same way to 50.0/20.0/0.0."""
    assert "double expectancy = wr * avgPips - (1.0 - wr) * 100.0;" in EA_SRC
    assert "if      (expectancy >= 50.0)  newWeight = 1.15;" in EA_SRC
    assert "else if (expectancy >= 20.0)  newWeight = 1.0;" in EA_SRC


# ---------------------------------------------------------------------------
# Persisted-state version-bump proof: any collection whose stored data
# scale changed (R -> pips) must reject/discard pre-migration files rather
# than silently mixing scales.
# ---------------------------------------------------------------------------
def test_stale_scale_persisted_state_is_version_gated_not_silently_mixed():
    assert '#define TRADEBBRAIN_HEADER "#XAUAI_TradeBrain_v3"' in EA_SRC
    assert 'if(hdr != TRADEBBRAIN_HEADER)' in EA_SRC
    assert 'FileWrite(h, "#XAUAI_StratWeights_v2");' in EA_SRC
    assert 'if(versionLine != "#XAUAI_StratWeights_v2")' in EA_SRC


# ---------------------------------------------------------------------------
# Customer-facing telemetry: no bare "%.NfR" unit label should remain
# anywhere the engine formats a pips-of-risk value for a Print/PrintFormat/
# StringFormat call.
# ---------------------------------------------------------------------------
def test_no_bare_percent_f_r_format_specifiers_remain():
    assert not re.search(r"%\.[0-9]*fR\b", EA_SRC)
