from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.17.24.mq5"
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


def test_version_bumped_to_v61724():
    ea = read(BACKEND_EA)
    assert '#define XAUAI_EA_VERSION "v6.17.24"' in ea


def test_header_banner_matches_property_version_for_website_display():
    import re
    ea = read(BACKEND_EA)
    m = re.search(r'v(\d+\.\d+\.\d+)\s*[—\-]+\s*(.+)', ea[:3000])
    assert m is not None
    assert f"v{m.group(1)}" == "v6.17.24"


# ---------------------------------------------------------------------------
# XAU_ExhaustionReversalGuard (v6.17.21) must be byte-for-byte untouched --
# the classifier is deliberately independent, per its own comment.
# ---------------------------------------------------------------------------
def test_exhaustion_reversal_guard_unchanged_by_the_new_classifier():
    ea = read(BACKEND_EA)
    fn = body(ea, "bool XAU_ExhaustionReversalGuard(int dir, double atr,")
    assert "sellHits >= 4 && sellReclaimSeen" in fn
    assert "buyHits >= 4 && buyReclaimSeen" in fn
    assert "XAU_ClassifySetup" not in fn  # confirms it was NOT refactored to call the new classifier


# ---------------------------------------------------------------------------
# XAU_ClassifySetup
# ---------------------------------------------------------------------------
def test_classifier_enum_and_struct_exist():
    ea = read(BACKEND_EA)
    assert "enum ENUM_XAU_SetupTiming" in ea
    for tag in ("XAU_TIMING_TREND_CONTINUATION", "XAU_TIMING_PULLBACK_SCALP",
                "XAU_TIMING_REVERSAL_RECLAIM", "XAU_TIMING_BREAKOUT_RETEST", "XAU_TIMING_LATE_CHASE"):
        assert tag in ea
    assert "struct XAU_SetupClassification" in ea


def test_classifier_agrees_with_trend_is_continuation():
    ea = read(BACKEND_EA)
    fn = body(ea, "void XAU_ClassifySetup(int dir, double atr, string setupName, XAU_SetupClassification &c)")
    assert "if(dirAgreesOldTrend)" in fn
    assert "c.type = XAU_TIMING_TREND_CONTINUATION;" in fn
    assert "c.immediateConfirm = freshAgreesDir && (hitsAgainstDir == 0);" in fn


def test_classifier_countertrend_requires_majority_plus_reclaim():
    ea = read(BACKEND_EA)
    fn = body(ea, "void XAU_ClassifySetup(int dir, double atr, string setupName, XAU_SetupClassification &c)")
    assert "if(hitsAgainstOldTrend >= 4 && oldReclaimSeen)" in fn
    assert "c.type = XAU_TIMING_REVERSAL_RECLAIM;" in fn
    assert "c.type = XAU_TIMING_PULLBACK_SCALP;" in fn
    assert "c.immediateConfirm = (hitsAgainstOldTrend >= 5);" in fn


def test_classifier_countertrend_evidence_uses_old_trend_side_not_dirs_own_side():
    # Regression guard for a real bug caught before ship: the countertrend
    # checklist must be built from the OLD TREND's side (oldTrendIsSell),
    # never from dir's own side (dirIsSell) -- otherwise a countertrend BUY
    # against a bearish old trend gets checked for "has this BUY already run
    # up," which is nonsensical for a trade that hasn't been taken and is
    # nearly impossible to satisfy in an actual downtrend.
    ea = read(BACKEND_EA)
    fn = body(ea, "void XAU_ClassifySetup(int dir, double atr, string setupName, XAU_SetupClassification &c)")
    countertrend_section = fn[fn.index("bool oldTrendIsSell"):]
    assert "oldTrendIsSell ? (roomUp   >= 3.0) : (roomDown >= 3.0)" in countertrend_section
    assert "bool oldTrendIsSell = (oldBiasDir == -1);" in fn


def test_classifier_insufficient_evidence_is_late_chase():
    ea = read(BACKEND_EA)
    fn = body(ea, "void XAU_ClassifySetup(int dir, double atr, string setupName, XAU_SetupClassification &c)")
    assert "c.type = XAU_TIMING_LATE_CHASE;" in fn
    assert "c.immediateConfirm = false;" in fn


# ---------------------------------------------------------------------------
# Gate 1 countertrend exception
# ---------------------------------------------------------------------------
def test_gate1_allows_evidence_backed_countertrend_through():
    # v6.17.25: ContextGateAllows gained a setupName parameter (propagating
    # the real candidate setup instead of "") -- see test_xau_v61725 for
    # that fix specifically.
    ea = read(BACKEND_EA)
    fn = body(ea, "bool ContextGateAllows(int signal, double atr, string setupName = \"\")")
    assert "XAU_ClassifySetup(signal, atr, setupName, cgClass)" in fn
    assert "cgClass.type == XAU_TIMING_PULLBACK_SCALP || cgClass.type == XAU_TIMING_REVERSAL_RECLAIM" in fn
    # the LATE_CHASE / TREND_CONTINUATION-against-dir path must still return false
    gate1 = fn[:fn.index("// === Gate 2")]
    assert "return false;" in gate1


# ---------------------------------------------------------------------------
# Timing engine adaptive skip
# ---------------------------------------------------------------------------
def test_timing_engine_skips_wait_when_immediate_confirm():
    ea = read(BACKEND_EA)
    fn = body(ea, "bool XAU_TimingEngineConfirmsEntry(int dir, string setup, string grade, double sizeMulti, double atr)")
    assert "XAU_ClassifySetup(dir, atr, setup, tcls)" in fn
    idx_immediate = fn.index("if(tcls.immediateConfirm)")
    idx_return_true = fn.index("return true;", idx_immediate)
    idx_wait_logic = fn.index("g_pendingEntryConfirm.active &&")
    assert idx_immediate < idx_return_true < idx_wait_logic


def test_timing_engine_one_bar_wait_logic_still_present_for_uncertain_signals():
    # v6.21.2 audit fix: the one-bar wait for uncertain signals has been
    # REMOVED -- uncertain/marginal signals now go through the SAME bounded
    # 120-180s wall-clock delay as every other signal (no exemption, no bar
    # wait), with the equivalent chase-rejection now PRICE_RAN_TOO_FAR_CHASE.
    ea = read(BACKEND_EA)
    fn = body(ea, "bool XAU_TimingEngineConfirmsEntry(int dir, string setup, string grade, double sizeMulti, double atr)")
    assert "nowCandle == g_pendingEntryConfirm.firstSeenCandle + PeriodSeconds(PERIOD_M5)" not in fn
    assert "PRICE_RAN_TOO_FAR_CHASE" in fn


# ---------------------------------------------------------------------------
# Behavioral simulation of the classifier's decision rules
# ---------------------------------------------------------------------------
def classify(dir_, old_bias_dir, seq_dir, hits, reclaim_seen, setup_name=""):
    """Mirrors XAU_ClassifySetup's decision tree (not its raw evidence math)."""
    dir_agrees_old_trend = (old_bias_dir == 0 or old_bias_dir == dir_)
    fresh_agrees_dir = (seq_dir == 0 or seq_dir == dir_)

    if setup_name == "BREAKOUT":
        return ("BREAKOUT_RETEST", hits == 0)
    if dir_agrees_old_trend:
        return ("TREND_CONTINUATION", fresh_agrees_dir and hits == 0)
    if hits >= 4 and reclaim_seen:
        immediate = hits >= 5
        return (("REVERSAL_RECLAIM" if fresh_agrees_dir else "PULLBACK_SCALP"), immediate)
    return ("LATE_CHASE", False)


def test_clean_continuation_is_immediate():
    t, imm = classify(dir_=-1, old_bias_dir=-1, seq_dir=-1, hits=0, reclaim_seen=False)
    assert t == "TREND_CONTINUATION" and imm is True


def test_continuation_with_any_opposing_signal_waits():
    t, imm = classify(dir_=-1, old_bias_dir=-1, seq_dir=-1, hits=1, reclaim_seen=False)
    assert t == "TREND_CONTINUATION" and imm is False


def test_marginal_countertrend_reclaim_waits_one_bar():
    # exactly the posId 9483784022 SELL's mirror-image BUY case: 4/6, structure
    # already flipped -- REVERSAL_RECLAIM, but not strong enough to skip the wait.
    t, imm = classify(dir_=1, old_bias_dir=-1, seq_dir=1, hits=4, reclaim_seen=True)
    assert t == "REVERSAL_RECLAIM" and imm is False


def test_strong_countertrend_reclaim_is_immediate():
    t, imm = classify(dir_=1, old_bias_dir=-1, seq_dir=1, hits=5, reclaim_seen=True)
    assert t == "REVERSAL_RECLAIM" and imm is True


def test_countertrend_bounce_within_trend_is_pullback_scalp():
    # oversold bounce in a downtrend: old trend still down, structure hasn't
    # flipped (seq_dir stays -1), but enough reversal evidence for a scalp.
    t, imm = classify(dir_=1, old_bias_dir=-1, seq_dir=-1, hits=4, reclaim_seen=True)
    assert t == "PULLBACK_SCALP"


def test_countertrend_without_evidence_is_late_chase_never_immediate():
    t, imm = classify(dir_=1, old_bias_dir=-1, seq_dir=-1, hits=2, reclaim_seen=False)
    assert t == "LATE_CHASE" and imm is False


# ---------------------------------------------------------------------------
# End-to-end numeric simulation of the actual evidence math (roomUp/roomDown/
# reclaim/etc from raw price/ATR), not hand-fed hits/reclaim -- this is what
# actually catches the pre-fix bug (checklist built from dir's own side
# instead of the old trend's side), not just the decision tree above it.
# ---------------------------------------------------------------------------
def classify_from_market(dir_, old_bias_dir, seq_dir, swing_high, swing_low, cur_price, atr,
                          sweep_rej_up, sweep_rej_down, choch_bull, choch_bear, rsi, momentum):
    room_up = (swing_high - cur_price) / atr
    room_down = (cur_price - swing_low) / atr
    dir_agrees_old_trend = (old_bias_dir == 0 or old_bias_dir == dir_)
    fresh_agrees_dir = (seq_dir == 0 or seq_dir == dir_)

    def checklist(is_sell):
        large_leg = room_up >= 3.0 if is_sell else room_down >= 3.0
        near_extreme = room_down <= 0.5 if is_sell else room_up <= 0.5
        reclaim = (sweep_rej_up or seq_dir == 1) if is_sell else (sweep_rej_down or seq_dir == -1)
        struct_broken = choch_bull if is_sell else choch_bear
        room_asym = (room_down < room_up) if is_sell else (room_up < room_down)
        mom_fading = (rsi > 50.0 or momentum > 0) if is_sell else (rsi < 50.0 or momentum < 0)
        hits = sum([large_leg, near_extreme, reclaim, struct_broken, room_asym, mom_fading])
        return hits, reclaim

    if dir_agrees_old_trend:
        hits, reclaim = checklist(is_sell=(dir_ == -1))
        return ("TREND_CONTINUATION", fresh_agrees_dir and hits == 0)

    # Countertrend: must use the OLD TREND's side, not dir's own side.
    hits, reclaim = checklist(is_sell=(old_bias_dir == -1))
    if hits >= 4 and reclaim:
        return (("REVERSAL_RECLAIM" if fresh_agrees_dir else "PULLBACK_SCALP"), hits >= 5)
    return ("LATE_CHASE", False)


def test_oversold_bounce_in_downtrend_classifies_as_pullback_or_reclaim_not_late_chase():
    # The exact real-world scenario the user described: "market is oversold
    # in a downtrend" -- old trend bearish, price has fallen hard from a
    # recent high, is sitting near the low, and shows a bullish reclaim
    # (sweep + rejection off the low). A countertrend BUY here MUST classify
    # as PULLBACK_SCALP/REVERSAL_RECLAIM, not LATE_CHASE, or the bug is back.
    atr = 6.0
    swing_high = 4080.0   # recent high
    swing_low  = 4038.0   # recent low
    cur_price  = 4039.0   # sitting right on the low -- classic oversold bounce spot
    t, imm = classify_from_market(
        dir_=1, old_bias_dir=-1, seq_dir=1,   # BUY proposed, old trend bearish, fresh structure already flipped bullish
        swing_high=swing_high, swing_low=swing_low, cur_price=cur_price, atr=atr,
        sweep_rej_up=True, sweep_rej_down=False, choch_bull=True, choch_bear=False,
        rsi=55.0, momentum=0.1,
    )
    assert t in ("PULLBACK_SCALP", "REVERSAL_RECLAIM")


def test_overbought_pullback_in_uptrend_classifies_as_pullback_or_reclaim_not_late_chase():
    # Mirror: old trend bullish, price extended far above a recent low, sitting
    # near the high, bearish reclaim seen -- a countertrend SELL must classify
    # as an evidence-backed scalp/reclaim, not LATE_CHASE.
    atr = 6.0
    swing_high = 4082.0
    swing_low  = 4040.0
    cur_price  = 4081.0   # sitting right on the high
    t, imm = classify_from_market(
        dir_=-1, old_bias_dir=1, seq_dir=-1,   # SELL proposed, old trend bullish, fresh structure already flipped bearish
        swing_high=swing_high, swing_low=swing_low, cur_price=cur_price, atr=atr,
        sweep_rej_up=False, sweep_rej_down=True, choch_bull=False, choch_bear=True,
        rsi=45.0, momentum=-0.1,
    )
    assert t in ("PULLBACK_SCALP", "REVERSAL_RECLAIM")
