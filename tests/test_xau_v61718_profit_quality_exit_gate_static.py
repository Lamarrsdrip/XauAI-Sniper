from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.17.18.mq5"
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


def test_version_bumped_to_v61718():
    ea = read(BACKEND_EA)
    assert '#define XAUAI_EA_VERSION "v6.17.18"' in ea


def test_header_banner_matches_property_version_for_website_display():
    import re
    ea = read(BACKEND_EA)
    m = re.search(r'v(\d+\.\d+\.\d+)\s*[—\-]+\s*(.+)', ea[:3000])
    assert m is not None
    assert f"v{m.group(1)}" == "v6.17.18"


# ---------------------------------------------------------------------------
# PROFIT QUALITY GATE: new inputs exist with the exact tuned defaults.
# ---------------------------------------------------------------------------
def test_profit_quality_inputs_present_with_exact_defaults():
    ea = read(BACKEND_EA)
    assert "input double InpProfitQualityMinR             = 0.80;" in ea
    assert "input double InpProfitQualityRunnerLockPct    = 22.0;" in ea
    assert "input double InpProfitQualityBigWinRMultiple  = 2.50;" in ea
    assert "input double InpProfitQualitySpreadImpactPct  = 30.0;" in ea


def test_assess_profit_quality_function_exists_and_computes_expected_metrics():
    ea = read(BACKEND_EA)
    fn = body(ea, "XAU_ProfitQuality XAU_AssessProfitQuality(double profit, double peak, double rDollars, double atr,")
    assert "q.profitR = (rDollars > 0.0) ? profit / rDollars : 0.0;" in fn
    assert "q.tinyProfit = (q.profitR < InpProfitQualityMinR);" in fn
    assert "q.bigWin = (q.profitR >= InpProfitQualityBigWinRMultiple);" in fn
    assert 'q.spreadImpactPct >= InpProfitQualitySpreadImpactPct' in fn


def test_quality_decision_matrix_matches_the_four_rules():
    ea = read(BACKEND_EA)
    fn = body(ea, "XAU_ProfitQuality XAU_AssessProfitQuality(double profit, double peak, double rDollars, double atr,")
    # Rule 3: thesis weakened or exit case is strong -> PROTECT_TIGHT (unchanged/tighter), evaluated first.
    tight_idx = fn.index('if(!q.thesisStillValid || q.exitStrength >= 3)')
    hold_idx = fn.index('else if((q.tinyProfit || q.spreadDominates) && !q.bigWin)')
    wide_idx = fn.index('q.decision = "PROTECT_WIDE";')
    assert tight_idx < hold_idx < wide_idx
    # Rule 1: tiny/spread-dominated profit + big win overrides it (a big win is always worth protecting).
    assert '&& !q.bigWin)' in fn


# ---------------------------------------------------------------------------
# INTEGRATION: the gate must run BEFORE the SL is ever tightened, and must
# be able to fully skip tightening (HOLD) rather than just influencing the
# close decision -- this is the actual bug fix (SL_MOD:PROFIT_FLOOR used to
# be unconditional once armed).
# ---------------------------------------------------------------------------
def test_hold_decision_returns_before_any_sl_tightening():
    ea = read(BACKEND_EA)
    fn = body(ea, "bool XAU_ProtectPeakProfitFloor(ulong ticket, bool isBuy, double openPx, double curPrice,")
    hold_check_idx = fn.index('if(pq.decision == "HOLD")')
    sl_tighten_idx = fn.index('SafeModifySL(ticket, floorSL, curTP, isBuy, curPrice, "PROFIT_FLOOR")')
    assert hold_check_idx < sl_tighten_idx
    # And the HOLD branch actually returns false (skips this tick entirely).
    hold_branch = fn[hold_check_idx: hold_check_idx + 700]
    assert "return false;" in hold_branch


def test_widen_only_applies_to_clean_continuation_contexts_not_overextension():
    ea = read(BACKEND_EA)
    fn = body(ea, "bool XAU_ProtectPeakProfitFloor(ulong ticket, bool isBuy, double openPx, double curPrice,")
    assert 'pq.decision == "PROTECT_WIDE" &&' in fn
    widen_idx = fn.index('pq.decision == "PROTECT_WIDE" &&')
    window = fn[widen_idx: widen_idx + 300]
    assert "XAU_CONTEXT_STRONG_TREND" in window
    assert "XAU_CONTEXT_NORMAL_PULLBACK" in window
    # Must never override EXPLOSIVE_MOVE/TREND_EXHAUSTION/WEAK_TRADE's deliberate tightening.
    assert "XAU_CONTEXT_EXPLOSIVE_MOVE" not in window
    assert "XAU_CONTEXT_TREND_EXHAUSTION" not in window


def test_quality_gate_computed_before_context_classification():
    # pq must exist before contextState/lockPct so the HOLD short-circuit
    # actually saves the classification work, and so PROTECT_WIDE can see
    # the real contextState it needs to check against.
    ea = read(BACKEND_EA)
    fn = body(ea, "bool XAU_ProtectPeakProfitFloor(ulong ticket, bool isBuy, double openPx, double curPrice,")
    pq_idx = fn.index("XAU_ProfitQuality pq = XAU_AssessProfitQuality(")
    context_idx = fn.index("XAU_TRADE_CONTEXT_STATE contextState = XAU_ClassifyTradeContext(floorRunnerClean, momentumScore,")
    assert pq_idx < context_idx


def test_full_close_path_still_gated_by_thesis_hold_unchanged():
    # The v6.17.7-era thesis-hold-before-full-close protection must remain
    # intact -- this fix only changes the SL-tightening step, not the
    # existing full-close safety logic.
    ea = read(BACKEND_EA)
    fn = body(ea, "bool XAU_ProtectPeakProfitFloor(ulong ticket, bool isBuy, double openPx, double curPrice,")
    assert "if(thesisHoldAllowed && profit <= 0.0)" in fn
    assert "if(thesisHoldAllowed && (floorBroken || severeGiveback))" in fn
    assert "if(InpProtectedPeakCloseOnFloorBreak && !thesisHoldAllowed && (floorBroken || severeGiveback || profit <= 0.0))" in fn


def test_telemetry_helper_reports_all_required_fields():
    ea = read(BACKEND_EA)
    fn = body(ea, "string XAU_ProfitQualityTelemetry(const XAU_ProfitQuality &q, double profit, double peak, string closeKind)")
    for field in ("NetProfitAfterCosts", "ProfitR", "ProfitATR", "PeakProfit", "GivebackPct",
                  "SpreadCostImpact", "ThesisStillValid", "ExitStrength", "Decision",
                  "CloseKind", "WouldRunnerRemain"):
        assert field in fn


def test_telemetry_wired_into_hold_widen_and_close_events():
    ea = read(BACKEND_EA)
    fn = body(ea, "bool XAU_ProtectPeakProfitFloor(ulong ticket, bool isBuy, double openPx, double curPrice,")
    assert "PROFIT_QUALITY_HOLD" in fn
    assert "PROFIT_QUALITY_WIDEN" in fn
    assert 'XAU_ProfitQualityTelemetry(pq, profit, peak, "FULL_CLOSE")' in fn
    assert 'XAU_ProfitQualityTelemetry(pq, profit, peak, "PROTECT")' in fn


# ---------------------------------------------------------------------------
# SCAN WARM-UP NOISE + SPEED FIX
# ---------------------------------------------------------------------------
def test_scan_state_dedup_uses_digit_collapsed_key_not_raw_string():
    ea = read(BACKEND_EA)
    fn = body(ea, "void XAU_LogScanState(string state)")
    assert "XAU_ScanStateKey(state)" in fn
    assert "lastScanStateKey" in fn
    # Must NOT compare the raw, countdown-embedded string directly anymore.
    assert "if(state == g_lastScanStateLogged)" not in fn


def test_scan_state_key_collapses_digit_runs():
    ea = read(BACKEND_EA)
    fn = body(ea, "string XAU_ScanStateKey(string s)")
    assert 'if(!lastWasDigit) key += "#";' in fn
    assert "ShortToString(c)" in fn


def test_copy_entry_buffer_tries_before_honoring_warmup_ceiling():
    ea = read(BACKEND_EA)
    fn = body(ea, "bool CopyEntryBuffer(int handle, int buffer, int start, int count, double &target[], string label)")
    warmup_gate_idx = fn.index("if(g_indicatorWarmupUntil > 0 && TimeCurrent() < g_indicatorWarmupUntil)")
    early_copy_idx = fn.index("int gotEarly = CopyBuffer(handle, buffer, start, count, target);")
    warmup_wait_idx = fn.index('g_lastSkipReason = StringFormat("INDICATOR_WARMUP: waiting %ds after handle rebuild before copying %s",')
    # The opportunistic copy attempt must happen inside the warmup-ceiling
    # branch, before the code falls through to (re)computing the wait reason.
    assert warmup_gate_idx < early_copy_idx < warmup_wait_idx


def test_early_copy_success_clears_warmup_and_resets_fail_streak():
    ea = read(BACKEND_EA)
    fn = body(ea, "bool CopyEntryBuffer(int handle, int buffer, int start, int count, double &target[], string label)")
    early_idx = fn.index("if(gotEarly >= count)")
    window = fn[early_idx: early_idx + 300]
    assert "g_indicatorWarmupUntil = 0;" in window
    assert "XAU_ResetIndicatorFailStreak(label);" in window
    assert "return true;" in window


def test_prior_session_fixes_still_intact():
    ea = read(BACKEND_EA)
    assert 'if(blockClass == "HARD_BLOCK")' in ea  # v6.17.16
    assert "bool XAU_TryForceOpenTrade(int dir, string setup, string grade, string originalBlocker," in ea  # v6.17.15
    assert "input double InpMaxRiskPctEquity = 5.0;" in ea  # v6.17.14
    assert "double acctFloorLot = MathMax(InpMinAccountLotFloor, balance / 1000.0 * InpAccountLotFloorPer1000);" in ea  # v6.17.17


def test_no_new_protective_or_restrictive_defaults_introduced_on_entry_side():
    # This release must not touch lot sizing or add entry-side blocking
    # ("fear") rules -- it only changes exit-side SL-tightening behavior.
    ea = read(BACKEND_EA)
    assert "input double InpMinAccountLotFloor  = 0.10;" in ea
    assert "input double InpAccountLotFloorPer1000 = 0.08333;" in ea
