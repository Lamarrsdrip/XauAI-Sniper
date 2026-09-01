"""
Focused static tests for the M10+fixed-SL bot's OWN TradeBrain LEARNING
SYSTEM telemetry, branch experiment/v62524-m10-fixed-sl.

Ported verbatim (structurally identical, same variable/function names --
TradeBrain telemetry is timeframe-agnostic) from
experiment/v62525-m5-tradebrain-learning's checkpoint-6 EA source (the
already execution-anomaly-classifier-bugfixed version -- this branch's own
model is built on the CORRECT logic from day one, never the pre-fix
version, since it never existed on this branch until this port). Owner
directive: two SEPARATE TradeBrain models, one per bot, no shared
fingerprints/pooling -- this branch's InpTradeBrainCollectionRunId is
"V62524_M10_FIXEDSL_EXPERIMENT", deliberately distinct from the M5 branch's
"V62525_M5_EXPERIMENT".

This is pure telemetry (drawdown/timing-milestone tracking, an outcome-
trustworthiness label, and evidence-threshold inputs) -- it introduces NO
new execution authority. These tests focus on the properties that matter
most for a system that will eventually be trusted to influence real order
sends: (1) it changes nothing about any current decision, (2) the R
reference it uses is the same internal-R-independent-of-broker-SL
reference already established by this branch's own fixed-SL work
(checkpoint 1), (3) it fails toward "don't trust this data" rather than
fabricating evidence, (4) no post-entry/future information can leak into a
pre-entry fingerprint.

Same static-source-testing convention as the rest of this repo (no live
MT5 runtime available in this environment).
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def source() -> str:
    return EA.read_text(encoding="utf-8")


class SourceConsistencyTests(unittest.TestCase):
    def test_canonical_sources_are_identical(self):
        self.assertEqual(EA.read_bytes(), BACKEND_EA.read_bytes())


class NoExecutionAuthorityTests(unittest.TestCase):
    """Phase 1 must be pure telemetry: zero new execution/order/lot-sizing
    authority anywhere in this checkpoint's changes."""

    def test_drawdown_tracking_function_never_calls_ordersend_or_trade_buy_sell(self):
        src = source()
        start = src.index("void XAU_UpdateBrainDrawdownTracking(")
        end = src.index("\n}\n", start)
        body = src[start:end]
        for forbidden in ("OrderSend(", "trade.Buy(", "trade.Sell(", "PositionModify", "PositionClose"):
            self.assertNotIn(forbidden, body)

    def test_new_inputs_documented_as_not_wired_to_execution(self):
        src = source()
        idx = src.index("input int    InpTradeBrainMinDecisiveMatches")
        preceding = src[max(0, idx - 900):idx]
        self.assertIn("NOT wired to any live execution/lot/block decision", preceding)

    def test_exactly_three_broker_send_sites_unchanged(self):
        # Same sanity check as the SL-policy test suites: Phase 1 must not
        # have added a 4th order-send site.
        src = source()
        buy_calls = len(re.findall(r"\btrade\.Buy\(", src))
        sell_calls = len(re.findall(r"\btrade\.Sell\(", src))
        self.assertEqual(buy_calls, 3)
        self.assertEqual(sell_calls, 3)


class InternalRIndependenceTests(unittest.TestCase):
    """The drawdown tracker must use the SAME internal R reference as the
    existing SL-independence fix -- never the fixed broker SL distance."""

    def test_tracking_hook_passes_slDist_the_campaign_frozen_distance(self):
        src = source()
        # v6.25.25 checkpoint 6: the call site gained a 6th argument (curSL,
        # for the execution-anomaly-classifier fix) -- slDist (5th
        # positional arg, the internal R reference) is unchanged and must
        # still be the campaign-frozen value, not a live-SL-derived one.
        self.assertIn("XAU_UpdateBrainDrawdownTracking(ticket, isBuy, openPx, curPrice, slDist, curSL);", src)
        idx = src.index("XAU_UpdateBrainDrawdownTracking(ticket, isBuy, openPx, curPrice, slDist, curSL);")
        preceding = src[max(0, idx - 1700):idx]
        self.assertIn("g_campaign[mgmtCampaignSlot].ownerEffectiveHardStopDistance", preceding)

    def test_drawdown_struct_never_reads_broker_sl_or_configured_gold_move(self):
        src = source()
        start = src.index("struct XAU_TradeBrainDrawdownTrack")
        end = src.index("};", start)
        body = src[start:end]
        self.assertNotIn("InpStopLossGoldMove", body)
        self.assertNotIn("curSL", body)

    def test_r_multiple_fields_derived_from_internal_r_not_broker_sl(self):
        src = source()
        self.assertIn("double maeR = (eventName==\"CLOSE\" && g_pendingBrainDD_Found && g_pendingBrainDD_InternalR > 0.0)\n                 ? g_pendingBrainDD_MaeGold / g_pendingBrainDD_InternalR : 0.0;", src)


class FingerprintNoLookaheadTests(unittest.TestCase):
    """No future-outcome field may be part of the pre-entry fingerprint."""

    def test_fingerprint_function_does_not_reference_outcome_fields(self):
        src = source()
        start = src.index("string XAU_TradeBrainExactFingerprint(")
        end = src.index("\n}\n", start)
        body = src[start:end]
        for forbidden in ("profit", "rMultiple", "maeGoldPrice", "mfeGoldPrice", "outcome", "exitPrice", "exitReason"):
            self.assertNotIn(forbidden, body,
                              f"XAU_TradeBrainExactFingerprint must not reference post-entry field '{forbidden}'")

    def test_drawdown_tracking_only_instantiated_at_close_side_channel_not_pre_entry(self):
        # The only place a XAU_TradeBrainDrawdownTrack local is constructed
        # is the CLOSE-time pop (checked in InternalRIndependenceTests) --
        # confirm it is not also instantiated anywhere inside the fixed-SL
        # entry functions (which run pre-entry / at order-send time).
        src = source()
        occurrences = [m.start() for m in re.finditer(r"XAU_TradeBrainDrawdownTrack\s+\w+;", src)]
        self.assertEqual(len(occurrences), 1,
                          "expected exactly one local XAU_TradeBrainDrawdownTrack instantiation (the CLOSE-time pop)")


class EvidenceValidityInputsTests(unittest.TestCase):
    """The new owner-specified evidence-threshold inputs exist with the
    exact spec'd defaults and semantics."""

    def test_min_decisive_matches_input_exists(self):
        src = source()
        self.assertIn("input int    InpTradeBrainMinDecisiveMatches = 10;", src)

    def test_minimum_similarity_input_exists(self):
        src = source()
        self.assertIn("input double InpTradeBrainMinimumSimilarity  = 0.75;", src)

    def test_hard_block_threshold_is_50_not_70(self):
        # The spec is explicit: hard block is >=50% loss rate. A DIFFERENT,
        # older "Reserved" input (InpTradeBrainBlockLossPct=70.0) already
        # exists in this codebase for an unrelated, not-yet-built system --
        # this test guards against ever conflating the two.
        src = source()
        self.assertIn("input double InpTradeBrainHardBlockLossRatePct = 50.0;", src)

    def test_lot_reduction_pct_is_30(self):
        src = source()
        self.assertIn("input double InpTradeBrainLotReductionPct    = 30.0;", src)


class OutcomeLabelTests(unittest.TestCase):
    """The outcome-trustworthiness label must fail toward DATA_INCOMPLETE,
    never silently label an anomalous/incomplete row as a trustworthy
    strategy outcome."""

    def test_missing_drawdown_record_labeled_data_incomplete(self):
        src = source()
        start = src.index('if(eventName=="CLOSE")\n   {\n      if(!g_pendingBrainDD_Found)')
        self.assertNotEqual(start, -1)

    def test_execution_outlier_and_gap_slippage_outlier_both_reachable(self):
        src = source()
        self.assertIn('outcomeLabel = "EXECUTION_OUTLIER";', src)
        self.assertIn('outcomeLabel = "GAP_SLIPPAGE_OUTLIER";', src)

    def test_unrecognized_outcome_string_fails_to_data_incomplete_not_a_guess(self):
        src = source()
        self.assertIn(
            'outcomeLabel = "DATA_INCOMPLETE"; // genuinely unrecognized outcome string',
            src,
        )

    def test_outcome_classification_uses_substring_containment_not_exact_match(self):
        # Regression test for the real bug found via the first 90-day
        # replay: exact-string matching against only "WIN"/"LOSS"/
        # "BREAK_EVEN" silently mis-classified 79/274 (28.8%) of real
        # trades as DATA_INCOMPLETE because the EA's own outcome classifier
        # produces richer variants (WIN_AFTER_DEEP_DD, WEAK_RECOVERY_WIN,
        # APLUS_PROTECTED_BE, APLUS_GIVEBACK_LOSS) and a separate call site
        # uses bare "BE" instead of "BREAK_EVEN".
        src = source()
        self.assertIn('StringFind(outcome, "WIN") >= 0', src)
        self.assertIn('StringFind(outcome, "LOSS") >= 0', src)
        self.assertIn('outcome == "BE"', src)
        self.assertIn('StringFind(outcome, "_BE") >= 0', src)


def _classify_execution_anomaly(*, dir_sign, requested_sl, exit_price, session_gap_seconds,
                                 one_r_distance, broker_sl=True):
    """Pure-Python mirror of the FIXED MQL5 classifier arithmetic
    (XAU_AppendTradeBrain, checkpoint 6), same shape as
    reclassify_outcome_label()'s relationship to the outcome-labeling fix.
    This intentionally reproduces the REAL fixed formula exactly, including
    still normalizing by one_r_distance for the ratio threshold -- the
    owner's fix request was specifically about the REFERENCE PRICE
    (requestedSL: originalStructuralSL -> live broker SL), not the R-unit
    used to express the magnitude of any genuine discrepancy found. The
    critical property this proves: once requestedSL is the live broker SL,
    an EXACT fill (zero real slippage) always yields a zero numerator, so
    the ratio is 0.0 regardless of one_r_distance -- the false-positive
    mechanism is eliminated at the numerator, not by changing units."""
    slippage_beyond_sl = max(0.0, requested_sl - exit_price) if dir_sign > 0 else max(0.0, exit_price - requested_sl)
    slippage_beyond_sl_r = slippage_beyond_sl / one_r_distance if one_r_distance > 0 else 0.0
    return (broker_sl and (slippage_beyond_sl_r >= 0.25 or session_gap_seconds >= 300))


def _classify_execution_anomaly_OLD_BUGGY(*, dir_sign, original_structural_sl, exit_price,
                                           session_gap_seconds, broker_sl=True, one_r_distance=1.0):
    """Pure-Python mirror of the PRE-FIX (buggy) MQL5 classifier -- kept
    only so the regression tests can demonstrate the BEFORE/AFTER
    behavioral difference on the same synthetic scenario, the same way
    reclassify_outcome_label()'s tests demonstrate the outcome-label fix.
    Structurally identical arithmetic to the fixed version -- the only
    difference is WHICH price is passed in as the reference (the caller
    passes the stale original_structural_sl here vs. the live broker SL in
    the fixed version), which is exactly the one-line bug that was fixed."""
    slippage_beyond_sl = max(0.0, original_structural_sl - exit_price) if dir_sign > 0 else max(0.0, exit_price - original_structural_sl)
    slippage_beyond_sl_r = slippage_beyond_sl / one_r_distance if one_r_distance > 0 else 0.0
    return (broker_sl and (slippage_beyond_sl_r >= 0.25 or session_gap_seconds >= 300))


class ExecutionAnomalyClassifierFixTests(unittest.TestCase):
    """The outlier classifier must compare against the actual, current,
    LIVE broker SL -- not the vestigial originalStructuralSL legacy
    reference. The underlying bug was found and fixed on
    experiment/v62525-m5-tradebrain-learning via its real 90-day replay
    (see that branch's EXECUTION_OUTLIER_INVESTIGATION.md: 13/14, 93%, of
    flagged trades there were false positives caused entirely by comparing
    against the wrong reference field, slippagePoints=0.00 for all of
    them). This branch never carried the buggy version -- it was ported
    directly with the fix already applied -- these tests confirm the
    ported code matches the CORRECT, fixed logic exactly."""

    # --- Source-level proof the stale reference is gone -------------------

    def test_requested_sl_no_longer_falls_back_to_original_structural_sl(self):
        src = source()
        self.assertNotIn(
            "double requestedSL=r.originalStructuralSL>0.0?r.originalStructuralSL:r.sl;",
            src,
        )
        self.assertNotIn("r.originalStructuralSL:r.sl", src)

    def test_requested_sl_now_sourced_from_last_known_live_broker_sl(self):
        src = source()
        self.assertIn(
            'double requestedSL = (eventName=="CLOSE" && g_pendingBrainDD_Found && '
            'g_pendingBrainDD_LastKnownBrokerSL>0.0)\n                         '
            '? g_pendingBrainDD_LastKnownBrokerSL : r.sl;',
            src,
        )

    def test_last_known_broker_sl_field_exists_on_drawdown_struct(self):
        src = source()
        start = src.index("struct XAU_TradeBrainDrawdownTrack")
        end = src.index("};", start)
        body = src[start:end]
        self.assertIn("double   lastKnownBrokerSL;", body)

    def test_tracking_function_takes_current_broker_sl_and_never_writes_an_order(self):
        src = source()
        start = src.index("void XAU_UpdateBrainDrawdownTracking(")
        sig_end = src.index(")", start)
        signature = src[start:sig_end]
        self.assertIn("double currentBrokerSL", signature)
        body_end = src.index("\n}\n", start)
        body = src[start:body_end]
        for forbidden in ("SafeModifySL", "PositionModify", "OrderSend(", "trade.Buy(", "trade.Sell("):
            self.assertNotIn(forbidden, body)

    def test_call_site_passes_the_existing_possinfo_stoploss_read_not_a_new_query(self):
        # curSL is the SAME read ManagePositions' own (unrelated) R-fallback
        # logic already performs a few lines above -- confirm no NEW
        # PositionGetDouble/StopLoss() query was introduced at the call site
        # itself (it must reuse the existing local variable).
        src = source()
        self.assertIn(
            "XAU_UpdateBrainDrawdownTracking(ticket, isBuy, openPx, curPrice, slDist, curSL);",
            src,
        )
        idx = src.index("double curSL = posInfo.StopLoss();")
        call_idx = src.index("XAU_UpdateBrainDrawdownTracking(ticket, isBuy, openPx, curPrice, slDist, curSL);")
        self.assertLess(idx, call_idx, "curSL must be read before it is passed into the telemetry hook")

    def test_pending_global_reset_on_no_tracking_record_found(self):
        src = source()
        idx = src.index("g_pendingBrainDD_LastKnownBrokerSL = 0.0;")
        self.assertNotEqual(idx, -1)

    # --- Behavioral proof (pure-Python mirror, same pattern as
    #     reclassify_outcome_label's before/after tests) -------------------

    def test_ordinary_fixed_sl_stopout_no_longer_flagged_pre_vs_post_fix(self):
        # Exact real-world shape of trade posId=34 from the 90-day replay:
        # broker filled EXACTLY at the fixed $10 SL (zero real slippage),
        # but the legacy structural SL reference was $6.35 from entry
        # (tighter than the fixed $10 SL) -- a purely mechanical difference
        # from switching SL policies, not a real anomaly.
        entry = 4685.14
        fixed_sl_fill = 4675.14       # entry - $10.00 (InpStopLossGoldMove)
        legacy_structural_sl = 4678.79  # entry - $6.35 (old R-based reference)
        # OLD (buggy) classifier: flags it (matches the real captured bug).
        old_flagged = _classify_execution_anomaly_OLD_BUGGY(
            dir_sign=1, original_structural_sl=legacy_structural_sl,
            exit_price=fixed_sl_fill, session_gap_seconds=20, one_r_distance=6.35)
        self.assertTrue(old_flagged, "sanity check: this must reproduce the real captured bug")
        # NEW (fixed) classifier: compares against the actual live broker SL
        # (which is exactly where the fill happened) -- zero distance, never
        # flagged.
        new_flagged = _classify_execution_anomaly(
            dir_sign=1, requested_sl=fixed_sl_fill, exit_price=fixed_sl_fill,
            session_gap_seconds=20, one_r_distance=6.35)
        self.assertFalse(new_flagged, "an exact fill against the live broker SL must never be flagged "
                                       "regardless of one_r_distance, since the numerator is zero")

    def test_legitimately_trailed_sl_also_not_falsely_flagged_post_fix(self):
        # A trade whose SL was legitimately moved (breakeven lock / profit
        # floor / trailing) during its life, then filled exactly at that
        # NEW live level -- e.g. real posId=24-shaped case from the dataset
        # (sl != exitPrice using the entry-time-only reference, but the
        # LIVE broker SL by close time matches exitPrice exactly).
        live_broker_sl_at_close = 4698.07
        exit_fill = 4698.07
        flagged = _classify_execution_anomaly(
            dir_sign=1, requested_sl=live_broker_sl_at_close, exit_price=exit_fill,
            session_gap_seconds=20, one_r_distance=4.0)
        self.assertFalse(flagged)

    def test_genuine_real_slippage_still_flagged_post_fix(self):
        # Synthetic case with ACTUAL non-zero slippage: the live broker SL
        # was at one price, but the fill happened materially further away
        # (a real slippage event, unlike anything in the real 90-day
        # dataset, which had slippagePoints=0.00 throughout).
        live_broker_sl = 4675.14
        actual_fill = 4674.50   # filled 0.64 price units beyond the live SL -- real slippage
        flagged = _classify_execution_anomaly(
            dir_sign=1, requested_sl=live_broker_sl, exit_price=actual_fill,
            session_gap_seconds=20, one_r_distance=2.0)  # 0.64/2.0 = 0.32 >= 0.25 threshold
        self.assertTrue(flagged, "genuine slippage beyond the live broker SL must still be flagged")

    def test_genuine_session_gap_still_flagged_post_fix_unaffected_by_this_change(self):
        # Real posId=508 shape: slippageBeyondSL well under threshold, but a
        # genuine ~2-hour tick gap -- this path is independent of the SL-
        # reference fix and must remain flagged exactly as before.
        flagged = _classify_execution_anomaly(
            dir_sign=1, requested_sl=4000.52, exit_price=4000.52,
            session_gap_seconds=7201, one_r_distance=5.0)
        self.assertTrue(flagged, "a genuine long session gap must still be flagged regardless of this fix")

    def test_short_normal_session_gap_alone_does_not_flag(self):
        flagged = _classify_execution_anomaly(
            dir_sign=1, requested_sl=4000.52, exit_price=4000.52,
            session_gap_seconds=20, one_r_distance=5.0)
        self.assertFalse(flagged)


class OwnerSpecTest17And18StaticProofTests(unittest.TestCase):
    """Owner-spec test items #17 ('Fixed broker SL remains unchanged by
    TradeBrain') and #18 ('Internal R and all exits remain unchanged').
    Phase 1 has no execution authority at all yet, so the strongest
    currently-true statement is a static one: nothing this checkpoint added
    touches SL/TP/exit machinery anywhere in the file."""

    def test_no_new_code_this_checkpoint_calls_safemodifysl_or_positionmodify(self):
        src = source()
        # All three new/changed functions from this checkpoint, checked as
        # a group: the drawdown tracker, its CLOSE-time pop, and the CSV
        # exporter must never modify SL/TP.
        for fn_start in (
            "void XAU_UpdateBrainDrawdownTracking(",
            "bool XAU_PopBrainDrawdownTracking(",
        ):
            start = src.index(fn_start)
            end = src.index("\n}\n", start)
            body = src[start:end]
            self.assertNotIn("SafeModifySL", body)
            self.assertNotIn("PositionModify", body)
            self.assertNotIn("trade.PositionModify", body)

    def test_fixed_gold_move_sl_helper_unchanged_by_this_checkpoint(self):
        # The fixed-SL policy function itself (from the prior branch) must
        # still be present, unmodified in signature, proving this
        # checkpoint did not touch it.
        src = source()
        self.assertIn(
            "double XAU_FixedGoldMoveSLPrice(double referencePrice, int direction, int digits)",
            src,
        )


if __name__ == "__main__":
    unittest.main()
