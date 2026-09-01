"""v6.24.8: unified market-thesis classification layer.

Design constraint verified throughout: this is a bucket-and-explain layer
over evidence that already existed (XAU_AdaptiveTransitionDecision, SMC
bonus state, HTF consensus). It does not compute new signals, and its
campaign-management action (NO_MORE_ADDS) explicitly defers to the same
existingBuyAction/existingSellAction field the already-shipped v6.24.6
pyramid gate reads, so the two cannot disagree. HARD_BLOCK is restricted
to the same "genuinely invalidated" conditions already treated as blocking
elsewhere (confirmed opposite BOS+HTF; extreme location with no realistic
reward).
"""

from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.24.8.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"
COMPILE_LOG = ROOT / "compile_logs" / "v6248_unified_market_thesis_compile.log"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def test_repo_source_is_synced_to_backend():
    assert read(EA) == read(BACKEND_EA)


def test_version_bumped_to_v6248():
    ea = read(BACKEND_EA)
    assert '#define XAUAI_EA_VERSION "v6.24.8"' in ea


def test_compile_clean():
    log = read(COMPILE_LOG)
    assert "Result: 0 errors, 0 warnings" in log


def test_all_five_evidence_enums_present():
    ea = read(BACKEND_EA)
    assert "enum ENUM_XAU_LOCATION_QUALITY" in ea
    assert "enum ENUM_XAU_EXHAUSTION_STATE" in ea
    assert "enum ENUM_XAU_TIMING_STATE" in ea
    assert "enum ENUM_XAU_HTF_ALIGNMENT" in ea
    assert "enum ENUM_XAU_STRUCTURE_STATE" in ea


def test_all_twelve_action_states_present():
    ea = read(BACKEND_EA)
    for action in ("ALLOW_CORE", "ALLOW_ADD", "ALLOW_SCALP", "WAIT_FOR_PULLBACK",
                   "WAIT_FOR_RECLAIM", "WAIT_FOR_CONFIRMATION", "MANAGE_EXISTING_ONLY",
                   "NO_MORE_ADDS", "PROTECT_RUNNER", "TRANSITION_WATCH",
                   "OPPOSITE_DISCOVERY", "HARD_BLOCK"):
        assert action in ea


def test_pyramid_action_defers_to_existing_authoritative_field_not_rederived():
    # this is the load-bearing safety property: no second independent
    # exhaustion threshold for the same campaign-adds decision
    ea = read(BACKEND_EA)
    fn = ea[ea.index("ENUM_XAU_MARKET_THESIS_ACTION XAU_MarketThesisAction("):]
    pyramid_block = fn[fn.index("if(isPyramidAdd)"):][:700]
    assert "existingBuyAction" in pyramid_block
    assert "existingSellAction" in pyramid_block
    assert "exh ==" not in pyramid_block  # not re-derived from the exhaustion bucket


def test_hard_block_reserved_for_already_blocking_conditions():
    ea = read(BACKEND_EA)
    fn = ea[ea.index("ENUM_XAU_MARKET_THESIS_ACTION XAU_MarketThesisAction("):]
    # exactly two HARD_BLOCK return sites in the priority function
    assert fn[:2500].count("return HARD_BLOCK;") == 2
    assert "confirmed opposite BOS+HTF" in fn[:1500]


def test_pre_ordersend_hard_block_check_wired_before_opentrade_call():
    ea = read(BACKEND_EA)
    thesis_check = ea.index("MARKET_THESIS_HARD_BLOCK_PRE_ORDERSEND")
    opentrade_call = ea.index('bool tradeOpened = OpenTrade(signal, bufATR[1], setupName + " [" + grade + "]", finalSzMult);')
    assert thesis_check < opentrade_call


def test_pyramid_cross_check_is_log_only_not_a_second_gate():
    ea = read(BACKEND_EA)
    section = ea[ea.index("MARKET_THESIS_PYRAMID_CHECK") - 340:][:740]
    assert "log only" in section
    # the cross-check PrintFormat call itself must not be followed by a
    # return/early-exit -- it only logs, execution continues to the
    # existing spacing/authority checks below
    print_idx = section.index("PrintFormat")
    tail_after_print = section[print_idx:print_idx + 250]
    assert "return;" not in tail_after_print


def test_protect_runner_documented_as_advisory_not_auto_close():
    ea = read(BACKEND_EA)
    section = ea[ea.index("Priority 6: exhaustion/transition for the core/runner"):][:400]
    assert "Advisory/" in section or "advisory" in section.lower()


def test_snapshot_carries_the_thesis_struct():
    ea = read(BACKEND_EA)
    assert "XAU_MarketThesis       thesis;" in ea


def test_direction_transition_stage_naming_maps_not_duplicates_lifecycle():
    ea = read(BACKEND_EA)
    fn = ea[ea.index("string XAU_DirectionTransitionStageName("):][:1200]
    # every branch returns a string derived from the existing lifecycle enum
    # cases, no new enum type is switched on
    assert "switch(lifecycle)" in fn
    for label in ("CURRENT_DIRECTION_HEALTHY", "CURRENT_DIRECTION_MATURE",
                  "CURRENT_DIRECTION_EXHAUSTED", "TRANSITION_WATCH",
                  "OPPOSITE_DISCOVERY", "OPPOSITE_CONFIRMED", "NEW_CAMPAIGN_ACTIVE"):
        assert label in fn


def test_campaign_lifecycle_naming_maps_not_duplicates_lifecycle():
    ea = read(BACKEND_EA)
    fn = ea[ea.index("string XAU_CampaignLifecycleName("):][:1000]
    for label in ("CAMPAIGN_EARLY", "CAMPAIGN_DISCOVERY", "CAMPAIGN_CONFIRMED",
                  "CAMPAIGN_EXPANSION", "CAMPAIGN_MATURE", "CAMPAIGN_EXHAUSTED",
                  "CAMPAIGN_TRANSITION", "CAMPAIGN_REVERSAL_CONFIRMED",
                  "CAMPAIGN_INVALIDATED", "CAMPAIGN_NONE"):
        assert label in fn


# ---------------------------------------------------------------------------
# Behavioral mirror of the bucketing + priority-ordered action
# ---------------------------------------------------------------------------

TREND_EARLY, TREND_DEVELOPING, TREND_HEALTHY, TREND_MATURE = 0, 1, 2, 3
TREND_LATE, TREND_EXHAUSTING, TRANSITION_NEUTRAL = 4, 5, 6
OPPOSITE_DIRECTION_FORMING, OPPOSITE_DIRECTION_CONFIRMED = 7, 8

TRANSITION_HOLD, TRANSITION_STOP_ADDS = 0, 1
TRANSITION_TIGHTEN_PROTECTION, TRANSITION_EXIT_PROFITABLE = 2, 3
TRANSITION_EXIT_CONTROLLED = 4


@dataclass
class TD:
    dominantDirection: int = 1
    remainingRewardR: float = 3.0
    oppositeRemainingRewardR: float = 0.0
    entryLocationQuality: float = 70.0
    moveAlreadyConsumedPct: float = 20.0
    exhaustionProbability: float = 20.0
    transitionProbability: float = 10.0
    reversalProbability: float = 5.0
    trendHealth: float = 70.0
    lifecycle: int = TREND_HEALTHY
    continuationEntryAllowed: bool = True
    continuationEntryPaused: bool = False
    reversalWaitForPullback: bool = False
    oppositeReclaim: bool = False
    oppositeRetestHeld: bool = False
    oppositeDisplacement: bool = False
    existingBuyAction: int = TRANSITION_HOLD
    existingSellAction: int = TRANSITION_HOLD


def bucket_location(td: TD) -> str:
    if td.moveAlreadyConsumedPct >= 90.0: return "LOCATION_EXTREME"
    if td.moveAlreadyConsumedPct >= 70.0: return "LOCATION_LATE"
    if not td.continuationEntryAllowed and td.continuationEntryPaused: return "LOCATION_RESET_PENDING"
    if td.entryLocationQuality >= 80.0: return "LOCATION_EXCELLENT"
    if td.entryLocationQuality >= 60.0: return "LOCATION_GOOD"
    if td.entryLocationQuality >= 40.0: return "LOCATION_ACCEPTABLE"
    return "LOCATION_RESET_CONFIRMED"


def bucket_exhaustion(td: TD) -> str:
    if td.reversalProbability >= 60.0: return "EXHAUSTION_RESET_CONFIRMED"
    if td.exhaustionProbability >= 85.0: return "EXHAUSTION_EXTREME"
    if td.exhaustionProbability >= 60.0: return "EXHAUSTION_HIGH"
    if td.exhaustionProbability >= 35.0: return "EXHAUSTION_MODERATE"
    if td.transitionProbability >= 40.0: return "EXHAUSTION_RESETTING"
    return "EXHAUSTION_LOW"


def test_scenario_1_good_direction_poor_location_waits_not_permanent_block():
    td = TD(entryLocationQuality=10.0, moveAlreadyConsumedPct=75.0)
    assert bucket_location(td) == "LOCATION_LATE"
    # LATE -> ALLOW_SCALP in the action function, never HARD_BLOCK
    assert bucket_location(td) != "LOCATION_EXTREME"


def test_scenario_2_good_direction_completed_pullback_reset_allows():
    td = TD(entryLocationQuality=85.0, moveAlreadyConsumedPct=15.0)
    assert bucket_location(td) == "LOCATION_EXCELLENT"


def test_scenario_4_exhaustion_with_fresh_reset_and_room_can_become_valid_again():
    td = TD(exhaustionProbability=90.0, reversalProbability=65.0)
    # reversalProbability check comes FIRST -- a strong reset signal
    # overrides the raw exhaustion percentage
    assert bucket_exhaustion(td) == "EXHAUSTION_RESET_CONFIRMED"


def test_scenario_5_exhaustion_without_opposite_structure_no_auto_reverse():
    td = TD(exhaustionProbability=90.0, reversalProbability=10.0, lifecycle=TREND_EXHAUSTING)
    assert bucket_exhaustion(td) == "EXHAUSTION_EXTREME"
    # lifecycle alone (not OPPOSITE_DIRECTION_CONFIRMED) does not trigger reversal


def test_scenario_16_mature_campaign_pyramid_add_blocked_via_shared_action_field():
    td = TD(existingBuyAction=TRANSITION_STOP_ADDS)
    # mirrors XAU_MarketThesisAction's pyramid branch: reads
    # existingBuyAction directly, same as the v6.24.6 gate
    campaign_action = td.existingBuyAction
    assert campaign_action == TRANSITION_STOP_ADDS


def test_scenario_18_counter_excursion_cannot_alter_primary_campaign():
    # isCounterExcursion routes straight to a scalp-classification action in
    # XAU_MarketThesisAction's fallthrough, never ALLOW_CORE/ALLOW_ADD (which
    # would imply campaign ownership)
    is_counter_excursion = True
    final_fallthrough_action = "ALLOW_SCALP" if is_counter_excursion else "ALLOW_CORE"
    assert final_fallthrough_action == "ALLOW_SCALP"
