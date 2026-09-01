"""v6.24.5: pre-OrderSend trade-horizon classification and structural SL
source labeling.

Static assertions verify the real .mq5 wiring (new enums, snapshot fields,
OpenTrade integration, default-off behavior flag). The two Python mirrors
below reproduce XAU_ClassifyTradeHorizon's and XAU_ComputeStructuralSL's
exact control flow (same thresholds, same branch order) as a deterministic
behavioral oracle, matching this repo's existing non-"_static" test pattern.
"""

from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.24.5.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"
COMPILE_LOG = ROOT / "compile_logs" / "v6245_horizon_structural_sl_compile.log"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def test_repo_source_is_synced_to_backend():
    assert read(EA) == read(BACKEND_EA)


def test_version_bumped_to_v6245():
    ea = read(BACKEND_EA)
    assert '#define XAUAI_EA_VERSION "v6.24.5"' in ea


def test_compile_clean():
    log = read(COMPILE_LOG)
    assert "Result: 0 errors, 0 warnings" in log


def test_trade_horizon_enum_has_all_six_states():
    ea = read(BACKEND_EA)
    for state in ("XAU_HORIZON_SCALP", "XAU_HORIZON_INTRADAY_TREND",
                  "XAU_HORIZON_SWING_RUNNER", "XAU_HORIZON_REVERSAL",
                  "XAU_HORIZON_PYRAMID_ADD", "XAU_HORIZON_COUNTER_EXCURSION"):
        assert state in ea


def test_sl_source_enum_has_all_six_labels():
    ea = read(BACKEND_EA)
    for label in ("SL_M5_SWING_INVALIDATION", "SL_M15_STRUCTURE_INVALIDATION",
                  "SL_H1_STRUCTURE_INVALIDATION", "SL_PULLBACK_INVALIDATION",
                  "SL_ORDER_BLOCK_INVALIDATION", "SL_EMERGENCY_VOLATILITY_INVALIDATION"):
        assert label in ea


def test_structural_sl_defaults_off_zero_live_behavior_change():
    # This is the safety property: without an explicit owner opt-in, today's
    # pure-ATR SL distance is unchanged.
    ea = read(BACKEND_EA)
    assert "input bool   InpUseStructuralSL = false;" in ea


def test_structural_sl_only_overrides_when_flag_enabled():
    ea = read(BACKEND_EA)
    assert "if(InpUseStructuralSL && slSrc == SL_M5_SWING_INVALIDATION)" in ea


def test_snapshot_carries_horizon_and_sl_source_fields():
    ea = read(BACKEND_EA)
    assert "ENUM_XAU_TRADE_HORIZON horizon;" in ea
    assert "ENUM_XAU_SL_SOURCE     slSource;" in ea


def test_opentrade_computes_structural_sl_and_updates_snapshot_before_lot_sizing():
    ea = read(BACKEND_EA)
    open_trade_start = ea.index("bool OpenTrade(int signal")
    structural_call = ea.index("XAU_ComputeStructuralSL(signal, atr, price, slDist")
    lot_sizing = ea.index("double slDollarPerLotRaw = RiskPerLotForDistance(slDist);")
    assert open_trade_start < structural_call < lot_sizing


def test_risk_margin_trace_reports_horizon_slsource_and_actual_risk_pct():
    ea = read(BACKEND_EA)
    assert "RISK_MARGIN_TRACE | horizon=%s slSource=%s" in ea
    assert "actualRiskPct=%.3f%%" in ea


def test_pyramid_and_counter_excursion_paths_remain_isolated_from_opentrade():
    # v6.24.5 does not change this: pyramid adds still bypass OpenTrade via
    # trade.Buy/trade.Sell directly (own SL math), and Counter-Excursion
    # still never calls OpenTrade -- both are legitimate Stage 3 targets for
    # bringing under the same structural-SL/horizon labeling, not silently
    # rewired here.
    ea = read(BACKEND_EA)
    assert "void CheckPyramidOpportunity()" in ea
    assert "void XAU_TryCounterExcursionEntry(" in ea


# ---------------------------------------------------------------------------
# Mirror of XAU_ClassifyTradeHorizon
# ---------------------------------------------------------------------------

TREND_EARLY, TREND_DEVELOPING, TREND_HEALTHY, TREND_MATURE = 0, 1, 2, 3
TREND_LATE, TREND_EXHAUSTING, TRANSITION_NEUTRAL = 4, 5, 6
OPPOSITE_DIRECTION_FORMING, OPPOSITE_DIRECTION_CONFIRMED = 7, 8

HORIZON_SCALP = "SCALP"
HORIZON_INTRADAY_TREND = "INTRADAY_TREND"
HORIZON_SWING_RUNNER = "SWING_RUNNER"
HORIZON_REVERSAL = "REVERSAL"
HORIZON_PYRAMID_ADD = "PYRAMID_ADD"
HORIZON_COUNTER_EXCURSION = "COUNTER_EXCURSION"


@dataclass
class TransitionDecision:
    dominantDirection: int
    remainingRewardR: float
    oppositeRemainingRewardR: float
    entryLocationQuality: float
    lifecycle: int


def classify_trade_horizon(signal: int, is_pyramid_add: bool, is_counter_excursion: bool,
                            td: TransitionDecision) -> str:
    if is_counter_excursion:
        return HORIZON_COUNTER_EXCURSION
    if is_pyramid_add:
        return HORIZON_PYRAMID_ADD

    aligned = signal == td.dominantDirection
    opposite_confirmed = td.lifecycle == OPPOSITE_DIRECTION_CONFIRMED
    if not aligned and opposite_confirmed:
        return HORIZON_REVERSAL

    room_r = td.remainingRewardR if aligned else td.oppositeRemainingRewardR
    if room_r < 1.0:
        return HORIZON_SCALP

    early_or_healthy = td.lifecycle in (TREND_EARLY, TREND_DEVELOPING, TREND_HEALTHY)
    if room_r >= 3.0 and td.entryLocationQuality >= 60.0 and early_or_healthy:
        return HORIZON_SWING_RUNNER

    return HORIZON_INTRADAY_TREND


def test_scenario_7_strong_campaign_completed_pullback_large_room_is_intraday_or_swing():
    td = TransitionDecision(dominantDirection=-1, remainingRewardR=3.5,
                             oppositeRemainingRewardR=0.0, entryLocationQuality=75.0,
                             lifecycle=TREND_HEALTHY)
    result = classify_trade_horizon(-1, False, False, td)
    assert result in (HORIZON_INTRADAY_TREND, HORIZON_SWING_RUNNER)
    assert result == HORIZON_SWING_RUNNER  # room>=3, location>=60, healthy -> runner


def test_scenario_8_same_shape_after_85_90pct_consumed_is_scalp_only():
    # heavy consumption is reflected as low remaining room
    td = TransitionDecision(dominantDirection=-1, remainingRewardR=0.4,
                             oppositeRemainingRewardR=0.0, entryLocationQuality=75.0,
                             lifecycle=TREND_EXHAUSTING)
    assert classify_trade_horizon(-1, False, False, td) == HORIZON_SCALP


def test_scenario_12_limited_local_room_is_scalp_not_swing_runner():
    td = TransitionDecision(dominantDirection=1, remainingRewardR=0.8,
                             oppositeRemainingRewardR=0.0, entryLocationQuality=90.0,
                             lifecycle=TREND_EARLY)
    assert classify_trade_horizon(1, False, False, td) == HORIZON_SCALP


def test_reversal_requires_opposite_confirmed_not_just_misalignment():
    td = TransitionDecision(dominantDirection=-1, remainingRewardR=2.0,
                             oppositeRemainingRewardR=2.5, entryLocationQuality=70.0,
                             lifecycle=OPPOSITE_DIRECTION_FORMING)  # forming, not confirmed
    # BUY against a dominant SELL that's only "forming" opposite evidence:
    # not yet a REVERSAL classification
    result = classify_trade_horizon(1, False, False, td)
    assert result != HORIZON_REVERSAL


def test_reversal_confirmed_opposite_direction():
    td = TransitionDecision(dominantDirection=-1, remainingRewardR=0.2,
                             oppositeRemainingRewardR=2.5, entryLocationQuality=70.0,
                             lifecycle=OPPOSITE_DIRECTION_CONFIRMED)
    assert classify_trade_horizon(1, False, False, td) == HORIZON_REVERSAL


def test_pyramid_add_flag_wins_over_everything_else():
    td = TransitionDecision(dominantDirection=1, remainingRewardR=5.0,
                             oppositeRemainingRewardR=0.0, entryLocationQuality=90.0,
                             lifecycle=TREND_EARLY)
    assert classify_trade_horizon(1, True, False, td) == HORIZON_PYRAMID_ADD


def test_counter_excursion_flag_wins_over_pyramid():
    td = TransitionDecision(dominantDirection=1, remainingRewardR=5.0,
                             oppositeRemainingRewardR=0.0, entryLocationQuality=90.0,
                             lifecycle=TREND_EARLY)
    assert classify_trade_horizon(1, True, True, td) == HORIZON_COUNTER_EXCURSION


# ---------------------------------------------------------------------------
# Mirror of XAU_ComputeStructuralSL's sanity-bound gate
# ---------------------------------------------------------------------------

def structural_sl_source(signal: int, entry_price: float, swing_low: float,
                          swing_high: float, buffer: float, atr_floor_dist: float) -> str:
    if signal == 1 and swing_low > 0.0 and swing_low < entry_price:
        candidate_dist = (entry_price - swing_low) + buffer
    elif signal == -1 and swing_high > 0.0 and swing_high > entry_price:
        candidate_dist = (swing_high - entry_price) + buffer
    else:
        return "SL_EMERGENCY_VOLATILITY_INVALIDATION"
    lo, hi = atr_floor_dist * 0.5, atr_floor_dist * 4.0
    if candidate_dist < lo or candidate_dist > hi:
        return "SL_EMERGENCY_VOLATILITY_INVALIDATION"
    return "SL_M5_SWING_INVALIDATION"


def test_scenario_21_wider_structural_sl_still_yields_smaller_lot_same_risk_pct():
    # formula proof, not a broker-specific claim: lot = riskUSD / (slDist * k)
    # for a fixed k (money-per-point-per-lot), a wider slDist strictly
    # decreases rawLot while riskUSD (balance * riskPct) stays fixed.
    balance, risk_pct, k = 10_000.0, 15.0, 100.0
    risk_usd = balance * risk_pct / 100.0
    tight_sl_dist, wide_sl_dist = 3.0, 9.0
    lot_tight = risk_usd / (tight_sl_dist * k)
    lot_wide = risk_usd / (wide_sl_dist * k)
    assert lot_wide < lot_tight
    # both still express exactly risk_pct of balance when realized at their own SL
    assert abs(lot_tight * tight_sl_dist * k - risk_usd) < 1e-9
    assert abs(lot_wide * wide_sl_dist * k - risk_usd) < 1e-9


def test_scenario_22_tighter_sl_yields_larger_raw_lot():
    balance, risk_pct, k = 10_000.0, 15.0, 100.0
    risk_usd = balance * risk_pct / 100.0
    assert (risk_usd / (2.0 * k)) > (risk_usd / (6.0 * k))


def test_scenario_24_normal_pullback_within_bounds_uses_structural_swing():
    # entry at 100, swing low at 97 (3.0 away), buffer 0.2 -> 3.2 candidate,
    # atr-floor distance 3.0 -> bounds [1.5, 12.0] -> within bounds
    assert structural_sl_source(1, 100.0, 97.0, 0.0, 0.2, 3.0) == "SL_M5_SWING_INVALIDATION"


def test_scenario_25_confirmed_opposite_structure_falls_back_no_widening_beyond_bound():
    # swing level absurdly far away (e.g. stale/illiquid read) must not
    # produce an oversized stop -- falls back to the safe ATR distance
    assert structural_sl_source(1, 100.0, 50.0, 0.0, 0.2, 3.0) == "SL_EMERGENCY_VOLATILITY_INVALIDATION"


def test_no_swing_available_falls_back_to_atr():
    assert structural_sl_source(-1, 100.0, 0.0, 0.0, 0.2, 3.0) == "SL_EMERGENCY_VOLATILITY_INVALIDATION"


def test_swing_on_wrong_side_of_entry_falls_back_to_atr():
    # BUY with a swing "low" above entry price is nonsensical -> ignored
    assert structural_sl_source(1, 100.0, 101.0, 0.0, 0.2, 3.0) == "SL_EMERGENCY_VOLATILITY_INVALIDATION"


def test_candidate_too_tight_falls_back_to_atr():
    # 0.3 away vs atr-floor 3.0 -> below the 0.5x=1.5 lower bound
    assert structural_sl_source(1, 100.0, 99.7, 0.0, 0.0, 3.0) == "SL_EMERGENCY_VOLATILITY_INVALIDATION"
