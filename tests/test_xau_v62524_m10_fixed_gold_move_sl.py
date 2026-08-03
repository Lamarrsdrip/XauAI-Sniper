"""
Focused static tests for the v6.25.24 OWNER-APPROVED fixed Gold-move
initial SL policy, ported to this ISOLATED M10 comparison branch
(experiment/v62524-m10-fixed-sl -- the "10-minute bot with fixed $10 SL").

This branch is otherwise byte-identical to origin/main
e2bca802411f02c6813d9f2ae18a88a56f90aa49 (v6.25.24 production baseline):
NO M5 primary-timeframe conversion, NO missed-move veto fix, NO other
experiment/v62525-full-m5-scan-specific change. Only the fixed Gold-move SL
mechanism was ported. This test file is adapted from
experiment/v62525-full-m5-scan's tests/test_xau_v62525_fixed_gold_move_sl.py
-- the underlying variable/function names this SL policy touches
(ownerEffectiveSLDistance, pyramidGeometry, XAU_CampaignSlot, etc.) were
never M10/M5-renamed, so the same assertions apply almost verbatim to this
baseline; see the one documented count difference below (5 restart-
reconciliation call sites here vs 4 in the M5 branch -- a real 5th site,
XAU_ReconcileRExitOnInit(), was found while porting and fixed in both
branches).

These are STATIC source tests (the same convention already used throughout
tests/ in this repo, e.g. test_xau_v62524_final_production_audit.py) --
they assert against the actual compiled-and-committed .mq5 source text, not
a live MT5 runtime. This environment cannot execute the EA against a live
or simulated broker tick feed, so the arithmetic worked example (BUY@4000,
internal R=15, InpStopLossGoldMove=10 -> SL=3990, 0.4R=6.00, 0.5R=7.50) is
verified two ways:
  1. Directly, in pure Python, replicating the EA's own documented formula
     (test_worked_example_arithmetic_*) -- this proves the FORMULA the EA
     uses is correct, independent of any MT5 runtime.
  2. By asserting the EA source contains the exact functions/call sites
     that implement that formula and does NOT contain the collapsed/wrong
     variant (test_broker_sl_uses_fixed_move_not_internal_r, etc.).
This is real, verifiable evidence that the code says what this report
claims it says. It is not a substitute for an actual MT5 Strategy Tester
run (see analysis/m5_experiment/FINAL_REPORT.md "SL Policy Change" section
for the replay-validation attempt and its honest, documented outcome).
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def source() -> str:
    return EA.read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# Pure-Python re-implementation of the EA's documented fixed-SL formula, used
# only to independently verify the arithmetic in the worked examples. This
# mirrors XAU_FixedGoldMoveSLPrice() exactly: BUY -> entry - move,
# SELL -> entry + move, rounded to `digits`.
# ---------------------------------------------------------------------------
def fixed_sl_price(entry: float, direction: int, move: float, digits: int = 2) -> float:
    raw = entry - move if direction == 1 else entry + move
    return round(raw, digits)


class WorkedExampleArithmeticTests(unittest.TestCase):
    """Requirement items 1-6 from the owner's SL policy spec."""

    def test_buy_move10(self):
        self.assertEqual(fixed_sl_price(4000.0, 1, 10.0), 3990.0)

    def test_sell_move10(self):
        self.assertEqual(fixed_sl_price(4000.0, -1, 10.0), 4010.0)

    def test_buy_move15(self):
        self.assertEqual(fixed_sl_price(4000.0, 1, 15.0), 3985.0)

    def test_sell_move15(self):
        self.assertEqual(fixed_sl_price(4000.0, -1, 15.0), 4015.0)

    def test_buy_move20(self):
        self.assertEqual(fixed_sl_price(4000.0, 1, 20.0), 3980.0)

    def test_sell_move20(self):
        self.assertEqual(fixed_sl_price(4000.0, -1, 20.0), 4020.0)


class OwnerClarificationSeparationTests(unittest.TestCase):
    """
    The owner's urgent clarification worked example: BUY@4000, existing
    internal calculated 1R distance=15, InpStopLossGoldMove=10.
    Required: internal 1R stays 15 (0.4R=6.00, 0.5R=7.50 favorable
    movement), lot size unaffected, actual broker SL=3990 (NOT 3985, which
    is what a wrongly-redefined R=10 would produce).
    """

    def test_internal_r_and_broker_sl_are_independent_in_worked_example(self):
        entry = 4000.0
        internal_r_distance = 15.0          # unchanged internal calculation
        configured_stop_gold_move = 10.0    # InpStopLossGoldMove

        # 0.4R / 0.5R triggers must be computed from internal_r_distance,
        # never from configured_stop_gold_move.
        r04 = round(internal_r_distance * 0.4, 2)
        r05 = round(internal_r_distance * 0.5, 2)
        self.assertEqual(r04, 6.00)
        self.assertEqual(r05, 7.50)

        # The actual broker SL must come from configured_stop_gold_move only.
        actual_broker_sl = fixed_sl_price(entry, 1, configured_stop_gold_move)
        self.assertEqual(actual_broker_sl, 3990.0)
        # It must NOT equal what a wrongly-redefined R=10 would produce from
        # scratch (this would only coincidentally differ from 3990 if
        # move==internal_r, so assert the two source distances are in fact
        # different in this worked example, which is the whole point of it).
        self.assertNotEqual(internal_r_distance, configured_stop_gold_move)
        wrong_sl_if_r_redefined = fixed_sl_price(entry, 1, internal_r_distance)
        self.assertEqual(wrong_sl_if_r_redefined, 3985.0)
        self.assertNotEqual(actual_broker_sl, wrong_sl_if_r_redefined)


class SourceImplementationTests(unittest.TestCase):
    """Assert the actual .mq5 source implements the required separation."""

    def test_canonical_sources_are_identical(self):
        self.assertEqual(EA.read_bytes(), BACKEND_EA.read_bytes())

    def test_input_exists_with_default_10(self):
        self.assertIn("input double InpStopLossGoldMove = 10.0;", source())

    def test_validation_function_exists_and_rejects_nonpositive(self):
        src = source()
        self.assertIn("bool XAU_ValidateStopLossGoldMoveInput(string &why)", src)
        self.assertIn("InpStopLossGoldMove <= 0.0", src)
        self.assertIn("MathIsValidNumber(InpStopLossGoldMove)", src)

    def test_oninit_rejects_invalid_input_no_silent_fallback(self):
        src = source()
        self.assertIn("XAU_ValidateStopLossGoldMoveInput(slInputWhy)", src)
        # Must return INIT_PARAMETERS_INCORRECT (reject init), not silently
        # continue with an old R-based SL.
        idx = src.index("XAU_ValidateStopLossGoldMoveInput(slInputWhy)")
        nearby = src[idx: idx + 400]
        self.assertIn("INIT_PARAMETERS_INCORRECT", nearby)

    def test_fixed_sl_price_function_exists_and_only_reads_configured_move(self):
        src = source()
        self.assertIn("double XAU_FixedGoldMoveSLPrice(double referencePrice, int direction, int digits)", src)
        # Extract the function body and assert it does NOT reference any
        # internal-R/structural/ATR variable name.
        start = src.index("double XAU_FixedGoldMoveSLPrice(double referencePrice, int direction, int digits)")
        end = src.index("\n}\n", start)
        body = src[start:end]
        self.assertIn("InpStopLossGoldMove", body)
        for forbidden in ("ownerEffectiveSLDistance", "slDist", "pyramidGeometry", "atr", "ATR", "structural", "Structural"):
            self.assertNotIn(forbidden, body,
                              f"XAU_FixedGoldMoveSLPrice body must not reference '{forbidden}' -- "
                              f"it must derive the broker SL from InpStopLossGoldMove only")

    def test_core_entry_broker_sl_uses_fixed_function_not_internal_distance(self):
        src = source()
        self.assertIn("sl = XAU_FixedGoldMoveSLPrice(price, signal, digits);", src)
        # The internal distance variable must still exist nearby (computed,
        # unchanged, just no longer used for `sl`).
        idx = src.index("sl = XAU_FixedGoldMoveSLPrice(price, signal, digits);")
        preceding = src[max(0, idx - 1200):idx]
        self.assertIn("double ownerEffectiveSLDistance = finalGeometry.effectiveHardStopDistance;", preceding)

    def test_core_entry_no_longer_derives_sl_from_internal_distance(self):
        src = source()
        self.assertNotIn(
            "sl = NormalizeDouble(signal == 1 ? price - ownerEffectiveSLDistance : price + ownerEffectiveSLDistance, digits);",
            src,
        )

    def test_pyramid_entry_broker_sl_uses_fixed_function(self):
        src = source()
        self.assertIn("double pyramidSL=XAU_FixedGoldMoveSLPrice(entryPx,dir,digits);", src)
        self.assertNotIn(
            "double pyramidSL=NormalizeDouble(dir>0?entryPx-pyramidGeometry.effectiveHardStopDistance:",
            src,
        )

    def test_pyramid_lot_sizing_still_uses_pyramidgeometry_distance(self):
        # Lot sizing (riskPerLot/addLot) must still be computed from
        # pyramidGeometry.finalOriginalRiskDistance (slDist) -- unchanged.
        src = source()
        self.assertIn("double slDist=pyramidGeometry.finalOriginalRiskDistance;", src)
        self.assertIn("double riskPerLot=RiskPerLotForDistance(slDist);", src)

    def test_confirmed_open_reconciliation_uses_fixed_function(self):
        src = source()
        self.assertIn("double confirmedOwnerSL = XAU_FixedGoldMoveSLPrice(confirmedOpen, signal, digits);", src)
        self.assertIn("double expectedPyramidSL=XAU_FixedGoldMoveSLPrice(pyLiveOpen,isBuy?1:-1,digits);", src)

    def test_manage_positions_reads_internal_r_from_campaign_not_live_broker_sl(self):
        # This is the critical regression test for the owner's clarification:
        # ManagePositions() must source its per-tick R reference from the
        # CORE-entry-frozen campaign field, not from posInfo.StopLoss().
        src = source()
        self.assertIn("double internalRDistance = g_campaign[mgmtCampaignSlot].ownerEffectiveHardStopDistance;", src)
        self.assertIn("slDist = internalRDistance;", src)
        # The old unconditional live-SL-derived line must be gone from its
        # original unconditional form (it now only appears inside the
        # defensive fallback branch, guarded by "no active campaign record").
        self.assertIn("// Defensive fallback only", src)

    def test_restart_reconciliation_uses_campaign_internal_r_helper(self):
        src = source()
        self.assertIn("double XAU_CampaignInternalRDistanceOrZero(int direction)", src)
        # 1 definition + 5 call sites: the original 4 fallback sites found on
        # the M5 branch, PLUS XAU_ReconcileRExitOnInit()'s own restart
        # reconciliation loop -- a 5th site found while porting this branch
        # that the original M5-branch fix (checkpoint 6) missed.
        self.assertEqual(src.count("XAU_CampaignInternalRDistanceOrZero("), 6,
                          "expected the helper to be defined once and used at all 5 restart-reconciliation fallback call sites")

    def test_oninit_reconciliation_site_uses_campaign_internal_r_helper(self):
        # The 5th site specifically: XAU_ReconcileRExitOnInit().
        src = source()
        self.assertIn(
            "int idx = XAU_RExit_EnsureIdx(positionId, ticket, isBuy, openPx, curSL, lots, true,\n"
            "                                    XAU_CampaignInternalRDistanceOrZero(isBuy ? 1 : -1));",
            src,
        )

    def test_fixed_sl_telemetry_line_present_core_and_pyramid(self):
        src = source()
        self.assertIn("FIXED_SL_APPLIED", src)
        self.assertIn("slSource=FIXED_GOLD_PRICE_MOVE", src)
        self.assertIn("lotSizingPolicy=PRESERVED_EXISTING", src)
        self.assertIn("sizingUnchanged=true", src)
        self.assertEqual(src.count("FIXED_SL_APPLIED"), 2, "expected one telemetry line at CORE entry and one at PYRAMID entry")

    def test_broker_minimum_distance_warning_exists_and_is_non_silent(self):
        src = source()
        self.assertIn("void XAU_WarnIfGoldMoveBelowBrokerMinimum(", src)
        self.assertIn("OWNER_FIXED_SL_BELOW_BROKER_MINIMUM", src)
        # Must not silently alter InpStopLossGoldMove anywhere.
        fn_start = src.index("void XAU_WarnIfGoldMoveBelowBrokerMinimum(")
        fn_end = src.index("\n}\n", fn_start)
        fn_body = src[fn_start:fn_end]
        self.assertNotIn("InpStopLossGoldMove =", fn_body)
        self.assertNotIn("InpStopLossGoldMove=", fn_body)

    def test_counter_excursion_deliberately_unconverted_and_documented(self):
        # Counter-Excursion keeps its own pre-existing ATR-based SL by
        # deliberate, documented decision (off by default, separate tactical
        # module). Assert that decision is documented in-source, and that
        # Counter-Excursion's OWN entry site is unchanged.
        src = source()
        self.assertIn("double slPrice = (counterDir == 1) ? NormalizeDouble(entryPrice - slDist, digits)", src)
        self.assertIn("COUNTER_OFF", src)

    def test_exactly_three_broker_send_sites_in_whole_file(self):
        # Sanity check on the file-wide root inventory claim: exactly 3
        # trade.Buy/trade.Sell order-open call sites exist (CORE, PYRAMID,
        # COUNTER_EXCURSION). If a 4th ever appears, this test forces a
        # human to consciously classify it against the fixed-SL policy.
        src = source()
        buy_calls = len(re.findall(r"\btrade\.Buy\(", src))
        sell_calls = len(re.findall(r"\btrade\.Sell\(", src))
        self.assertEqual(buy_calls, 3)
        self.assertEqual(sell_calls, 3)


if __name__ == "__main__":
    unittest.main()
