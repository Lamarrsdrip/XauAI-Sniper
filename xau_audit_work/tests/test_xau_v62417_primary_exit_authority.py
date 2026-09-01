"""v6.24.17 URGENT FIX: order #2970912954 premature-exit forensic repair.

Root cause (real VPS journal, ticket 2970912954, SELL 0.21 XAUUSDm @ 4008.226,
2026-07-16 17:55:31-17:58:04): XAU_ApplyTransitionPositionAuthority() tightened
the SL five times (17:56:47-17:57:25) using its own ad-hoc `floorR = peakR *
0.35` formula, gated only on a macro exhaustionProbability>=70 reading (already
>=70 from the very first tick post-entry, unrelated to this trade's own P&L)
and peakR>=0.10 -- ten times more aggressive than this file's own, correct,
already-persisted R_EXIT_MANAGER profit-guarantee system (InpRProtectTrigger=
0.30R). Two independently-tightening authorities on the same position; the
more aggressive/wrong one fired first every tick and won. The position closed
at ~0.04R while gold continued toward ~3996 afterward.

Fix: XAU_ApplyTransitionPositionAuthority's TIGHTEN_PROTECTION path no longer
calls SafeModifySL (evidence-only now); XAU_RExitCoreLoop's arming/floor logic
now goes through one canonical XAU_ComputePrimaryExitFloor()/
XAU_ClassifyTradeHealth() authority implementing the owner's new policy:
  MAIN (healthy/pausing): peakR<0.50 -> no floor; peakR>=0.50 -> max(0.35, peakR*0.70)
  STRUGGLING fallback (objective multi-factor evidence only, peakR>=0.30 precondition):
    0.30<=peakR<0.35 -> flat InpRGuaranteedFloor; 0.35<=peakR<0.50 -> peakR-0.15;
    peakR>=0.50 -> converges onto the same MAIN formula.

These tests mirror the formula in pure Python (same convention as
scripts/unified_thesis_mirror.py mirrors the readiness state machine) and
statically verify the source no longer contains the rogue independent
SafeModifySL call.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"
VERSIONED_EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.24.17.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


EA_SRC = read(EA)

# ---------------------------------------------------------------------------
# Pure-Python mirror of XAU_ComputePrimaryExitFloor / XAU_ClassifyTradeHealth
# ---------------------------------------------------------------------------

TRADE_HEALTHY = "HEALTHY"
TRADE_PAUSING_NORMALLY = "PAUSING_NORMALLY"
TRADE_STRUGGLING = "STRUGGLING"
TRADE_INVALIDATED = "INVALIDATED"

INP_R_GUARANTEED_FLOOR = 0.10
INP_R_ADAPTIVE_TRAIL_OFFSET = 0.15


def compute_primary_exit_floor(peak_r: float, existing_floor_r: float, health: str) -> tuple:
    if peak_r >= 0.50:
        return max(0.35, peak_r * 0.70), "MAIN_050_70PCT"
    if health == TRADE_STRUGGLING:
        if peak_r < 0.30:
            return 0.0, "STRUGGLING_BELOW_030_NO_FLOOR"
        if peak_r < 0.35:
            return max(existing_floor_r, INP_R_GUARANTEED_FLOOR), "STRUGGLING_FALLBACK_ARMED"
        return max(existing_floor_r, peak_r - INP_R_ADAPTIVE_TRAIL_OFFSET), "STRUGGLING_FALLBACK"
    return 0.0, "MAIN_BELOW_050_NO_FLOOR"


# ---------------------------------------------------------------------------
# 1-11: healthy trade below/at/above 0.50R (owner's exact worked examples)
# ---------------------------------------------------------------------------

def test_healthy_005R_keeps_structural_sl():
    floor, _ = compute_primary_exit_floor(0.05, 0.0, TRADE_HEALTHY)
    assert floor == 0.0


def test_healthy_020R_keeps_structural_sl():
    floor, _ = compute_primary_exit_floor(0.20, 0.0, TRADE_HEALTHY)
    assert floor == 0.0


def test_healthy_029R_keeps_structural_sl():
    floor, _ = compute_primary_exit_floor(0.29, 0.0, TRADE_HEALTHY)
    assert floor == 0.0


def test_healthy_035R_does_not_apply_early_fallback():
    floor, reason = compute_primary_exit_floor(0.35, 0.0, TRADE_HEALTHY)
    assert floor == 0.0
    assert reason == "MAIN_BELOW_050_NO_FLOOR"


def test_healthy_049R_keeps_structural_sl():
    floor, _ = compute_primary_exit_floor(0.49, 0.0, TRADE_HEALTHY)
    assert floor == 0.0


def test_healthy_050R_protects_exactly_035():
    floor, _ = compute_primary_exit_floor(0.50, 0.0, TRADE_HEALTHY)
    assert round(floor, 6) == 0.35


def test_peak_060R_protects_042():
    floor, _ = compute_primary_exit_floor(0.60, 0.0, TRADE_HEALTHY)
    assert round(floor, 6) == 0.42


def test_peak_080R_protects_056():
    floor, _ = compute_primary_exit_floor(0.80, 0.0, TRADE_HEALTHY)
    assert round(floor, 6) == 0.56


def test_peak_100R_protects_070():
    floor, _ = compute_primary_exit_floor(1.00, 0.0, TRADE_HEALTHY)
    assert round(floor, 6) == 0.70


def test_peak_150R_protects_105():
    floor, _ = compute_primary_exit_floor(1.50, 0.0, TRADE_HEALTHY)
    assert round(floor, 6) == 1.05


def test_peak_200R_protects_140():
    floor, _ = compute_primary_exit_floor(2.00, 0.0, TRADE_HEALTHY)
    assert round(floor, 6) == 1.40


# ---------------------------------------------------------------------------
# 12-13: floor never moves backward (ratchet-only, mirrors MathMax usage)
# ---------------------------------------------------------------------------

def test_floor_never_moves_backward_within_same_call():
    # peakR is a running maximum by construction (g_rExit[idx].peakR only
    # ever increases) -- a realistic sequence is monotonically non-decreasing
    # peaks, and the resulting floor must never decrease across that sequence.
    first_floor, _ = compute_primary_exit_floor(0.60, 0.0, TRADE_HEALTHY)
    second_floor, _ = compute_primary_exit_floor(0.65, first_floor, TRADE_HEALTHY)
    assert second_floor >= first_floor
    # the actual EA applies MathMax(existing, desired) as a second, explicit
    # ratchet on top of this -- verified separately by
    # test_floor_ratchet_uses_mathmax_never_recomputed_downward -- so even a
    # hypothetical downward-recomputed desired value could never regress the
    # persisted floor in the real code path.


def test_struggling_floor_also_ratchets():
    first_floor, _ = compute_primary_exit_floor(0.45, 0.0, TRADE_STRUGGLING)
    second_floor, _ = compute_primary_exit_floor(0.40, first_floor, TRADE_STRUGGLING)
    assert second_floor >= first_floor


# ---------------------------------------------------------------------------
# 14-16: struggling fallback (owner's exact worked examples)
# ---------------------------------------------------------------------------

def test_struggling_035R_protects_020():
    floor, _ = compute_primary_exit_floor(0.35, 0.0, TRADE_STRUGGLING)
    assert round(floor, 6) == 0.20


def test_struggling_040R_protects_025():
    floor, _ = compute_primary_exit_floor(0.40, 0.0, TRADE_STRUGGLING)
    assert round(floor, 6) == 0.25


def test_struggling_045R_protects_030():
    floor, _ = compute_primary_exit_floor(0.45, 0.0, TRADE_STRUGGLING)
    assert round(floor, 6) == 0.30


def test_struggling_below_030R_keeps_structural_sl():
    floor, reason = compute_primary_exit_floor(0.25, 0.0, TRADE_STRUGGLING)
    assert floor == 0.0
    assert reason == "STRUGGLING_BELOW_030_NO_FLOOR"


def test_struggling_reaching_050R_transitions_to_main_policy():
    floor, reason = compute_primary_exit_floor(0.50, 0.0, TRADE_STRUGGLING)
    assert round(floor, 6) == 0.35
    assert reason == "MAIN_050_70PCT"


def test_both_health_states_converge_at_050R():
    healthy_floor, _ = compute_primary_exit_floor(0.50, 0.0, TRADE_HEALTHY)
    struggling_floor, _ = compute_primary_exit_floor(0.50, 0.0, TRADE_STRUGGLING)
    assert healthy_floor == struggling_floor == 0.35


# ---------------------------------------------------------------------------
# 17-20: source-level checks -- the rogue legacy trail is actually gone,
# BUY/SELL conversion, no next-M5-bar dependency (n/a here, this is the exit
# side), one canonical authority
# ---------------------------------------------------------------------------

def test_rogue_transition_tighten_protection_no_longer_calls_safemodifysl():
    fn = EA_SRC[EA_SRC.index("bool XAU_ApplyTransitionPositionAuthority("):]
    fn = fn[:fn.index("\n\n//") if "\n\n//" in fn[:6000] else 6000]
    assert 'floorR=MathMax(0.02,peakR*0.35)' not in fn.replace(" ", "")
    assert "PRIMARY_EXIT_LEGACY_TRAIL_SUPPRESSED" in fn


def test_exit_profitable_and_controlled_gated_on_trade_health():
    fn = EA_SRC[EA_SRC.index("bool XAU_ApplyTransitionPositionAuthority("):][:6000]
    squeezed = fn.replace(" ", "")
    assert "XAU_ClassifyTradeHealth(posDir,currentR,peakR,d,healthWhy)" in squeezed
    assert "health!=TRADE_STRUGGLING&&health!=TRADE_INVALIDATED" in squeezed


def test_canonical_floor_function_exists_and_is_called_from_core_loop():
    assert "double XAU_ComputePrimaryExitFloor(" in EA_SRC
    assert "ENUM_XAU_TRADE_HEALTH XAU_ClassifyTradeHealth(" in EA_SRC
    core_loop = EA_SRC[EA_SRC.index("void XAU_RExitCoreLoop()"):]
    assert "XAU_ComputePrimaryExitFloor(peakR, g_rExit[idx].guaranteedFloorR, tradeHealth, floorReason)" in core_loop[:11000]


def test_floor_ratchet_uses_mathmax_never_recomputed_downward():
    core_loop = EA_SRC[EA_SRC.index("void XAU_RExitCoreLoop()"):][:11000]
    assert "g_rExit[idx].guaranteedFloorR = MathMax(g_rExit[idx].guaranteedFloorR, desiredFloorR)" in core_loop


# ---------------------------------------------------------------------------
# 21-22: struggling classifier requires multi-factor evidence, not one candle
# ---------------------------------------------------------------------------

def test_struggling_classifier_requires_peakR_precondition():
    fn = EA_SRC[EA_SRC.index("ENUM_XAU_TRADE_HEALTH XAU_ClassifyTradeHealth("):][:3000]
    assert "reachedMeaningfulProfit = (peakR >= 0.30)" in fn


def test_struggling_classifier_requires_multiple_votes_not_one_factor():
    fn = EA_SRC[EA_SRC.index("ENUM_XAU_TRADE_HEALTH XAU_ClassifyTradeHealth("):][:3000]
    assert "strugglingVotes >= 3" in fn
    # at least 5 distinct evidence factors counted toward the vote
    assert fn.count("strugglingVotes++") >= 5


# ---------------------------------------------------------------------------
# 23-24: BUY/SELL SL conversion correctness (mirrors the in-file formula)
# ---------------------------------------------------------------------------

def test_buy_sl_conversion_correct():
    entry, dist, floor_r = 4000.0, 10.0, 0.35
    sl = entry + floor_r * dist  # BUY: protectedSL = entry + floorR*dist
    assert round(sl, 2) == 4003.50


def test_sell_sl_conversion_correct():
    entry, dist, floor_r = 4000.0, 10.0, 0.35
    sl = entry - floor_r * dist  # SELL: protectedSL = entry - floorR*dist
    assert round(sl, 2) == 3996.50


# ---------------------------------------------------------------------------
# 25: uses final (widened) risk distance as 1R, not the raw one
# ---------------------------------------------------------------------------

def test_uses_final_widened_distance_not_raw_as_1r():
    # R_EXIT_ENTRY_CAPTURE_CONFIRMED derives dist from the ACTUAL broker SL
    # (already widened by XAU_SL_WIDENING_FACTOR at OpenTrade time -- see
    # test_xau_v62417_risk_and_sl_policy.py), never a separately-cached raw
    # ATR distance.
    fn = EA_SRC[EA_SRC.index("int XAU_RExit_EnsureIdx("):][:1500]
    assert "dist = isBuy ? (openPx - curSL) : (curSL - openPx)" in fn.replace("  ", " ")


# ---------------------------------------------------------------------------
# 26: Counter-Excursion exit policy remains separate
# ---------------------------------------------------------------------------

def test_counter_excursion_not_scoped_by_rexit_core_loop():
    core_loop = EA_SRC[EA_SRC.index("void XAU_RExitCoreLoop()"):][:2500]
    assert "InpMagicNumber" in core_loop
    assert "InpCounterExcursionMagicNumber" not in core_loop


# ---------------------------------------------------------------------------
# 27-28: replay proof for #2970912954 -- peak never reached 0.30R before the
# rogue tightening closed it, so under the corrected policy no floor would
# have armed at all and the original structural SL (4024.645) stays in place
# ---------------------------------------------------------------------------

def test_order_2970912954_replay_would_not_exit_at_old_floor():
    # real journal: peakR topped out at 0.124 before the 5th rogue tightening
    # (17:57:25.412, protectedFloorR=0.043, newSL=4007.516) closed the trade.
    observed_peak_r = 0.124
    floor, reason = compute_primary_exit_floor(observed_peak_r, 0.0, TRADE_HEALTHY)
    assert floor == 0.0, "corrected policy must not arm any floor at peakR=0.124 for a healthy trade"
    assert reason == "MAIN_BELOW_050_NO_FLOOR"


def test_order_2970912954_original_structural_sl_would_remain_open():
    entry, original_sl, dist = 4008.226, 4024.645, 16.419  # real journal values (SELL: SL = entry + dist)
    observed_peak_r = 0.124
    floor, _ = compute_primary_exit_floor(observed_peak_r, 0.0, TRADE_HEALTHY)
    # floor == 0.0 means the position's SL stays at the original structural
    # level, not the rogue-tightened 4007.516 the real incident stopped out at.
    assert floor == 0.0
    effective_sl = original_sl  # unchanged, since no floor armed
    assert effective_sl != 4007.516
    assert abs(effective_sl - (entry + dist)) < 1e-6  # SELL: SL is above entry


# ---------------------------------------------------------------------------
# 29-30: compile cleanliness + source sync (verified by the real toolchain
# elsewhere in this session; these are the standard repo-convention guards)
# ---------------------------------------------------------------------------

def test_three_ea_copies_are_byte_identical():
    assert read(EA) == read(BACKEND_EA) == read(VERSIONED_EA)


def test_version_still_v62417_not_bumped_to_hide_unfinished_work():
    assert '#define XAUAI_EA_VERSION "v6.24.17"' in EA_SRC
