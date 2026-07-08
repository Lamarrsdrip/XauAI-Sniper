from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.17.23.mq5"
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


def test_version_bumped_to_v61723():
    ea = read(BACKEND_EA)
    assert '#define XAUAI_EA_VERSION "v6.17.23"' in ea


def test_header_banner_matches_property_version_for_website_display():
    import re
    ea = read(BACKEND_EA)
    m = re.search(r'v(\d+\.\d+\.\d+)\s*[—\-]+\s*(.+)', ea[:3000])
    assert m is not None
    assert f"v{m.group(1)}" == "v6.17.23"


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
    assert "c.immediateConfirm = freshAgreesDir && (hits == 0);" in fn


def test_classifier_countertrend_requires_majority_plus_reclaim():
    ea = read(BACKEND_EA)
    fn = body(ea, "void XAU_ClassifySetup(int dir, double atr, string setupName, XAU_SetupClassification &c)")
    assert "if(hits >= 4 && reclaimSeen)" in fn
    assert "c.type = XAU_TIMING_REVERSAL_RECLAIM;" in fn
    assert "c.type = XAU_TIMING_PULLBACK_SCALP;" in fn
    assert "c.immediateConfirm = (hits >= 5);" in fn


def test_classifier_insufficient_evidence_is_late_chase():
    ea = read(BACKEND_EA)
    fn = body(ea, "void XAU_ClassifySetup(int dir, double atr, string setupName, XAU_SetupClassification &c)")
    assert "c.type = XAU_TIMING_LATE_CHASE;" in fn
    assert "c.immediateConfirm = false;" in fn


# ---------------------------------------------------------------------------
# Gate 1 countertrend exception
# ---------------------------------------------------------------------------
def test_gate1_allows_evidence_backed_countertrend_through():
    ea = read(BACKEND_EA)
    fn = body(ea, "bool ContextGateAllows(int signal, double atr)")
    assert "XAU_ClassifySetup(signal, atr, \"\", cgClass)" in fn
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
    ea = read(BACKEND_EA)
    fn = body(ea, "bool XAU_TimingEngineConfirmsEntry(int dir, string setup, string grade, double sizeMulti, double atr)")
    assert "nowCandle == g_pendingEntryConfirm.firstSeenCandle + PeriodSeconds(PERIOD_M5)" in fn
    assert "OVEREXTENDED_ON_CONFIRM" in fn


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
