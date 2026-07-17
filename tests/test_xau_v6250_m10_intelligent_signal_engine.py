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


def test_root_and_backend_copies_synced():
    assert read(EA) == read(BACKEND_EA)


# ---------------------------------------------------------------------------
# 1: one canonical evidence snapshot, one traceable id
# ---------------------------------------------------------------------------
def test_one_canonical_snapshot_struct_exists():
    ea = read(EA)
    assert ea.count("struct XAU_M10EvidenceSnapshot") == 1
    assert ea.count("XAU_M10EvidenceSnapshot XAU_BuildM10EvidenceSnapshot()") == 1


def test_snapshot_evidence_id_only_advances_on_a_genuinely_new_bar():
    ea = read(EA)
    fn = find_function(ea, "XAU_M10EvidenceSnapshot XAU_BuildM10EvidenceSnapshot()")
    assert "if(td.evaluatedBar != g_m10LastEvidenceBar)" in fn
    idx = fn.index("if(td.evaluatedBar != g_m10LastEvidenceBar)")
    window = fn[idx: idx + 200]
    assert "g_m10EvidenceSeq++;" in window


def test_decision_reads_evidence_id_from_the_same_snapshot():
    ea = read(EA)
    fn = find_function(ea, "XAU_M10SignalDecision XAU_EvaluateM10SignalDecision()")
    assert "g_m10Snapshot = XAU_BuildM10EvidenceSnapshot();" in fn
    assert "d.evidenceId = g_m10Snapshot.evidenceId;" in fn


def test_no_old_m5_cache_enters_the_snapshot():
    ea = read(EA)
    fn = find_function(ea, "XAU_M10EvidenceSnapshot XAU_BuildM10EvidenceSnapshot()")
    assert "PERIOD_M5" not in fn
    assert "XAU_PRIMARY_DECISION_TF" in fn or "XAU_AdaptiveMarketTransitionEngine()" in fn


# ---------------------------------------------------------------------------
# 2/9: buy and sell cases calculated independently, never 100-minus-other
# ---------------------------------------------------------------------------
def test_buy_and_sell_cases_use_distinct_evidence_fields():
    ea = read(EA)
    fn = find_function(ea, "double XAU_ScoreDirectionCase(const XAU_AdaptiveTransitionDecision &td, int caseDirection)")
    assert "100.0 -" not in fn.replace("100.0 - t", "")  # no naive complement of a case score
    # dominant-side and opposite-side branches read genuinely different fields
    assert "td.continuationConfidence" in fn
    assert "td.reversalProbability" in fn
    assert "td.remainingRewardR" in fn
    assert "td.oppositeRemainingRewardR" in fn


def test_decision_calls_score_direction_case_for_both_directions_separately():
    ea = read(EA)
    fn = find_function(ea, "XAU_M10SignalDecision XAU_EvaluateM10SignalDecision()")
    assert "d.buyCaseScore  = XAU_ScoreDirectionCase(td, 1);" in fn
    assert "d.sellCaseScore = XAU_ScoreDirectionCase(td, -1);" in fn


# ---------------------------------------------------------------------------
# 3/4: pressure level alone is not enough -- slope and structure matter too
#
# v6.25.1 owner directive 2026-07-17 -- the old g_prevBuyConfidenceForSlope /
# g_prevSellConfidenceForSlope globals mutated on the FIRST call of a new
# bar, so a second call within the same bar computed slope against a value
# it had just overwritten to itself (repeated calls did not return the same
# slope). Replaced with a canonical, bar-keyed two-slot pressure history
# (XAU_UpdateM10PressureHistory / XAU_M10BuySlope / XAU_M10SellSlope) that
# shifts exactly once per genuinely new closed bar.
# ---------------------------------------------------------------------------
def test_case_score_uses_pressure_slope_via_snapshot_not_level_alone():
    ea = read(EA)
    fn = find_function(ea, "XAU_M10EvidenceSnapshot XAU_BuildM10EvidenceSnapshot()")
    assert "XAU_UpdateM10PressureHistory(td.evaluatedBar, td.buyConfidence, td.sellConfidence);" in fn
    assert "s.buyPressureSlope   = XAU_M10BuySlope(td.buyConfidence);" in fn
    assert "s.sellPressureSlope  = XAU_M10SellSlope(td.sellConfidence);" in fn


def test_pressure_slope_history_shifts_exactly_once_per_new_bar():
    ea = read(EA)
    fn = find_function(ea, "void XAU_UpdateM10PressureHistory(datetime evaluatedBar, double buyConfidence, double sellConfidence)")
    # a repeated call for the same bar must be a no-op (guard-and-return),
    # never re-shifting prev<-current on every call within the same bar
    assert "if(evaluatedBar <= 0 || evaluatedBar == g_m10PressureHistoryCurrentBar)" in fn
    assert "return;" in fn
    assert "g_m10PressureHistoryPrevBar     = g_m10PressureHistoryCurrentBar;" in fn


def test_slope_functions_read_the_two_slot_history_not_a_single_mutable_global():
    ea = read(EA)
    buy_fn = find_function(ea, "double XAU_M10BuySlope(double liveBuyConfidence)")
    sell_fn = find_function(ea, "double XAU_M10SellSlope(double liveSellConfidence)")
    assert "g_m10PressureHistoryPrevBuy" in buy_fn
    assert "g_m10PressureHistoryPrevSell" in sell_fn


def test_structure_bucket_reused_not_reinvented():
    ea = read(EA)
    fn = find_function(ea, "double XAU_ScoreDirectionCase(const XAU_AdaptiveTransitionDecision &td, int caseDirection)")
    assert "XAU_BucketStructure(caseDirection" in fn
    assert "XAU_ScoreStructureBucket(structBucket)" in fn


# ---------------------------------------------------------------------------
# 5: high exhaustion alone cannot create the opposite signal
# ---------------------------------------------------------------------------
def test_exhaustion_alone_cannot_flip_the_decision():
    ea = read(EA)
    fn = find_function(ea, "XAU_M10SignalDecision XAU_EvaluateM10SignalDecision()")
    # the opposite case only wins with BOTH a score threshold AND real
    # reaction evidence (reclaim/retest/displacement) -- never exhaustion alone
    idx = fn.index("else if(oppositeScore > dominantScore && oppositeScore >= 55.0 &&")
    window = fn[idx: idx + 200]
    assert "td.oppositeReclaim || td.oppositeRetestHeld || td.oppositeDisplacement" in window


# ---------------------------------------------------------------------------
# 6: strong continuation is not mislabeled as exhaustion (trend state)
# ---------------------------------------------------------------------------
def test_trend_mature_with_room_distinct_from_trend_exhausted():
    ea = read(EA)
    fn = find_function(ea, "XAU_M10EvidenceSnapshot XAU_BuildM10EvidenceSnapshot()")
    assert '"TREND_MATURE_WITH_ROOM"' in fn
    assert '"TREND_EXHAUSTED"' in fn
    mature_idx = fn.index('s.trendState = "TREND_MATURE_WITH_ROOM";')
    exhausted_idx = fn.index('s.trendState = "TREND_EXHAUSTED";')
    # exhausted requires BOTH high exhaustion AND weak continuation; mature
    # requires high exhaustion but continuation still strong -- checked
    # before exhausted-only in the if/elif chain (order matters: exhausted
    # branch appears first, but must additionally require weak continuation)
    assert exhausted_idx < mature_idx
    exhausted_cond = fn[fn.index('if(td.exhaustionProbability >= 85.0 && td.continuationConfidence < 45.0)'):]
    assert exhausted_cond.startswith('if(td.exhaustionProbability >= 85.0 && td.continuationConfidence < 45.0)')


# ---------------------------------------------------------------------------
# 8: right direction + poor location returns WAIT_FOR_x_RETRACE
# ---------------------------------------------------------------------------
def test_poor_location_produces_wait_for_retrace_not_reversal():
    ea = read(EA)
    fn = find_function(ea, "XAU_M10SignalDecision XAU_EvaluateM10SignalDecision()")
    assert "bool dominantLocationPoor = (loc == LOCATION_LATE || loc == LOCATION_EXTREME);" in fn
    idx = fn.index("if(dominantLocationPoor)")
    window = fn[idx: idx + 400]
    assert "M10_DECISION_WAIT_FOR_BUY_RETRACE" in window
    assert "M10_DECISION_WAIT_FOR_SELL_RETRACE" in window
    assert "d.retracementRequired = true;" in window


# ---------------------------------------------------------------------------
# 10: conflicting cases produce TRANSITION_WATCH, not a forced pick
# ---------------------------------------------------------------------------
def test_close_scores_produce_transition_watch():
    ea = read(EA)
    fn = find_function(ea, "XAU_M10SignalDecision XAU_EvaluateM10SignalDecision()")
    assert "if(scoreGap < 10.0)" in fn
    idx = fn.index("if(scoreGap < 10.0)")
    window = fn[idx: idx + 200]
    assert "M10_DECISION_TRANSITION_WATCH" in window


# ---------------------------------------------------------------------------
# 11: HTF context informs (via structure/pressure buckets) but is not read
# as a blind veto inside the M10 decision itself
# ---------------------------------------------------------------------------
def test_decision_does_not_hard_veto_on_htf_alone():
    ea = read(EA)
    fn = find_function(ea, "XAU_M10SignalDecision XAU_EvaluateM10SignalDecision()")
    assert "HTF_CONFLICT" not in fn
    assert "HTF_STRONG_CONFLICT" not in fn
    assert "g_htfConsensusDir" not in fn


# ---------------------------------------------------------------------------
# 12/13: reward room from real geometry; missing data returns
# DATA_UNAVAILABLE, never zero-room fabrication
# ---------------------------------------------------------------------------
def test_room_components_use_real_transition_engine_room_fields():
    ea = read(EA)
    fn = find_function(ea, "double XAU_ScoreDirectionCase(const XAU_AdaptiveTransitionDecision &td, int caseDirection)")
    assert "XAU_AnchorScore(td.remainingRewardR, 3.0, 0.0)" in fn
    assert "XAU_AnchorScore(td.oppositeRemainingRewardR, 3.0, 0.0)" in fn


def test_stale_data_returns_data_unavailable_not_a_guess():
    ea = read(EA)
    fn = find_function(ea, "XAU_M10SignalDecision XAU_EvaluateM10SignalDecision()")
    idx = fn.index("if(!g_m10Snapshot.complete)")
    window = fn[idx: idx + 350]
    assert "M10_DECISION_DATA_UNAVAILABLE" in window
    assert "return d;" in window


# v6.25.1 owner directive 2026-07-17 -- explicit FRESH/DEGRADED/STALE states
# replaced the old generous ~3-bar binary dataFresh check. The snapshot now
# fails closed at the TOP of the builder (before any evidence fields are
# computed) the moment the bar is STALE, and only ever reports itself
# .complete for FRESH or DEGRADED (a DEGRADED bar is displayable but the
# M10 decision layer above still downgrades any high-confidence candidate).
def test_snapshot_fails_closed_on_stale_evidence():
    ea = read(EA)
    fn = find_function(ea, "XAU_M10EvidenceSnapshot XAU_BuildM10EvidenceSnapshot()")
    assert "s.dataFresh     = (freshnessState == M10_FRESHNESS_FRESH);" in fn
    assert "s.complete      = (freshnessState != M10_FRESHNESS_STALE);" in fn
    idx = fn.index("if(freshnessState == M10_FRESHNESS_STALE)")
    window = fn[idx: idx + 200]
    assert "return s;" in window, "must return immediately on STALE, before computing any evidence fields"


def test_freshness_state_is_explicit_fresh_degraded_stale_not_a_generous_binary_flag():
    ea = read(EA)
    fn = find_function(ea, "XAU_M10EvidenceSnapshot XAU_BuildM10EvidenceSnapshot()")
    assert "M10_FRESHNESS_FRESH" in fn
    assert "M10_FRESHNESS_DEGRADED" in fn
    assert "M10_FRESHNESS_STALE" in fn


# v6.25.2 owner directive 2026-07-17 -- URGENT FORENSIC FIX. Live evidence
# proved the v6.25.1 age-threshold classification (TimeCurrent()-evaluatedBar
# compared against 660s/1200s) falsely marked a just-closed, genuinely
# current M10 bar as STALE: evaluatedBar/iTime() is bar OPEN time, so a
# newly closed bar is always ~600s "old" by that measure the instant it
# becomes available. Freshness must be classified by BAR IDENTITY
# (evaluatedBar vs iTime(...,1)/iTime(...,2)), never by raw elapsed seconds.
def test_freshness_classified_by_bar_identity_not_raw_elapsed_seconds():
    ea = read(EA)
    fn = find_function(ea, "XAU_M10EvidenceSnapshot XAU_BuildM10EvidenceSnapshot()")
    assert "datetime latestClosedBarOpen   = iTime(Symbol(), XAU_PRIMARY_DECISION_TF, 1);" in fn
    assert "datetime previousClosedBarOpen = iTime(Symbol(), XAU_PRIMARY_DECISION_TF, 2);" in fn
    assert "else if(evaluatedShift == 1)" in fn
    assert "freshnessState = M10_FRESHNESS_FRESH;" in fn
    assert "else if(evaluatedShift == 2)" in fn
    assert "freshnessState = M10_FRESHNESS_DEGRADED;" in fn
    # the old open-time-age comparison must be fully gone from this function
    assert "ageSeconds <= XAU_PRIMARY_DECISION_TF_SECONDS + XAU_M10_FRESHNESS_GRACE_SECONDS" not in fn
    assert "ageSeconds <= XAU_PRIMARY_DECISION_TF_SECONDS * 2" not in fn


def test_evaluated_shift_matches_latest_bar_is_fresh_even_at_exactly_600_seconds_open_age():
    """Direct regression test for the exact live-evidence timestamp: a bar
    that opened 600-601 seconds ago (i.e. JUST closed) must be FRESH, not
    STALE, because it IS the current latest closed bar. The classification
    if/elif chain must key off evaluatedShift (bar identity) -- neither
    openAgeSeconds nor closeAgeSeconds may appear inside the condition of
    any `if`/`else if` that assigns freshnessState."""
    ea = read(EA)
    fn = find_function(ea, "XAU_M10EvidenceSnapshot XAU_BuildM10EvidenceSnapshot()")
    chain_start = fn.index("if(td.evaluatedBar <= 0 || td.continuationEntryPaused)")
    chain_end = fn.index("freshnessState = M10_FRESHNESS_STALE;      // more than one bar behind")
    chain = fn[chain_start: chain_end]
    assert "evaluatedShift == 1" in chain
    assert "evaluatedShift == 2" in chain
    assert "openAgeSeconds" not in chain
    assert "closeAgeSeconds" not in chain


def test_close_age_seconds_used_for_display_not_open_age():
    ea = read(EA)
    fn = find_function(ea, "XAU_M10EvidenceSnapshot XAU_BuildM10EvidenceSnapshot()")
    assert "s.ageSeconds             = closeAgeSeconds;" in fn
    assert "s.openAgeSeconds         = openAgeSeconds;" in fn
    assert "s.closeAgeSeconds        = closeAgeSeconds;" in fn


def test_freshness_log_reports_evaluated_shift_and_both_age_fields():
    ea = read(EA)
    fn = find_function(ea, "XAU_M10EvidenceSnapshot XAU_BuildM10EvidenceSnapshot()")
    log_idx = fn.index('PrintFormat("M10_FRESHNESS |')
    window = fn[log_idx: log_idx + 700]
    assert "evaluatedShift=%d" in window
    assert "openAgeSeconds=%d" in window
    assert "closeAgeSeconds=%d" in window
    assert "latestClosedBarOpen=%s" in window


# ---------------------------------------------------------------------------
# 14: confidence falls when evidence conflicts (deliberately capped low)
# ---------------------------------------------------------------------------
def test_confidence_capped_low_on_conflict():
    ea = read(EA)
    fn = find_function(ea, "XAU_M10SignalDecision XAU_EvaluateM10SignalDecision()")
    assert "d.confidence = 50.0 - scoreGap;" in fn


def test_no_hardcoded_default_confidence_constants():
    ea = read(EA)
    fn = find_function(ea, "XAU_M10SignalDecision XAU_EvaluateM10SignalDecision()")
    for bad in ["d.confidence = 70.0;", "d.confidence = 80.0;", "d.confidence = 90.0;"]:
        assert bad not in fn


# ---------------------------------------------------------------------------
# 15: M10 engine and hourly outlook share canonical evidence principles
# (ported analytical approach, not literal cross-language code sharing --
# documented explicitly, not silently duplicated math)
# ---------------------------------------------------------------------------
def test_anchor_scoring_documents_the_outlook_methodology_it_ports():
    ea = read(EA)
    fn = find_function(ea, "double XAU_AnchorScore(double value, double goodAt, double badAt)")
    assert "MathMax(0.0, MathMin(100.0" in fn
    banner_idx = ea.index("M10 INTELLIGENT SIGNAL ENGINE")
    banner = ea[banner_idx: banner_idx + 2500]
    assert "market_outlook.py" in banner
    assert "_compute_confidence" in banner


def test_location_and_structure_anchors_match_outlook_values():
    ea = read(EA)
    fn = find_function(ea, "double XAU_ScoreLocationBucket(ENUM_XAU_LOCATION_QUALITY loc)")
    assert "return 95.0;" in fn  # LOCATION_EXCELLENT
    assert "return 78.0;" in fn  # LOCATION_GOOD
    assert "return 30.0;" in fn  # LOCATION_LATE
    assert "return 10.0;" in fn  # LOCATION_EXTREME
    fn2 = read(EA)
    struct_fn = find_function(fn2, "double XAU_ScoreStructureBucket(ENUM_XAU_STRUCTURE_STATE s)")
    assert "return 95.0;" in struct_fn  # STRUCTURE_STRONGLY_SUPPORTS
    assert "return 20.0;" in struct_fn  # STRUCTURE_OPPOSES


# ---------------------------------------------------------------------------
# 17-18: no module chooses direction outside this canonical function; this
# is advisory, not a second entry authority
# ---------------------------------------------------------------------------
def test_decision_function_never_calls_open_trade_or_broker_send():
    ea = read(EA)
    fn = find_function(ea, "XAU_M10SignalDecision XAU_EvaluateM10SignalDecision()")
    assert "OpenTrade(" not in fn
    assert "trade.Buy(" not in fn and "trade.Sell(" not in fn


def test_exactly_one_m10_decision_authority():
    ea = read(EA)
    assert ea.count("XAU_M10SignalDecision XAU_EvaluateM10SignalDecision()") == 1


def test_no_second_final_entry_arbiter_created():
    ea = read(EA)
    assert ea.count("bool XAU_FinalEntryArbiter(") == 1


# ---------------------------------------------------------------------------
# M10 feeds FinalEntryArbiter as evidence, conservatively scoped (contradict
# only, never mere non-confirmation) -- consistent with "do not add new
# blockers"
# ---------------------------------------------------------------------------
def test_final_entry_arbiter_reads_m10_decision_as_named_evidence():
    ea = read(EA)
    fn = find_function(ea, "bool XAU_FinalEntryArbiter(string source, int signal, bool signalOK, bool structureOK,")
    assert "bool m10Contradicts" in fn
    assert "!m10Contradicts" in fn


def test_m10_contradicts_only_blocks_on_direct_opposite_not_mere_non_confirmation():
    ea = read(EA)
    fn = find_function(ea, "bool XAU_FinalEntryArbiter(string source, int signal, bool signalOK, bool structureOK,")
    idx = fn.index("bool m10Contradicts")
    window = fn[idx: idx + 500]
    assert "M10_DECISION_RANGE_NO_TRADE" not in window
    assert "M10_DECISION_TRANSITION_WATCH" not in window
    assert "M10_DECISION_DATA_UNAVAILABLE" not in window
    assert "M10_DECISION_TREND_CONTINUATION_NO_ENTRY_YET" not in window


# ---------------------------------------------------------------------------
# 19-22: non-regression -- entry timer, risk, SL widening, direction
# exclusivity all untouched by this feature
# ---------------------------------------------------------------------------
def test_entry_timer_unchanged():
    ea = read(EA)
    assert "input int    InpM5EntryDelayMinSeconds      = 120;" in ea


def test_risk_and_sl_widening_unchanged():
    ea = read(EA)
    assert "InpNormalRiskPct" in ea
    assert "XAU_SL_WIDENING_FACTOR" in ea


def test_direction_exclusivity_still_active():
    ea = read(EA)
    assert "bool XAU_CanOpenDirection(int requestedDirection, string requestingFamily, string &blockReason)" in ea


# ---------------------------------------------------------------------------
# Command Center transparency
# ---------------------------------------------------------------------------
def test_m10_signal_json_logged_to_command_center():
    ea = read(EA)
    assert '\\"m10_signal\\":%s' in ea
    assert "m10SignalJson" in ea


def test_structured_log_line_present():
    ea = read(EA)
    assert "M10_SIGNAL_ANALYSIS |" in ea


def test_backend_model_accepts_m10_signal_field():
    server_py = read(ROOT / "backend" / "server.py")
    assert "m10_signal: Optional[Dict[str, Any]] = None" in server_py
    assert '"market_thesis", "post_trade_state", "entry_readiness", "m10_signal",' in server_py


# ---------------------------------------------------------------------------
# v6.25.2 owner directive -- M10 ORIGINATION FALLBACK. Live evidence
# 2026-07-17 10:10:00 showed a genuine M10 BUY_CANDIDATE (confidence=57.3,
# acceptable-or-better location) discarded outright because ScoreSetups had
# been stuck proposing a stale, mismatched SELL for 40+ minutes -- M10 was
# "the canonical candidate authority" in name (it could veto) but could
# never actually originate a trade of its own. These tests lock in the
# bounded, additive fallback that lets M10's own qualifying candidate flow
# through the exact same shared downstream pipeline ScoreSetups uses,
# without touching ScoreSetups internals or granting M10 a private
# execution lane.
# ---------------------------------------------------------------------------
def test_origination_fallback_exists_exactly_once():
    ea = read(EA)
    assert ea.count("M10_ORIGINATED_CANDIDATE_SHARED_PATH") == 1
    assert ea.count('setupName = "M10_ORIGINATED_CANDIDATE"') == 1


def test_origination_only_fires_when_scoresetups_proposed_nothing():
    ea = read(EA)
    idx = ea.index("M10_ORIGINATED_CANDIDATE_SHARED_PATH")
    window = ea[idx - 900: idx]
    assert "if(signal == 0 &&" in window


def test_origination_requires_genuine_buy_or_sell_candidate_not_retrace_or_watch():
    ea = read(EA)
    idx = ea.index("M10_ORIGINATED_CANDIDATE_SHARED_PATH")
    window = ea[idx - 900: idx]
    assert "M10_DECISION_BUY_CANDIDATE" in window
    assert "M10_DECISION_SELL_CANDIDATE" in window
    # WAIT_FOR_*_RETRACE means a poor entry price right now, not "originate a
    # fresh entry immediately" -- must not be included in this gate.
    assert "M10_DECISION_WAIT_FOR_BUY_RETRACE" not in window
    assert "M10_DECISION_WAIT_FOR_SELL_RETRACE" not in window


def test_origination_reuses_m10_confidence_not_a_reinvented_score():
    ea = read(EA)
    idx = ea.index("M10_ORIGINATED_CANDIDATE_SHARED_PATH")
    window = ea[idx - 900: idx + 200]
    assert "g_m10Decision.confidence" in window
    assert "g_m10Decision.preferredDirection" in window


def test_origination_score_scale_matches_existing_shared_path_convention():
    ea = read(EA)
    idx = ea.index("M10_ORIGINATED_CANDIDATE_SHARED_PATH")
    window = ea[idx - 900: idx]
    # Maps the 55-100 confidence scale onto the same small setupScore range
    # ADAPTIVE_REVERSAL_RECLAIM (score=6.80) and ScoreSetups use -- not a
    # freshly invented scale.
    assert "setupScore = 5.0 + m10ConfidenceNorm * 3.0" in window
    assert "(g_m10Decision.confidence - 55.0) / 45.0" in window


def test_origination_has_no_private_execution_lane():
    ea = read(EA)
    idx = ea.index("M10_ORIGINATED_CANDIDATE_SHARED_PATH")
    window = ea[idx: idx + 600]
    assert "OpenTrade(" not in window
    assert "trade.Buy(" not in window and "trade.Sell(" not in window


def test_origination_falls_through_before_combined_score_and_grade():
    ea = read(EA)
    origin_idx = ea.index("M10_ORIGINATED_CANDIDATE_SHARED_PATH")
    # "combinedRaw = setupScore * ..." also appears once inside ScoreSetups()
    # itself (unrelated, earlier in the file) -- find the OnTick occurrence
    # that comes after the origination block, not the first match overall.
    combined_idx = ea.index("double combinedRaw = setupScore * regimeQuality * sessionQuality;", origin_idx)
    grade_idx = ea.index('string grade = combinedScore >= InpGradeAPlus ? "A+"')
    assert origin_idx < combined_idx < grade_idx


def test_origination_fallback_placed_after_existing_endorsement_veto_gate():
    ea = read(EA)
    veto_idx = ea.index("M10_CANDIDATE_REJECTED")
    origin_idx = ea.index("M10_ORIGINATED_CANDIDATE_SHARED_PATH")
    assert veto_idx < origin_idx


def test_build_hash_reflects_origination_fallback():
    ea = read(EA)
    assert 'XAUAI_BUILD_HASH "v6252-m10-origination-fallback' in ea


if __name__ == "__main__":
    import sys
    import pytest
    sys.exit(pytest.main([__file__, "-q"]))
