"""
v6.28.6 pre-new-week forensic audit -- regression proofs.

Every assertion below is anchored to evidence captured from the live VPS
production journals (Exness account 436698921, XAUUSDm,
Terminal\\D0E8209F77C8CF37AD8BF550E51FF075\\MQL5\\Logs) for
2026-08-30 .. 2026-09-05, during which the EA executed ZERO trades.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EA_PATH = ROOT / "backend" / "ea_code" / "XauCloud.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def fn_body(ea: str, signature: str, size: int = 9000) -> str:
    """Exact function body: skips forward declarations and stops at the real
    closing brace, so a window can never leak into the next function."""
    start = 0
    while True:
        idx = ea.index(signature, start)
        nl = ea.find("\n", idx)
        head = ea[idx:nl if nl > 0 else len(ea)]
        # a forward declaration ends in ");" on its own line
        rest = ea[idx:idx + 4000]
        open_brace = rest.find("{")
        semi = rest.find(";")
        if open_brace != -1 and (semi == -1 or open_brace < semi):
            break
        start = idx + len(signature)
    body_start = ea.index("{", idx)
    depth, i = 0, body_start
    while i < len(ea):
        if ea[i] == "{":
            depth += 1
        elif ea[i] == "}":
            depth -= 1
            if depth == 0:
                return ea[idx:i + 1]
        i += 1
    return ea[idx: idx + size]


EA = read(EA_PATH)


def strip_comments(src: str) -> str:
    """Remove // line comments so 'is this token real code?' checks are honest."""
    out = []
    for line in src.splitlines():
        i = line.find("//")
        out.append(line if i < 0 else line[:i])
    return "\n".join(out)


# ===========================================================================
# FIX 1 -- direction-blind reversal timing (5 of 10 matured candidates lost)
# ===========================================================================
def test_bucket_timing_takes_a_candidate_direction():
    assert "ENUM_XAU_TIMING_STATE XAU_BucketTiming(const XAU_AdaptiveTransitionDecision &td,\n                                       int candidateDirection = 0)" in EA


def test_reversal_side_waits_are_gated_to_reversal_side_candidates():
    fn = fn_body(EA, "ENUM_XAU_TIMING_STATE XAU_BucketTiming(", 2000)
    assert "reversalSideApplies && td.reversalWaitForPullback" in fn
    assert "reversalSideApplies && td.oppositeDisplacement && !td.oppositeReclaim" in fn
    # Unknown direction must preserve the historical (fail-closed) behaviour.
    assert "(candidateDirection == 0) ||" in fn
    assert "(td.dominantDirection == 0) ||" in fn
    assert "(candidateDirection != td.dominantDirection)" in fn


def test_market_thesis_passes_the_candidate_direction_into_timing():
    fn = fn_body(EA, "XAU_MarketThesis XAU_ComputeMarketThesis(", 1500)
    assert "XAU_BucketTiming(td, signal)" in fn


def test_opposite_direction_confirmed_ready_branch_is_unchanged():
    """Making that branch directional would ADD a blocker -- explicitly out of scope."""
    fn = fn_body(EA, "ENUM_XAU_TIMING_STATE XAU_BucketTiming(", 2000)
    assert ("if(td.lifecycle == OPPOSITE_DIRECTION_CONFIRMED && td.oppositeReclaim && td.oppositeRetestHeld)\n"
            "      return TIMING_READY;") in fn


def _bucket_timing(td, candidate_direction=0):
    """Faithful Python mirror of the fixed XAU_BucketTiming."""
    reversal_applies = (candidate_direction == 0
                        or td["dominantDirection"] == 0
                        or candidate_direction != td["dominantDirection"])
    if td["lifecycle"] == "OPPOSITE_DIRECTION_CONFIRMED" and td["oppositeReclaim"] and td["oppositeRetestHeld"]:
        return "TIMING_READY"
    if reversal_applies and td["reversalWaitForPullback"]:
        return "TIMING_WAIT_PULLBACK"
    if reversal_applies and td["oppositeDisplacement"] and not td["oppositeReclaim"]:
        return "TIMING_WAIT_RECLAIM"
    if td["moveAlreadyConsumedPct"] >= 90.0:
        return "TIMING_LATE"
    if td["continuationEntryPaused"]:
        return "TIMING_WAIT_CONFIRMATION"
    if td["continuationEntryAllowed"]:
        return "TIMING_READY"
    return "TIMING_WAIT_CONFIRMATION"


# Reconstructed from DIRECTION_TRANSITION_STATE at 2026-09-04 09:52:36.440:
#   "signal=BUY state=DIRECTION_MATURE dominant=BUY ... oppositeEntryAllowed=N
#    oppositeConfirmedNow=N ... action=CONTINUE_CURRENT_DIRECTION"
LIVE_0904_0952 = {
    "lifecycle": "TREND_MATURE",
    "dominantDirection": 1,          # dominant=BUY
    "reversalWaitForPullback": True, # the reversal-side field that produced the block
    "oppositeReclaim": False,
    "oppositeRetestHeld": False,
    "oppositeDisplacement": False,
    "moveAlreadyConsumedPct": 55.0,
    "continuationEntryPaused": False,
    "continuationEntryAllowed": True,
}


def test_live_0904_dominant_side_buy_no_longer_waits_for_the_reversals_pullback():
    # ASIA_BREAKOUT BUY A+ 7.57, continuation=Y votes=7 fastOpp=0, M5+M15 SUPPORTIVE.
    assert _bucket_timing(LIVE_0904_0952, candidate_direction=1) == "TIMING_READY"


def test_a_genuine_reversal_side_candidate_still_waits():
    assert _bucket_timing(LIVE_0904_0952, candidate_direction=-1) == "TIMING_WAIT_PULLBACK"


def test_direction_unknown_keeps_the_pre_fix_answer():
    assert _bucket_timing(LIVE_0904_0952, candidate_direction=0) == "TIMING_WAIT_PULLBACK"


def test_fix_does_not_blanket_approve_the_dominant_side():
    paused = dict(LIVE_0904_0952, continuationEntryPaused=True, continuationEntryAllowed=False)
    assert _bucket_timing(paused, candidate_direction=1) == "TIMING_WAIT_CONFIRMATION"
    late = dict(LIVE_0904_0952, moveAlreadyConsumedPct=95.0)
    assert _bucket_timing(late, candidate_direction=1) == "TIMING_LATE"


# ===========================================================================
# FIX 2 -- the v6.28.5 exhaustion dormancy decay was provably inert
# ===========================================================================
def test_dormancy_gap_lowered_and_step_made_convergent():
    assert "#define XAU_EXHAUSTION_DORMANCY_GAP            4.0" in EA
    assert "#define XAU_EXHAUSTION_DORMANCY_BARS_REQUIRED 6" in EA, "the 1-hour sustain requirement must NOT be relaxed"
    assert "#define XAU_EXHAUSTION_DORMANCY_DECAY_STEP    5.0" in EA
    assert "double dormancyStep=MathMax(XAU_EXHAUSTION_DORMANCY_DECAY_STEP,\n" in EA
    assert "(g_transitionPersistentExhaustion-rawExhaustion)*0.5);" in EA


def test_ratchet_up_and_direction_flip_branches_untouched():
    i = EA.index("   bool realContinuationReset = freshProgress")
    fn = EA[i:i + 3000]
    assert "if(g_transitionPersistentDirection!=dir)" in fn
    assert "else if(rawExhaustion>=g_transitionPersistentExhaustion)" in fn
    assert "else if(realContinuationReset)" in fn


def _ratchet(raw_series, start, gap, bars, step, convergent):
    R, dorm, decays = start, 0, 0
    for raw in raw_series:
        if raw >= R:
            R, dorm = raw, 0
        elif (R - raw) >= gap:
            dorm += 1
            if dorm >= bars:
                d = max(step, (R - raw) * 0.5) if convergent else step
                R = max(raw, R - d)
                dorm = 0
                decays += 1
        else:
            dorm = 0
    return R, decays


OLD = dict(gap=15.0, bars=6, step=5.0, convergent=False)
NEW = dict(gap=4.0, bars=6, step=5.0, convergent=True)

# Verbatim rawScore readings, VPS 20260904.log, direction=SELL, 21:50->22:30,
# running v6.28.5 (each line printed "finalPct=78.65 dormantBars=0/6").
LIVE_RAW_0904 = [75.10, 77.10, 71.35, 69.79, 66.86]


def test_old_config_was_inert_on_the_real_production_series():
    R, decays = _ratchet(LIVE_RAW_0904, 78.65, **OLD)
    assert decays == 0
    assert R == 78.65  # matches the frozen finalPct in every one of those log lines


def test_old_config_asymptotes_and_can_never_track_a_dead_trend():
    # ratchet 82.16, raw held at 63.0 for ten hours
    R, decays = _ratchet([63.0] * 60, 82.16, **OLD)
    assert decays == 1
    assert round(R, 2) == 77.16
    assert R >= 60.0, "still EXHAUSTION_HIGH -- the v6.28.5 fix could not restore eligibility"


def test_new_config_converges_on_a_genuinely_dead_trend():
    R, decays = _ratchet([63.0] * 60, 82.16, **NEW)
    assert R == 63.0 and decays >= 3


def test_new_config_releases_below_exhaustion_high_within_two_hours():
    # peak 86 then raw 45 sustained
    for bars in range(1, 25):
        R, _ = _ratchet([86.0] + [45.0] * bars, 0.0, **NEW)
        if R < 60.0:
            assert bars <= 12, "must release within ~2h of genuinely sustained dormancy"
            break
    else:
        raise AssertionError("new config never dropped below EXHAUSTION_HIGH")
    R_old, _ = _ratchet([86.0] + [45.0] * 24, 0.0, **OLD)
    assert R_old >= 60.0, "old config never released -- this is the regression being fixed"


def test_20260714_protection_preserved_single_cool_bar_forgets_nothing():
    """The incident the ratchet exists for: 86% -> forgotten -> SELL again."""
    R, decays = _ratchet([86.0, 60.0], 0.0, **NEW)
    assert decays == 0 and R == 86.0


def test_20260714_protection_preserved_five_cool_bars_still_forget_nothing():
    R, decays = _ratchet([86.0] + [62.0] * 5, 0.0, **NEW)
    assert decays == 0 and R == 86.0


def test_respike_ratchets_straight_back_up():
    R, _ = _ratchet([86.0, 60.0, 88.0, 90.0], 0.0, **NEW)
    assert R == 90.0


def test_new_config_is_not_trigger_happy_on_the_real_five_bar_window():
    R, decays = _ratchet(LIVE_RAW_0904, 78.65, **NEW)
    assert decays == 0, "5 bars is less than the 6-bar sustain window -- must not decay yet"


# ===========================================================================
# FIX 3 -- structural SL nearest-pivot-only dead end
# ===========================================================================
def test_structural_sl_walks_outward_instead_of_giving_up():
    fn = fn_body(EA, "void XAU_ComputeStructuralSL(", 6000)
    assert "XAU_STRUCTURAL_SL_MAX_PIVOTS" in fn
    assert "TOO_TIGHT_TRYING_NEXT_PIVOT" in fn
    assert "STRUCTURAL_SL_PIVOT_FALLBACK_USED" in fn


def test_structural_sl_sanity_bound_is_unchanged():
    fn = fn_body(EA, "void XAU_ComputeStructuralSL(", 6000)
    assert "double lo = atrFloorDist * 0.5;" in fn
    assert "double hi = atrFloorDist * 4.0;" in fn
    assert "if(dist < lo || dist > hi)" in fn


def test_atr_only_fallback_remains_prohibited_and_entry_still_fails_closed():
    fn = fn_body(EA, "void XAU_ComputeStructuralSL(", 6000)
    assert "STRUCTURAL_SL_NO_QUALIFYING_PIVOT" in fn
    # OpenTrade's hard refusal is untouched.
    assert 'string structuralBlock = !InpUseStructuralSL' in EA
    assert '"NO_VALID_CLOSED_M10_SWING_INVALIDATION"' in EA
    assert 'g_lastOpenTradeFailureReason="STRUCTURAL_SL_BLOCK:"+structuralBlock;' in EA


def _pick_pivot(pivots, entry, buffer, atr_floor, signal, max_pivots=4):
    """Mirror of the fixed selection: first CONFIRMED pivot inside [0.5x,4x]."""
    lo, hi = atr_floor * 0.5, atr_floor * 4.0
    checked = 0
    for lvl in pivots:
        if signal == 1 and lvl >= entry:
            continue
        if signal == -1 and lvl <= entry:
            continue
        checked += 1
        if checked > max_pivots:
            break
        dist = ((entry - lvl) if signal == 1 else (lvl - entry)) + buffer
        if lo <= dist <= hi:
            return lvl, dist
    return None, None


def test_live_20260904_1852_case_now_finds_a_stop_instead_of_refusing():
    # STRUCTURAL_SL_BLOCK | signal=BUY rawLevel=0.00 buffer=1.54 atrFloorDist=25.65
    entry, buffer, atr_floor = 4437.775, 1.54, 25.65
    nearest_too_tight = 4430.0            # dist 9.31 < lo(12.825) -> old code refused here
    genuine_swing_low = 4405.0            # dist 34.31, inside [12.825, 102.6]
    assert _pick_pivot([nearest_too_tight], entry, buffer, atr_floor, 1) == (None, None)
    lvl, dist = _pick_pivot([nearest_too_tight, genuine_swing_low], entry, buffer, atr_floor, 1)
    assert lvl == genuine_swing_low and 12.825 <= dist <= 102.6


def test_no_qualifying_pivot_still_refuses_the_entry():
    entry, buffer, atr_floor = 4437.775, 1.54, 25.65
    assert _pick_pivot([4435.0, 4434.0, 4433.0, 4432.0], entry, buffer, atr_floor, 1) == (None, None)


# ===========================================================================
# FIX 4 -- OUTLOOK_ALIGNED cross-lane identity leak into the owner gate
# ===========================================================================
def test_outlook_lane_publishes_its_own_identity_before_opentrade():
    fn = fn_body(EA, "void XAU_EvaluateOutlookAlignedEntry()", 14000)
    assert 'lastSignalSetup          = "OUTLOOK_ALIGNED";' in fn
    assert "g_pendingBrainGrade      = outlookGrade;" in fn
    assert "OUTLOOK_ALIGNED_IDENTITY" in fn
    # identity must be published BEFORE the OpenTrade call in that function
    assert fn.index('lastSignalSetup          = "OUTLOOK_ALIGNED";') < fn.index("bool opened = (explicitSL > 0.0)")


def test_outlook_grade_uses_the_shared_engine_not_a_new_one():
    fn = fn_body(EA, "void XAU_EvaluateOutlookAlignedEntry()", 14000)
    assert "XAU_CanonicalM10SetupScore(" in fn
    assert "XAU_ComputeCombinedGradeForCandidate(dir, \"OUTLOOK_ALIGNED\"," in fn


def test_outlook_lane_must_not_call_detectregime():
    """DetectRegime() mutates currentRegime and reads buffers this lane runs before."""
    fn = strip_comments(fn_body(EA, "void XAU_EvaluateOutlookAlignedEntry()", 14000))
    assert "DetectRegime()" not in fn
    assert "double outlookRegimeQuality  = g_lastRegimeQuality;" in fn


def test_regime_quality_cache_is_published_by_the_completed_scan():
    assert "double   g_lastRegimeQuality = 0.0;" in EA
    assert "g_lastRegimeQuality = regimeQuality;" in EA


def test_outlook_grade_fails_closed_before_any_completed_scan():
    fn = fn_body(EA, "void XAU_EvaluateOutlookAlignedEntry()", 14000)
    assert 'string outlookGrade = "SKIP";' in fn
    assert "if(outlookRegimeQuality > 0.0)" in fn


# ===========================================================================
# FIX 5 -- untraceable EA closes ("PROFIT_CLOSE | EA_MARKET_CLOSE")
# ===========================================================================
def test_close_authority_attributes_every_accepted_close():
    fn = fn_body(EA, "bool OWNER_R_EXIT_CLOSE_ONLY(", 9000)
    assert "XAU_SetPendingExitReason(exitPosId, \"EA_EXIT_AUTHORITY:\" + ctx);" in fn
    assert "EXIT_REASON_ATTRIBUTED" in fn


def test_attribution_never_overwrites_a_richer_call_site_reason():
    fn = fn_body(EA, "bool OWNER_R_EXIT_CLOSE_ONLY(", 9000)
    assert "if(!XAU_HasPendingExitReason(exitPosId) && StringLen(ctx) > 0)" in fn
    assert "bool XAU_HasPendingExitReason(ulong posId)" in EA


def test_attribution_only_after_the_broker_accepted_the_close():
    """A rejected close must not leave a stale attribution behind."""
    fn = fn_body(EA, "bool OWNER_R_EXIT_CLOSE_ONLY(", 9000)
    assert fn.index("bool ok = trade.PositionClose(ticket);") < fn.index("XAU_SetPendingExitReason(exitPosId,")
    assert fn.index('OWNER_R_EXIT_CLOSE_FAILED') < fn.index("XAU_SetPendingExitReason(exitPosId,")


def test_close_decision_logic_is_untouched_by_the_attribution_fix():
    fn = fn_body(EA, "bool OWNER_R_EXIT_CLOSE_ONLY(", 9000)
    assert "if(!externalManual && !initialStopIntegrity && !XAU_OwnerProtectedFloorAllowsClose(ticket, ctx))" in fn
    assert "if(g_lastRejectedCloseTicket == ticket && TimeCurrent() - g_lastRejectedCloseAt < 60)" in fn


# ===========================================================================
# FIX 6 -- the last unsanctioned OpenTrade path + a permanently latched flag
# ===========================================================================
def test_exactly_six_opentrade_call_sites_all_accounted_for():
    import re
    sites = [m.start() for m in re.finditer(r"OpenTrade\((?:dir|signal)[,\s]", EA)]
    assert len(sites) == 6, f"unexpected OpenTrade call-site count: {len(sites)}"


def test_legacy_outlook_recovery_can_no_longer_send_an_order():
    fn = strip_comments(fn_body(EA, "bool XAU_ProcessOutlookRecovery()", 7000))
    assert "OpenTrade(" not in fn
    assert "LEGACY_OUTLOOK_RECOVERY_EXECUTION_PERMANENTLY_RETIRED" in fn


def test_legacy_pending_outlook_state_is_consumed_at_startup_not_latched():
    assert "if(g_pendingOutlook.active) XAU_ProcessPendingOutlook();" in EA


# ===========================================================================
# Standing invariants the audit had to re-prove (not changed by this release)
# ===========================================================================
def test_outlook_is_read_nowhere_in_the_primary_pipeline():
    """PRIMARY/RE_ENTRY/PYRAMID must be provably independent of the Outlook thesis.

    Asserted directly against the function bodies that decide a normal entry,
    rather than against line-number ranges -- an ordinary edit elsewhere in the
    file must never be able to make this pass or fail spuriously.
    """
    decision_fns = [
        "void OnTick()",
        "bool CheckReEntryOpportunity()",
        "void CheckPyramidOpportunity()",
        "bool XAU_TimingAuthorityAllows(",
        "bool XAU_FinalEntryArbiter(",
        "ENUM_XAU_SMART_ENTRY_CAUTION_DECISION XAU_SmartEntryCautionGate(\n   int signal",
        "XAU_MarketThesis XAU_ComputeMarketThesis(",
        "bool XAU_OwnerEntryPermission(",
        "bool XAU_StructureAuthorityAllows(",
        "bool XAU_FreshnessExtensionAuthority(",
        "bool XAU_NewsAuthorityAllows(",
        "bool OpenTrade(int signal",
    ]
    offenders = []
    for sig in decision_fns:
        body = strip_comments(fn_body(EA, sig))
        if "g_outlookThesis" in body:
            offenders.append(sig.split("(")[0])
    assert not offenders, f"Outlook thesis read inside normal-entry decision code: {offenders}"


def test_outlook_thesis_is_only_touched_by_its_own_lane():
    """Every real read/write of g_outlookThesis lives in the fetch helper, the
    freshness helper, the OUTLOOK_ALIGNED lane, or the struct's own declaration."""
    allowed_spans = []
    for sig in ("void XAU_FetchOutlookThesis()",
                "bool XAU_OutlookThesisFresh()",
                "void XAU_EvaluateOutlookAlignedEntry()"):
        body = fn_body(EA, sig)
        st = EA.index(body)
        allowed_spans.append((st, st + len(body)))
    struct_start = EA.index("struct XAU_OutlookThesis")
    decl_end = EA.index("\n", EA.index("XAU_OutlookThesis g_outlookThesis"))
    allowed_spans.append((struct_start, decl_end))

    # Fourth legitimate writer: the rewritten OUTLOOK_SIGNAL_OPEN cloud-command
    # handler. Since v6.28.3 it only PUBLISHES the thesis as passive context and
    # acks OUTLOOK_CONTEXT_ONLY_NOT_AUTO_EXECUTED -- it no longer arms the
    # legacy auto-fire timer. test_outlook_signal_open_command_is_context_only
    # below proves that branch cannot execute or arm anything.
    cmd_start = EA.index('else if(action == "OUTLOOK_SIGNAL_OPEN")')
    cmd_end = EA.index("BotMonitorAckCommand(commandId, status, result);", cmd_start)
    allowed_spans.append((cmd_start, cmd_end))

    stray, offset = [], 0
    for line in EA.splitlines(keepends=True):
        if "g_outlookThesis" in line and not line.strip().startswith("//"):
            col = line.index("g_outlookThesis")
            if not any(a <= offset + col < b for a, b in allowed_spans):
                stray.append(line.strip()[:110])
        offset += len(line)
    assert not stray, f"g_outlookThesis touched outside its own lane: {stray[:5]}"


def test_outlook_signal_open_command_is_context_only():
    """The cloud command that used to arm the legacy auto-fire must now do
    nothing but publish thesis context."""
    start = EA.index('else if(action == "OUTLOOK_SIGNAL_OPEN")')
    end = EA.index("BotMonitorAckCommand(commandId, status, result);", start)
    branch = strip_comments(EA[start:end])
    assert "OpenTrade(" not in branch
    assert "XAU_TryManualOpenNow" not in branch
    assert "XAU_TryForceOpenTrade" not in branch
    assert "g_pendingOutlook.active" not in branch, "must not re-arm the retired auto-fire state"
    assert "XAU_ArmOutlookRecovery" not in branch
    assert "OUTLOOK_CONTEXT_ONLY_NOT_AUTO_EXECUTED" in EA[start:end]


def test_primary_reaches_opentrade_only_through_timing_then_arbiter():
    ontick = fn_body(EA, "void OnTick()", 120000)
    t = ontick.index("XAU_TimingAuthorityAllows(signal, setupName")
    a = ontick.index('XAU_FinalEntryArbiter("PRIMARY"')
    o = ontick.index("bool tradeOpened = OpenTrade(signal,")
    assert t < a < o


def test_reentry_reaches_opentrade_only_through_timing_then_arbiter():
    fn = fn_body(EA, "bool CheckReEntryOpportunity()", 22000)
    t = fn.index('XAU_TimingAuthorityAllows(dir,"RE_ENTRY"')
    a = fn.index('XAU_FinalEntryArbiter("RE_ENTRY"')
    o = fn.index("bool opened=OpenTrade(dir,bufATR[1]")
    assert t < a < o


def test_outlook_aligned_reaches_opentrade_only_through_timing_then_arbiter():
    fn = fn_body(EA, "void XAU_EvaluateOutlookAlignedEntry()", 14000)
    t = fn.index('if(!XAU_TimingAuthorityAllows(dir, "OUTLOOK_ALIGNED"')
    a = fn.index('XAU_FinalEntryArbiter("OUTLOOK_ALIGNED"')
    o = fn.index("bool opened = (explicitSL > 0.0)")
    assert t < a < o


def test_final_entry_arbiter_does_not_read_the_exhaustion_ratchet_as_a_veto():
    fn = fn_body(EA, "bool XAU_FinalEntryArbiter(", 5000)
    aligned = fn[fn.index("bool aligned ="): fn.index("string locationName")]
    assert "exhaustion" not in aligned.lower()


def test_no_valid_outlook_and_informational_are_never_compared_against():
    """They may appear inside log strings, but must never be a branch condition
    -- i.e. Outlook state names must not gate anything in the EA."""
    import re
    bad = []
    for n, line in enumerate(EA.splitlines(), 1):
        stripped = line.strip()
        if stripped.startswith("//"):
            continue
        for token in ("NO_VALID_OUTLOOK", "INFORMATIONAL"):
            if token not in line:
                continue
            # strip out string literals, then see if the token still survives
            no_strings = re.sub(r'"(?:[^"\\]|\\.)*"', '""', line)
            if token in no_strings:
                bad.append((n, stripped[:120]))
    assert not bad, f"Outlook state token used outside a log string: {bad}"


def test_trade_brain_is_advisory_only_and_cannot_veto():
    body = strip_comments(fn_body(EA, "bool XAU_TradeBrainPreEntry(", 4000))
    assert "return false" not in body, "TradeBrain must have no veto path"
    assert "XAU_TRADEBRAIN_SEED_ACTIVE_BLOCK_COUNT 0" in EA


def test_weekend_reopen_still_clears_the_exhaustion_ratchet():
    fn = fn_body(EA, "void XAU_LogRuntimePureM10Gap(", 4000)
    assert "g_transitionPersistentExhaustion=0.0;" in fn
    assert "g_transitionExhaustionDormantBars=0;" in fn
    assert "WEEKEND_REOPEN" in fn
