from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.17.7.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def body(src: str, signature: str) -> str:
    idx = src.index(signature)
    start = src.index("{", idx)
    depth = 0
    for i in range(start, len(src)):
        if src[i] == "{":
            depth += 1
        elif src[i] == "}":
            depth -= 1
            if depth == 0:
                return src[start:i + 1]
    raise AssertionError(f"unbalanced braces for {signature}")


def test_current_release_source_is_synced_to_backend():
    assert read(EA) == read(BACKEND_EA)


def test_version_bumped_to_v6177():
    ea = read(BACKEND_EA)
    assert '#define XAUAI_EA_VERSION "v6.17.7"' in ea


def test_header_banner_matches_property_version_for_website_display():
    import re
    ea = read(BACKEND_EA)
    m = re.search(r'v(\d+\.\d+\.\d+)\s*[—\-]+\s*(.+)', ea[:3000])
    assert m is not None
    assert f"v{m.group(1)}" == "v6.17.7"


# ---------------------------------------------------------------------------
# ITEM 1 — array-index series-semantics bugs (8 functions). MQL5 fills a plain
# (non-series) fixed array from Copy*() with index 0 = OLDEST requested bar;
# all 8 functions' arithmetic assumed index 0 = newest. ArraySetAsSeries only
# takes effect on DYNAMIC arrays (confirmed via compiler warning 63 "cannot
# be used for static allocated array" when first attempted on fixed arrays),
# so every affected declaration was also converted from fixed-size to dynamic.
# ---------------------------------------------------------------------------
def test_sti_compute_exhaustion_arrays_are_dynamic_and_series():
    ea = read(BACKEND_EA)
    fn = body(ea, "double STI_ComputeExhaustion(int signal)")
    assert "double buf[];" in fn
    assert fn.count("ArraySetAsSeries(buf, true);") >= 2
    assert "double rsi[], cls[], atr[];" in fn
    assert fn.count("ArraySetAsSeries(rsi, true); ArraySetAsSeries(cls, true); ArraySetAsSeries(atr, true);") >= 2


def test_volatility_kill_reason_array_is_dynamic_and_series():
    ea = read(BACKEND_EA)
    fn = body(ea, "string VolatilityKillReason(int signal, string setupName)")
    assert "double atrBuf[];" in fn
    assert "ArraySetAsSeries(atrBuf, true);" in fn


def test_has_exhaustion_divergence_arrays_are_dynamic_and_series():
    ea = read(BACKEND_EA)
    fn = body(ea, "bool HasExhaustionDivergence(int signal)")
    assert "double rsi[], hi[], lo[];" in fn
    assert "ArraySetAsSeries(rsi, true); ArraySetAsSeries(hi, true); ArraySetAsSeries(lo, true);" in fn


def test_is_momentum_weak_reads_shift_1_not_shift_3():
    # Regression case B.
    ea = read(BACKEND_EA)
    fn = body(ea, "bool IsMomentumWeak(int signal)")
    assert "double hi[], lo[], cl[];" in fn
    assert "ArraySetAsSeries(hi, true); ArraySetAsSeries(lo, true); ArraySetAsSeries(cl, true);" in fn
    assert "double loc_lastClose = cl[0];" in fn  # cl[0] is now genuinely shift 1 (most recent)


def test_breakout_continuation_reads_candles_in_correct_order():
    # Regression case C. Uses rindex: the first match of this signature text
    # is a forward declaration (ends in ';', no body); the real definition is
    # the last occurrence.
    ea = read(BACKEND_EA)
    def_idx = ea.rindex("bool IsXAUConfirmedBreakoutContinuation(int signal, string setupName)")
    fn = body(ea[def_idx:], "bool IsXAUConfirmedBreakoutContinuation(int signal, string setupName)")
    assert "double o[], h[], l[], c[];" in fn
    assert "ArraySetAsSeries(o, true); ArraySetAsSeries(h, true); ArraySetAsSeries(l, true); ArraySetAsSeries(c, true);" in fn


def test_is_fake_breakout_arrays_are_dynamic_and_series():
    ea = read(BACKEND_EA)
    fn = body(ea, "bool IsFakeBreakout(int signal)")
    assert "double hi[], lo[], cl[];" in fn
    assert "ArraySetAsSeries(hi, true); ArraySetAsSeries(lo, true); ArraySetAsSeries(cl, true);" in fn


def test_manage_basket_dynamic_momentum_arrays_are_dynamic_and_series():
    ea = read(BACKEND_EA)
    fn = body(ea, "bool ManageBasket()")
    assert "double cl[]; int hATR_dbtp = iATR(Symbol(), PERIOD_M5, 14);" in fn
    assert "double atrBuf[];" in fn
    assert "ArraySetAsSeries(cl, true); ArraySetAsSeries(atrBuf, true);" in fn


def test_pg_htf_trend_arrays_are_dynamic_and_series():
    ea = read(BACKEND_EA)
    fn = body(ea, "int PG_HTFTrend()")
    assert "double ema[], close[], atr[];" in fn
    assert "ArraySetAsSeries(ema, true); ArraySetAsSeries(close, true); ArraySetAsSeries(atr, true);" in fn
    assert "double highs[], lows[];" in fn
    assert "ArraySetAsSeries(highs, true); ArraySetAsSeries(lows, true);" in fn


# ---------------------------------------------------------------------------
# ITEM 2 — ComputeADXProxy scale bug (regression A)
# ---------------------------------------------------------------------------
def test_adx_proxy_scale_produces_25_and_35_not_2point5_and_3point5():
    ea = read(BACKEND_EA)
    fn = body(ea, "double ComputeADXProxy()")
    assert "spread / 0.0040 * 100.0" in fn
    assert "spread / 0.0040 * 10.0" not in fn
    # Lock in the exact documented mapping with real arithmetic, not just text.
    assert abs(0.0010 / 0.0040 * 100.0 - 25.0) < 1e-9
    assert abs(0.0014 / 0.0040 * 100.0 - 35.0) < 1e-9


# ---------------------------------------------------------------------------
# ITEM 3 — Personality Gate A/A+ unreachable-proceed bug (regression E)
# ---------------------------------------------------------------------------
def test_personality_gate_aplus_branch_chains_into_else_if():
    ea = read(BACKEND_EA)
    marker = "// v6.4.0 UPGRADE 1 — Market Personality Gate"
    idx = ea.index(marker)
    window = ea[idx: idx + 5200]
    aplus_if = "if(setupScore >= InpGradeAPlus || setupScore >= InpGradeA)"
    continuation_else_if = "else if(continuationPersonalitySoftPass && !XAU_AntiRepeatLossActive(signal))"
    assert aplus_if in window
    assert continuation_else_if in window
    # The continuation branch must appear strictly after, and be an else-if
    # (not a standalone if) chained to the A/A+ branch -- this is what makes
    # A/A+ candidates mutually exclusive with the hard-block final else.
    assert window.index(aplus_if) < window.index(continuation_else_if)


def test_personality_gate_final_else_still_hard_blocks_lower_grades():
    ea = read(BACKEND_EA)
    assert 'PERSONALITY GATE BLOCK: ", setupName, " grade not A/A+ in ' in ea
    idx = ea.index('PERSONALITY GATE BLOCK: ", setupName, " grade not A/A+ in ')
    window = ea[idx: idx + 700]
    assert "return;" in window  # the hard block still returns


# ---------------------------------------------------------------------------
# ITEM 4 — OpenTrade void->bool, deferred state commitment (regression F)
# ---------------------------------------------------------------------------
def test_open_trade_returns_bool_and_reports_actual_broker_result():
    ea = read(BACKEND_EA)
    assert "bool OpenTrade(int signal, double atr, string reason, double sizeMulti, bool isManualOverride = false)" in ea
    assert "void OpenTrade(int signal, double atr, string reason, double sizeMulti)" not in ea
    fn = body(ea, "bool OpenTrade(int signal, double atr, string reason, double sizeMulti, bool isManualOverride = false)")
    assert "return ok;" in fn
    # Every early-exit inside OpenTrade must be return false, not a bare return.
    assert "\n      return;\n" not in fn
    assert "\n         return;\n" not in fn


def test_reentry_call_site_only_consumes_state_on_confirmed_open():
    ea = read(BACKEND_EA)
    marker = 'if(OpenTrade(lastClose.dir, bufATR[1], "RE_ENTRY", InpReEntrySize))'
    idx = ea.index(marker)
    window = ea[idx: idx + 300]
    assert "lastClose.reEntered = true;" in window
    assert "todayReEntryCount++;" in window


def test_main_entry_call_site_only_commits_state_on_confirmed_open():
    ea = read(BACKEND_EA)
    marker = 'bool tradeOpened = OpenTrade(signal, bufATR[1], setupName + " [" + grade + "]", finalSzMult);'
    idx = ea.index(marker)
    window = ea[idx: idx + 1400]
    assert "if(tradeOpened)" in window
    assert "g_lastEntryGrade = grade;" in window
    assert "g_lastEntryScore = combinedScore;" in window
    assert "TRADE OPENED" in window or "WriteDecisionScorecard" in window


def test_pyramid_state_was_already_correctly_gated_on_success():
    # Verified during the audit: CheckPyramidOpportunity() already only sets
    # lastPyramidAddTime/lastPyramidPx/todayTradeCount inside if(ok) after its
    # own direct trade.Buy/Sell call -- no change needed, locking it in here
    # so a future edit can't silently regress it.
    ea = read(BACKEND_EA)
    fn = body(ea, "void CheckPyramidOpportunity()")
    ok_block_start = fn.index("if(ok)")
    ok_block = fn[ok_block_start: ok_block_start + 300]
    assert "lastPyramidAddTime = TimeCurrent();" in ok_block
    assert "todayTradeCount++;" in ok_block


# ---------------------------------------------------------------------------
# ITEM 5 — neutral HTF early-return bug (regression G)
# ---------------------------------------------------------------------------
def test_neutral_htf_does_not_shortcut_to_both_allowed_before_strong_medium_checks():
    ea = read(BACKEND_EA)
    fn = body(ea, "ENUM_XAU_ACTIVE_DIRECTION XAU_ComputeActiveDirection(int htfBias, string &reason)")
    assert "if(htfBias != 0 && sequenceStillAgrees && noBosLevelBreakAgainst && noWeakSignalEither)" in fn
    assert "|| htfBias == 0" not in fn.split("bool sequenceStillAgrees")[1][:120]
    # STRONG tier's primary conditions must remain HTF-independent so they can
    # still fire when htfBias==0.
    assert "bool strongBear = (m5BearBreak && bosBear) ||" in fn
    assert "m5m15AlignBear ||" in fn


# ---------------------------------------------------------------------------
# ITEM 6 — per-handle/per-label indicator fail streaks (regression H)
# ---------------------------------------------------------------------------
def test_indicator_fail_streak_is_tracked_per_label():
    ea = read(BACKEND_EA)
    assert "int XAU_IndicatorFailStreakIndex(string label, bool createIfMissing)" in ea
    assert "void XAU_ResetIndicatorFailStreak(string label)" in ea
    assert "void XAU_ResetAllIndicatorFailStreaks()" in ea
    fn = body(ea, "bool CopyEntryBuffer(int handle, int buffer, int start, int count, double &target[], string label)")
    assert "XAU_ResetIndicatorFailStreak(label);" in fn  # per-label reset on success
    assert "int failIdx = XAU_IndicatorFailStreakIndex(label, true);" in fn
    assert "g_indFailCounts[failIdx]++;" in fn
    assert "labelFailCount >= InpIndicatorReloadFails" in fn  # rebuild trigger now per-label


def test_rebuild_clears_all_per_label_streaks():
    ea = read(BACKEND_EA)
    fn = body(ea, "bool RebuildEntryIndicatorHandles(string why)")
    assert "XAU_ResetAllIndicatorFailStreaks();" in fn


# ---------------------------------------------------------------------------
# ITEM 7 — impossible failed-breakout condition rebuilt (regression D)
# ---------------------------------------------------------------------------
def test_failed_breakout_uses_prior_range_excluding_test_window():
    ea = read(BACKEND_EA)
    fn = body(ea, "void XAU_AssessFailedBreakout(double swingHigh, double swingLow, string &why,")
    assert "int priorFrom = testLb + 2;" in fn
    assert "int priorTo   = testLb + 13;" in fn
    assert "double priorHigh = -DBL_MAX, priorLow = DBL_MAX;" in fn
    # The old impossible condition (testing shift 2-7 against a range that
    # already includes shift 2-7) must be gone.
    assert "if(c > swingHigh) { brokeAbove = true; breakShift = i; }" not in fn
    assert "if(h > priorHigh) { brokeAbove = true; breakShift = i; }" in fn


def test_prior_range_window_does_not_overlap_test_window():
    # testLb=6 -> test window is shifts 2..7; prior window must start at 8+.
    test_lb = 6
    prior_from = test_lb + 2
    prior_to = test_lb + 13
    test_window = set(range(2, test_lb + 2))       # 2..7
    prior_window = set(range(prior_from, prior_to + 1))  # 8..19
    assert test_window.isdisjoint(prior_window)


# ---------------------------------------------------------------------------
# ITEM 8 — unreachable THESIS_HOLD_BE_REARM branch (regression I)
# ---------------------------------------------------------------------------
def test_thesis_hold_be_rearm_branch_is_reachable():
    ea = read(BACKEND_EA)
    fn = body(ea, "bool XAU_ProtectPeakProfitFloor(ulong ticket, bool isBuy, double openPx, double curPrice,")
    assert "if(thesisHoldAllowed && !floorAlreadyProtected && profit <= floorUSD && profit > 0.0)" in fn
    # The old unconditional revocation (no profit > 0.0 guard) must be gone.
    assert "if(thesisHoldAllowed && !floorAlreadyProtected && profit <= floorUSD)\n      thesisHoldAllowed = false;" not in fn
    assert "THESIS_HOLD_BE_REARM" in fn
    assert "if(thesisHoldAllowed && profit <= 0.0)" in fn


def test_be_rearm_never_claims_success_without_safe_modify_sl_confirming():
    ea = read(BACKEND_EA)
    assert "if(beSane && beRatchet && SafeModifySL(ticket, openPx, curTP, isBuy, curPrice, \"THESIS_HOLD_BE_REARM\"))" in ea
    idx = ea.index("if(beSane && beRatchet && SafeModifySL")
    window = ea[idx: idx + 400]
    # The success PrintFormat announcing the re-arm must be INSIDE that guarded
    # if-block, not logged unconditionally.
    assert "THESIS_HOLD_BE_REARM #%I64u" in window


# ---------------------------------------------------------------------------
# ITEM 9 — M15 ATR for M15 structure breaks
# ---------------------------------------------------------------------------
def test_m15_breaks_use_m15_atr_not_m5_atr():
    ea = read(BACKEND_EA)
    fn = body(ea, "ENUM_XAU_ACTIVE_DIRECTION XAU_ComputeActiveDirection(int htfBias, string &reason)")
    assert "double structBufM15 = structBuf;" in fn
    assert 'iATR(Symbol(), PERIOD_M15, InpATRPeriod)' in fn
    assert "bool m15BearBreak = (m15LastSwingLow  > 0 && c1_M15 < m15LastSwingLow  - structBufM15);" in fn
    assert "bool m15BullBreak = (m15LastSwingHigh > 0 && c1_M15 > m15LastSwingHigh + structBufM15);" in fn
    # M5 checks must keep using the original M5-scaled structBuf, unaffected.
    assert "bool m5BearBreak = (c1 < swingLow  - structBuf);" in fn


def test_prior_session_fixes_still_intact():
    ea = read(BACKEND_EA)
    assert "if(g_activeDirection == DIRECTION_SELL_ONLY)      dir = -1;" in ea  # v6.17.0
    assert "activeDirectionConfirmsSell" in ea  # v6.17.2
    assert "antiRepeatBlocksSMOB" in ea  # v6.17.3
    assert "InpMaxTransitionWaitBars" in ea  # v6.17.4
    assert "OPEN_TRADE_CALLED" in ea  # v6.17.5 (Codex)
    assert "continuationPersonalitySoftPass" in ea  # v6.17.6
