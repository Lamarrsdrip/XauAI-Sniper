from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.17.25.mq5"
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


def test_version_bumped_to_v61725():
    ea = read(BACKEND_EA)
    assert '#define XAUAI_EA_VERSION "v6.17.25"' in ea


def test_header_banner_matches_property_version_for_website_display():
    import re
    ea = read(BACKEND_EA)
    m = re.search(r'v(\d+\.\d+\.\d+)\s*[—\-]+\s*(.+)', ea[:3000])
    assert m is not None
    assert f"v{m.group(1)}" == "v6.17.25"


# ---------------------------------------------------------------------------
# Entry execution graph -- every OpenTrade() call site accounted for
# ---------------------------------------------------------------------------
def test_exactly_four_known_opentrade_call_sites_exist_and_no_others():
    # The audit traced exactly 4 real callers. Rather than a generic regex
    # scan (unreliable -- the file has many prose comments mentioning
    # "OpenTrade()" that aren't calls), assert each known call site exists
    # exactly once. A 5th real caller appearing anywhere would be a new,
    # untraced entry path this test suite doesn't yet know about.
    ea = read(BACKEND_EA)
    known_calls = [
        'OpenTrade(signal, bufATR[1], setupName + " [" + grade + "]", finalSzMult);',  # normal path
        'OpenTrade(lastClose.dir, bufATR[1], "RE_ENTRY", InpReEntrySize)',              # RE_ENTRY
        "OpenTrade(dir, atrNow, recoveryReason, 1.0);",                                 # recovery
        "OpenTrade(dir, atrNow, forceReason, 1.0, true);",                              # manual force-open
    ]
    for call in known_calls:
        assert ea.count(call) == 1, f"expected exactly 1 occurrence of {call!r}, found {ea.count(call)}"


def test_opentrade_signature_has_manual_override_defaulting_false():
    ea = read(BACKEND_EA)
    assert "bool OpenTrade(int signal, double atr, string reason, double sizeMulti, bool isManualOverride = false)" in ea


# ---------------------------------------------------------------------------
# Fix 1: ContextGateAllows setup identity
# ---------------------------------------------------------------------------
def test_contextgateallows_receives_and_uses_real_setup_name():
    ea = read(BACKEND_EA)
    assert "bool ContextGateAllows(int signal, double atr, string setupName = \"\")" in ea
    fn = body(ea, "bool ContextGateAllows(int signal, double atr, string setupName = \"\")")
    assert 'XAU_ClassifySetup(signal, atr, setupName, cgClass);' in fn
    assert 'XAU_ClassifySetup(signal, atr, "", cgClass)' not in fn


def test_normal_scan_path_passes_real_setup_name_to_contextgate():
    ea = read(BACKEND_EA)
    assert "ContextGateAllows(signal, bufATR[1], setupName)" in ea


# ---------------------------------------------------------------------------
# Fix 2: manual override bypasses soft judgment, never hard safety
# ---------------------------------------------------------------------------
def test_exhaustion_guard_backstop_skipped_only_for_manual_override():
    ea = read(BACKEND_EA)
    fn = body(ea, "bool OpenTrade(int signal, double atr, string reason, double sizeMulti, bool isManualOverride = false)")
    assert "if(!guardAllows && !isManualOverride)" in fn


def test_hard_safety_gates_have_no_manual_override_exemption():
    ea = read(BACKEND_EA)
    fn = body(ea, "bool OpenTrade(int signal, double atr, string reason, double sizeMulti, bool isManualOverride = false)")
    # hedge/exposure gates must NOT be conditioned on isManualOverride anywhere
    hedge_section = fn[fn.index("Execution-layer hedge backstop"):fn.index("Execution-layer hedge backstop") + 1500]
    assert "isManualOverride" not in hedge_section


def test_force_open_trade_passes_manual_override_true():
    ea = read(BACKEND_EA)
    assert "OpenTrade(dir, atrNow, forceReason, 1.0, true)" in ea


def test_other_three_callers_do_not_pass_manual_override():
    ea = read(BACKEND_EA)
    assert 'OpenTrade(lastClose.dir, bufATR[1], "RE_ENTRY", InpReEntrySize))' in ea
    assert "OpenTrade(dir, atrNow, recoveryReason, 1.0);" in ea
    assert 'OpenTrade(signal, bufATR[1], setupName + " [" + grade + "]", finalSzMult);' in ea


# ---------------------------------------------------------------------------
# Fix 3: RE_ENTRY now uses the classifier + timing engine
# ---------------------------------------------------------------------------
def test_reentry_calls_classifier_and_rejects_late_chase():
    ea = read(BACKEND_EA)
    fn = body(ea, "void CheckReEntryOpportunity()")
    assert 'XAU_ClassifySetup(lastClose.dir, bufATR[1], "RE_ENTRY", reClass)' in fn
    assert "if(reClass.type == XAU_TIMING_LATE_CHASE)" in fn
    # late-chase cancel is one-shot (reEntered=true), NOT a retry-later wait
    late_chase_section = fn[fn.index("if(reClass.type == XAU_TIMING_LATE_CHASE)"):]
    late_chase_block = late_chase_section[:late_chase_section.index("XAU_TimingEngineConfirmsEntry")]
    assert "lastClose.reEntered = true;" in late_chase_block


def test_reentry_routes_through_timing_engine_and_does_not_permanently_cancel_on_wait():
    ea = read(BACKEND_EA)
    fn = body(ea, "void CheckReEntryOpportunity()")
    assert 'XAU_TimingEngineConfirmsEntry(lastClose.dir, "RE_ENTRY", "A", InpReEntrySize, bufATR[1])' in fn
    wait_section = fn[fn.index('if(!XAU_TimingEngineConfirmsEntry(lastClose.dir, "RE_ENTRY"'):]
    wait_block = wait_section[:wait_section.index("Print(\"RE-ENTRY TRIGGER")]
    assert "lastClose.reEntered = true;" not in wait_block


# ---------------------------------------------------------------------------
# Fix 4: recovery path rejects on fresh M5 structure classification
# ---------------------------------------------------------------------------
def test_recovery_calls_classifier_and_rejects_late_chase():
    ea = read(BACKEND_EA)
    fn = body(ea, "void XAU_CheckPendingOpportunityRecovery()")
    assert "XAU_ClassifySetup(dir, atrNow, setup, recClass)" in fn
    assert "if(recClass.type == XAU_TIMING_LATE_CHASE)" in fn
    assert "reason=M5_STRUCTURE_NO_LONGER_SUPPORTS" in fn


# ---------------------------------------------------------------------------
# Fix 5: timing engine reconfirm branch re-checks LATE_CHASE on the confirming bar
# ---------------------------------------------------------------------------
def test_timing_engine_reconfirm_rejects_still_late_chase():
    ea = read(BACKEND_EA)
    fn = body(ea, "bool XAU_TimingEngineConfirmsEntry(int dir, string setup, string grade, double sizeMulti, double atr)")
    assert "else if(tcls.type == XAU_TIMING_LATE_CHASE)" in fn
    assert "STILL_LATE_CHASE_ON_CONFIRM" in fn


# ---------------------------------------------------------------------------
# Fix 6: force-open diagnostics
# ---------------------------------------------------------------------------
def test_force_open_precise_stale_reasons_not_generic():
    ea = read(BACKEND_EA)
    fn = body(ea, "bool XAU_TryForceOpenTrade(int dir, string setup, string grade, string originalBlocker,")
    assert 'rejectReason = "INVALID_CANDLE_TIME";' in fn
    assert 'rejectReason = StringFormat("STALE_CANDIDATE_%d_BARS_OLD_MAX_3", barsElapsed);' in fn
    assert 'rejectReason = "STALE_OR_INVALID";' not in fn


def test_force_open_classification_is_informational_not_blocking():
    ea = read(BACKEND_EA)
    fn = body(ea, "bool XAU_TryForceOpenTrade(int dir, string setup, string grade, string originalBlocker,")
    assert "XAU_ClassifySetup(dir, atrNow, setup, foClass)" in fn
    # must never reject based on foClass -- only informational text
    after_classify = fn[fn.index("XAU_ClassifySetup(dir, atrNow, setup, foClass)"):]
    assert "return false" not in after_classify.split("bool opened")[0]


# ---------------------------------------------------------------------------
# Behavioral simulations
# ---------------------------------------------------------------------------
class FakeTimingEngine:
    """Mirrors XAU_TimingEngineConfirmsEntry's corrected state machine."""
    BAR = 300

    def __init__(self):
        self.active = False
        self.dir = 0
        self.setup = ""
        self.signal_price = 0.0
        self.atr = 0.0
        self.first_seen_candle = 0

    def confirms(self, dir_, setup, price, atr, now_candle, classify_type, immediate_confirm):
        if immediate_confirm:
            self.active = False
            return True
        same = (self.active and self.dir == dir_ and self.setup == setup and
                now_candle == self.first_seen_candle + self.BAR)
        if same:
            moved = (price - self.signal_price) if dir_ == 1 else (self.signal_price - price)
            if moved <= self.atr * 1.0 and classify_type != "LATE_CHASE":
                self.active = False
                return True
        self.active = True
        self.dir = dir_
        self.setup = setup
        self.signal_price = price
        self.atr = atr
        self.first_seen_candle = now_candle
        return False


def test_strong_continuation_enters_immediately():
    eng = FakeTimingEngine()
    assert eng.confirms(-1, "TREND_PULLBACK", 4050.0, 6.0, 1000, "TREND_CONTINUATION", True) is True


def test_marginal_signal_waits_for_confirmation():
    eng = FakeTimingEngine()
    assert eng.confirms(-1, "TREND_PULLBACK", 4050.0, 6.0, 1000, "TREND_CONTINUATION", False) is False


def test_pending_buy_switching_to_sell_does_not_reuse_buy_state():
    eng = FakeTimingEngine()
    assert eng.confirms(1, "TREND_PULLBACK", 4050.0, 6.0, 1000, "TREND_CONTINUATION", False) is False
    # next bar: SAME setup name but opposite direction proposed -- must NOT confirm as if it were the BUY
    assert eng.confirms(-1, "TREND_PULLBACK", 4049.0, 6.0, 1300, "TREND_CONTINUATION", False) is False
    assert eng.dir == -1  # pending state now reflects the NEW direction, not a stale BUY


def test_pending_signal_that_overextends_is_reassessed_not_chased():
    eng = FakeTimingEngine()
    assert eng.confirms(1, "TREND_PULLBACK", 4050.0, 6.0, 1000, "TREND_CONTINUATION", False) is False
    # price ran 20 (>1xATR=6) in BUY's favor by the confirming bar -- must NOT fire
    assert eng.confirms(1, "TREND_PULLBACK", 4070.0, 6.0, 1300, "TREND_CONTINUATION", False) is False


def test_pending_signal_still_late_chase_on_confirm_is_rejected_not_waved_through():
    # Regression for the bug found while tracing this: persisting for one bar
    # used to be enough regardless of the SECOND bar's own classification.
    eng = FakeTimingEngine()
    assert eng.confirms(1, "RECLAIM_SETUP", 4038.0, 6.0, 1000, "LATE_CHASE", False) is False
    assert eng.confirms(1, "RECLAIM_SETUP", 4038.5, 6.0, 1300, "LATE_CHASE", False) is False


def test_genuinely_improved_signal_confirms_on_second_bar():
    eng = FakeTimingEngine()
    assert eng.confirms(1, "TREND_PULLBACK", 4038.0, 6.0, 1000, "TREND_CONTINUATION", False) is False
    assert eng.confirms(1, "TREND_PULLBACK", 4039.0, 6.0, 1300, "TREND_CONTINUATION", False) is True


# ---------------------------------------------------------------------------
# Recovery / re-entry decision simulations
# ---------------------------------------------------------------------------
def test_recovery_cancelled_when_direction_no_longer_valid():
    def recovery_allowed(classify_type):
        return classify_type != "LATE_CHASE"
    assert recovery_allowed("LATE_CHASE") is False


def test_recovery_executes_with_fresh_confirmation():
    def recovery_allowed(classify_type):
        return classify_type != "LATE_CHASE"
    assert recovery_allowed("PULLBACK_SCALP") is True
    assert recovery_allowed("TREND_CONTINUATION") is True


def test_stopped_out_trade_cannot_reenter_from_retest_alone():
    # Active Direction agreement (retest-alone) is no longer sufficient by
    # itself -- LATE_CHASE classification must still block it.
    active_direction_agrees = True
    classify_type = "LATE_CHASE"
    reentry_allowed = active_direction_agrees and classify_type != "LATE_CHASE"
    assert reentry_allowed is False


def test_valid_fresh_reentry_can_execute():
    active_direction_agrees = True
    classify_type = "TREND_CONTINUATION"
    immediate_confirm = True
    reentry_allowed = active_direction_agrees and classify_type != "LATE_CHASE" and immediate_confirm
    assert reentry_allowed is True
