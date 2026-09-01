"""v6.24.16 — critical audit fixes to the v6.24.15 Entry Readiness Engine.

A 4-agent independent audit (different models, different focus areas) found
three stacking, severe defects in v6.24.15 that would have blocked most
legitimate entries in live trading (this version was already deployed to
the owner's Mac and VPS at the time these were found):

1. `XAU_ClassifyOldDirectionState(-direction, td)` was reused to answer "is
   the opposite side still active" -- but that function's HEALTHY/MATURE
   verdicts mean "this direction's OWN fresh entry is/isn't currently
   valid," not "the opposite side is actively fighting me." In a clean
   uptrend, SELL's freshAllowed is correctly false (no fresh SELL setup
   exists), which made the old call return MATURE -- misread as "old side
   still active," permanently blocking ordinary with-trend BUY
   continuations. Fixed with a new, correctly-scoped
   `XAU_OppositeSideStatus()` that checks the opposite direction's actual
   open `g_campaign[]` state.

2. `entryReady` required `passedThroughWaitState` (any non-CONFIRMED state
   observed at some point) -- but `XAU_UpdateEntryReadiness` only ever runs
   from inside `OpenTrade()`, itself only reached after score/grade and
   every other authority gate ALREADY approved the candidate. A genuinely
   good setup could compute straight to CONFIRMED on its very first
   evaluation and stay CONFIRMED forever after, meaning the flag could
   never become true and `entryReady` could never fire. Fixed: the real
   gate is now "not literally the first observation of this candidate"
   (`candidateAlreadyExisted`, derived from the SAME `freshOrigin` value
   already computed each call), independent of what state it showed.

3. Candidate identity reused `g_latestDecisionSnapshot.signature`
   (bucketed RSI/Stoch/momentum, by design, for ITS OWN pattern-matching
   purpose) -- which can flip exactly at the wait-to-confirm transition,
   silently discarding real progress at the worst possible moment. Fixed
   with a deliberately coarser, locally-computed fingerprint
   (regime|setup|direction).

Also fixed (found by a separate audit agent): `g_postClose` was a single
global overwritten by whichever direction closed most recently, so a close
of the OPPOSITE direction could silently wipe an exhausted direction's own
re-entry-ban memory -- now `g_postClose[2]`, per-direction. And
`g_campaign[]` had no OnInit restart reconciliation, so a live redeploy (or
any restart) with a position open produced zero cooldown/exhaustion
tracking when that position eventually closed for real, and could let a
duplicate same-direction position open while the untracked one was still
live -- fixed with `XAU_ReconcileCampaignOnInit()`, same pattern as the
pre-existing `XAU_ReconcileRExitOnInit`/`XAU_ReconcileTradeBrainOnInit`.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.24.16.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"
COMPILE_LOG = ROOT / "compile_logs" / "v62416_audit_fixes_compile.log"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def read_log(path: Path) -> str:
    raw = path.read_bytes()
    try:
        return raw.decode("utf-16le")
    except UnicodeDecodeError:
        return raw.decode("utf-8", errors="ignore")


def test_repo_source_is_synced_to_backend():
    assert read(EA) == read(BACKEND_EA)


def test_version_bumped_to_v62416():
    ea = read(BACKEND_EA)
    assert '#define XAUAI_EA_VERSION "v6.24.16"' in ea


def test_compile_clean():
    log = read_log(COMPILE_LOG)
    assert "Result: 0 errors, 0 warnings" in log


# ---------------------------------------------------------------------------
# Bug 1: opposite-side status must NOT misread "not currently fresh-allowed"
# as "old side active"
# ---------------------------------------------------------------------------

def test_opposite_side_status_function_exists_and_is_used_in_readiness():
    ea = read(BACKEND_EA)
    assert "ENUM_XAU_OLD_DIRECTION_STATE XAU_OppositeSideStatus(" in ea
    fn = ea[ea.index("XAU_EntryReadinessDecision XAU_UpdateEntryReadiness("):][:1200]
    assert "XAU_OppositeSideStatus(direction, td)" in fn
    # the old, semantically-wrong call must be gone as an ACTUAL call -- the
    # surrounding comment legitimately quotes the old buggy pattern for
    # documentation, so check for the real assignment statement specifically,
    # not a bare substring match against the explanatory comment.
    assert "oldSide = XAU_ClassifyOldDirectionState(-direction, td);" not in fn


def test_opposite_side_status_checks_real_open_campaign_not_fresh_allowed():
    ea = read(BACKEND_EA)
    fn = ea[ea.index("ENUM_XAU_OLD_DIRECTION_STATE XAU_OppositeSideStatus("):]
    fn_body = fn[:fn.index("\n}\n") + 3]
    assert "g_campaign[oppositeSlot].active" in fn_body
    # must NOT read freshBuyAllowed/freshSellAllowed -- that was the bug
    assert "freshBuyAllowed" not in fn_body
    assert "freshSellAllowed" not in fn_body


def test_no_active_opposite_campaign_returns_invalidated_not_active():
    # pure-with-trend case: no live opposing position -> old side must be
    # reported as finished/not-a-factor, not "active"
    ea = read(BACKEND_EA)
    fn = ea[ea.index("ENUM_XAU_OLD_DIRECTION_STATE XAU_OppositeSideStatus("):][:1400]
    assert "return OLD_DIRECTION_INVALIDATED;" in fn
    idx_check = fn.index("if(!oppositeCampaignActive)")
    idx_return = fn.index("return OLD_DIRECTION_INVALIDATED;")
    assert idx_check < idx_return


# ---------------------------------------------------------------------------
# Bug 2: entryReady must not require passedThroughWaitState (unsatisfiable
# for a candidate confirmed on its first-ever evaluation)
# ---------------------------------------------------------------------------

def test_entryready_gate_uses_candidate_already_existed_not_wait_flag():
    ea = read(BACKEND_EA)
    fn = ea[ea.index("XAU_EntryReadinessDecision XAU_UpdateEntryReadiness("):][:7500]
    assert "candidateAlreadyExisted" in fn
    ready_idx = fn.index("bool candidateReady = g_readiness[slot].active &&")
    ready_block = fn[ready_idx:ready_idx + 300]
    assert "candidateAlreadyExisted" in ready_block
    assert "passedThroughWaitState" not in ready_block


def test_candidate_already_existed_computed_before_state_mutation():
    # must be captured from the SAME freshOrigin used to decide whether to
    # re-initialize the candidate, before that re-initialization runs --
    # otherwise it would always read the POST-reset (freshly active) value
    ea = read(BACKEND_EA)
    fn = ea[ea.index("XAU_EntryReadinessDecision XAU_UpdateEntryReadiness("):][:6000]
    capture_idx = fn.index("bool candidateAlreadyExisted = g_readiness[slot].active && !freshOrigin;")
    reinit_idx = fn.index("if(freshOrigin)\n      {\n         g_readiness[slot].active = true;")
    assert capture_idx < reinit_idx


# ---------------------------------------------------------------------------
# Bug 3: candidate identity must be coarser than the fine-grained
# BuildSignature-based fingerprint
# ---------------------------------------------------------------------------

def test_candidate_fingerprint_no_longer_uses_decision_snapshot_signature():
    ea = read(BACKEND_EA)
    fn = ea[ea.index("XAU_EntryReadinessDecision XAU_UpdateEntryReadiness("):][:2500]
    assert 'g_latestDecisionSnapshot.signature' not in fn
    assert 'StringFormat("%s|%s|%d", RegimeName()' in fn


def test_candidate_has_one_hour_age_safety_valve():
    ea = read(BACKEND_EA)
    fn = ea[ea.index("XAU_EntryReadinessDecision XAU_UpdateEntryReadiness("):][:2500]
    assert "TimeCurrent() - g_readiness[slot].originTime > 3600" in fn


def test_invalidated_candidate_clears_state_and_id_not_just_active_flag():
    # regression guard for the stale-display finding: on invalidation the
    # display-visible .state/.candidateId must be cleared too, not just
    # .active, or the Command Center shows a self-contradictory picture
    # (dead candidate id + old live state + finalAction=NO_VALID_TRADE)
    ea = read(BACKEND_EA)
    fn = ea[ea.index("XAU_EntryReadinessDecision XAU_UpdateEntryReadiness("):][:4700]
    block = fn[fn.index("if(mapped == READINESS_INVALIDATED || roomCollapsed)"):]
    block = block[:block.index("else\n   {")]
    assert 'g_readiness[slot].state = roomCollapsed ? READINESS_EXPIRED : READINESS_INVALIDATED;' in block
    assert 'g_readiness[slot].candidateId = "";' in block


# ---------------------------------------------------------------------------
# g_postClose[2] per-direction isolation
# ---------------------------------------------------------------------------

def test_post_close_is_now_a_two_slot_array():
    ea = read(BACKEND_EA)
    assert "XAU_PostCloseState g_postClose[2];" in ea
    assert "XAU_PostCloseState g_postClose;\n" not in ea  # old single-global declaration must be gone


def test_no_bare_g_postclose_dot_references_remain():
    # every access must be g_postClose[slot].field, never g_postClose.field
    import re
    ea = read(BACKEND_EA)
    bare = re.findall(r'g_postClose\.\w', ea)
    assert bare == [], f"found bare g_postClose.field references (should be g_postClose[slot].field): {bare}"


def test_classify_old_direction_state_reads_own_direction_slot():
    ea = read(BACKEND_EA)
    fn = ea[ea.index("ENUM_XAU_OLD_DIRECTION_STATE XAU_ClassifyOldDirectionState("):][:900]
    assert "int slot = XAU_CampaignSlot(direction);" in fn
    assert "g_postClose[slot].valid" in fn


def test_cooldown_active_checks_both_slots():
    ea = read(BACKEND_EA)
    fn = ea[ea.index("bool XAU_PostTradeCooldownActive()"):][:400]
    assert "for(int s = 0; s < 2; s++)" in fn


def test_cooldown_tick_iterates_both_slots_independently():
    ea = read(BACKEND_EA)
    fn = ea[ea.index("void XAU_PostTradeCooldownTick()"):][:1400]
    assert "for(int s = 0; s < 2; s++)" in fn
    assert "g_postClose[s].valid" in fn


def test_onclose_write_targets_the_closing_directions_own_slot():
    ea = read(BACKEND_EA)
    assert "g_postClose[closeSlot].valid                         = true;" in ea


def test_display_blocks_use_most_recent_slot_helper():
    ea = read(BACKEND_EA)
    assert "int XAU_MostRecentPostCloseSlot()" in ea
    assert "int pcSlot = XAU_MostRecentPostCloseSlot();" in ea


# ---------------------------------------------------------------------------
# g_campaign[] restart reconciliation
# ---------------------------------------------------------------------------

def test_campaign_reconcile_on_init_exists_and_is_called():
    ea = read(BACKEND_EA)
    assert "void XAU_ReconcileCampaignOnInit()" in ea
    assert "XAU_ReconcileCampaignOnInit();" in ea
    # must be called from OnInit, alongside the pre-existing reconciliation calls
    init_fn = ea[ea.index("int OnInit()"):]
    init_body = init_fn[:init_fn.index("void OnDeinit")]
    assert "XAU_ReconcileCampaignOnInit();" in init_body
    assert "XAU_ReconcileTradeBrainOnInit();" in init_body


def test_campaign_reconcile_does_not_clobber_already_tracked_campaign():
    ea = read(BACKEND_EA)
    fn = ea[ea.index("void XAU_ReconcileCampaignOnInit()"):][:1800]
    assert "if(g_campaign[slot].active) continue;" in fn


def test_campaign_reconcile_scans_live_positions_by_magic_and_symbol():
    ea = read(BACKEND_EA)
    fn = ea[ea.index("void XAU_ReconcileCampaignOnInit()"):][:900]
    assert "posInfo.Magic() != InpMagicNumber" in fn
    assert "posInfo.Symbol() != Symbol()" in fn


# ---------------------------------------------------------------------------
# Behavioral: with-trend continuation is no longer blocked
# ---------------------------------------------------------------------------

def classify_old_direction_state_mirror(existing_action, fresh_allowed, lifecycle,
                                         dominant_direction, direction, prior_exhaustion):
    if existing_action == "TRANSITION_EXIT_CONTROLLED" or (
        lifecycle == "OPPOSITE_DIRECTION_CONFIRMED" and dominant_direction != 0 and dominant_direction != direction
    ):
        return "OLD_DIRECTION_INVALIDATED"
    if existing_action in ("TRANSITION_STOP_ADDS", "TRANSITION_TIGHTEN_PROTECTION", "TRANSITION_EXIT_PROFITABLE") \
       or not fresh_allowed:
        if prior_exhaustion:
            return "OLD_DIRECTION_EXHAUSTED"
        return "OLD_DIRECTION_RESETTING" if lifecycle == "TRANSITION_NEUTRAL" else "OLD_DIRECTION_MATURE"
    if prior_exhaustion:
        return "OLD_DIRECTION_RESET_CONFIRMED"
    return "OLD_DIRECTION_MATURE" if lifecycle == "TREND_MATURE" else "OLD_DIRECTION_HEALTHY"


def opposite_side_status_mirror(opposite_campaign_active, opposite_campaign_invalidated,
                                opposite_action, opposite_recently_exhausted_close):
    """Mirrors the NEW XAU_OppositeSideStatus, not the misused old call."""
    if not (opposite_campaign_active and not opposite_campaign_invalidated):
        if opposite_recently_exhausted_close:
            return "OLD_DIRECTION_RESET_CONFIRMED"
        return "OLD_DIRECTION_INVALIDATED"
    if opposite_action in ("TRANSITION_STOP_ADDS", "TRANSITION_TIGHTEN_PROTECTION",
                           "TRANSITION_EXIT_PROFITABLE", "TRANSITION_EXIT_CONTROLLED"):
        return "OLD_DIRECTION_EXHAUSTED"
    return "OLD_DIRECTION_HEALTHY"


def test_bug_reproduction_old_classify_old_direction_state_would_block_uptrend_buy():
    # demonstrates the ORIGINAL v6.24.15 bug: in a clean uptrend, calling
    # the (wrong) function with the opposite direction returns MATURE,
    # which the old readiness mapping treated as "old side active" (block).
    old_wrong_result = classify_old_direction_state_mirror(
        existing_action="TRANSITION_HOLD", fresh_allowed=False, lifecycle="TREND_HEALTHY",
        dominant_direction=1, direction=-1, prior_exhaustion=False)
    assert old_wrong_result == "OLD_DIRECTION_MATURE"  # this is what caused the false block


def test_fix_new_opposite_side_status_allows_uptrend_buy_with_no_opposite_campaign():
    # the FIX: same clean uptrend, no live SELL campaign at all -> correctly
    # reports the old side as finished/not-a-factor, not active.
    new_correct_result = opposite_side_status_mirror(
        opposite_campaign_active=False, opposite_campaign_invalidated=False,
        opposite_action="TRANSITION_HOLD", opposite_recently_exhausted_close=False)
    assert new_correct_result == "OLD_DIRECTION_INVALIDATED"


def test_fix_opposite_side_status_still_blocks_when_real_opposite_campaign_open():
    # genuine two-sided market: a real, healthy opposite campaign IS open ->
    # correctly reported as HEALTHY (active), still blocking
    new_result = opposite_side_status_mirror(
        opposite_campaign_active=True, opposite_campaign_invalidated=False,
        opposite_action="TRANSITION_HOLD", opposite_recently_exhausted_close=False)
    assert new_result == "OLD_DIRECTION_HEALTHY"


def test_fix_opposite_side_status_reports_exhausted_for_winding_down_opposite_campaign():
    new_result = opposite_side_status_mirror(
        opposite_campaign_active=True, opposite_campaign_invalidated=False,
        opposite_action="TRANSITION_STOP_ADDS", opposite_recently_exhausted_close=False)
    assert new_result == "OLD_DIRECTION_EXHAUSTED"


# ---------------------------------------------------------------------------
# Behavioral: entryReady can actually become true for a candidate that's
# CONFIRMED on every observation (the second critical bug)
# ---------------------------------------------------------------------------

def compute_entry_ready_old_broken(mapped_state, passed_through_wait_state, snapshot_fresh, active):
    return active and (mapped_state == "READINESS_CONFIRMED") and passed_through_wait_state and snapshot_fresh


def compute_entry_ready_fixed(mapped_state, candidate_already_existed, snapshot_fresh, active):
    return active and (mapped_state == "READINESS_CONFIRMED") and candidate_already_existed and snapshot_fresh


def test_bug_reproduction_old_gate_never_fires_for_always_confirmed_candidate():
    # a candidate that is CONFIRMED on bar N and CONFIRMED again on bar N+1
    # never sets passed_through_wait_state (only non-CONFIRMED reads did) ->
    # entryReady stuck false forever under the OLD logic.
    passed_through_wait_state = False  # never set true: every observation was CONFIRMED
    for _ in range(5):  # simulate 5 more observations, all still CONFIRMED
        ready = compute_entry_ready_old_broken("READINESS_CONFIRMED", passed_through_wait_state, True, True)
        assert ready is False


def test_fix_new_gate_fires_on_second_observation_of_always_confirmed_candidate():
    # bar N: first observation, candidateAlreadyExisted=False -> not ready
    ready_bar_n = compute_entry_ready_fixed("READINESS_CONFIRMED", False, True, True)
    assert ready_bar_n is False
    # bar N+1: SAME candidate observed again, candidateAlreadyExisted=True -> ready
    ready_bar_n1 = compute_entry_ready_fixed("READINESS_CONFIRMED", True, True, True)
    assert ready_bar_n1 is True
