"""Canonical Python mirror of the EA's unified market-thesis logic
(backend/ea_code/XAUUSD_AI_Sniper_EA.mq5: XAU_BucketLocation/Exhaustion/
Timing/HTF/Structure/Pressure and XAU_MarketThesisAction, v6.24.8-v6.24.12).

This is the single source of truth for the Python-side mirror used by both
the test suite's behavioral tests and scripts/replay_learning_harness.py.
Keeping one canonical copy (instead of the three near-duplicates that
existed across test files before this module) means a future EA change
only needs updating here once, and the replay harness and tests can never
silently drift apart from each other.

Every branch here corresponds 1:1 to a named function/branch in the real
.mq5 source -- see the docstring on each function for the exact source
anchor. This module computes NOTHING new; it mirrors existing logic only.
"""

from dataclasses import dataclass

# ENUM_XAU_MARKET_LIFECYCLE (mirrors the real int values, .mq5 line ~3357)
TREND_EARLY, TREND_DEVELOPING, TREND_HEALTHY, TREND_MATURE = 0, 1, 2, 3
TREND_LATE, TREND_EXHAUSTING, TRANSITION_NEUTRAL = 4, 5, 6
OPPOSITE_DIRECTION_FORMING, OPPOSITE_DIRECTION_CONFIRMED = 7, 8

# ENUM_XAU_TRANSITION_POSITION_ACTION (.mq5 line ~3363)
TRANSITION_HOLD, TRANSITION_STOP_ADDS = 0, 1
TRANSITION_TIGHTEN_PROTECTION, TRANSITION_EXIT_PROFITABLE = 2, 3
TRANSITION_EXIT_CONTROLLED = 4
TRANSITION_WAIT_FOR_OPPOSITE_SETUP = 5

BLOCKING_PYRAMID_ACTIONS = {TRANSITION_STOP_ADDS, TRANSITION_TIGHTEN_PROTECTION,
                            TRANSITION_EXIT_PROFITABLE, TRANSITION_EXIT_CONTROLLED}


@dataclass
class TransitionDecision:
    """Mirrors XAU_AdaptiveTransitionDecision (.mq5 struct, line ~3369)."""
    dominantDirection: int = 1
    remainingRewardR: float = 3.0
    oppositeRemainingRewardR: float = 0.0
    entryLocationQuality: float = 70.0
    moveAlreadyConsumedPct: float = 20.0
    exhaustionProbability: float = 20.0
    transitionProbability: float = 10.0
    reversalProbability: float = 5.0
    trendHealth: float = 70.0
    buyConfidence: float = 50.0
    sellConfidence: float = 50.0
    lifecycle: int = TREND_HEALTHY
    continuationEntryAllowed: bool = True
    continuationEntryPaused: bool = False
    reversalWaitForPullback: bool = False
    oppositeReclaim: bool = False
    oppositeRetestHeld: bool = False
    oppositeDisplacement: bool = False
    existingBuyAction: int = TRANSITION_HOLD
    existingSellAction: int = TRANSITION_HOLD
    # HTF/structure evidence (not part of the real struct -- these mirror
    # the separate globals XAU_BucketHTF/XAU_BucketStructure read directly:
    # g_htfConsensusDir, g_smc_bos_dir. Bundled here for convenience only.
    htfConsensusDir: int = 0
    smcBosDir: int = 0
    smcBonus: float = 0.0


def bucket_location(td: TransitionDecision) -> str:
    """Mirrors XAU_BucketLocation, .mq5 line ~10820."""
    if td.moveAlreadyConsumedPct >= 90.0: return "LOCATION_EXTREME"
    if td.moveAlreadyConsumedPct >= 70.0: return "LOCATION_LATE"
    if not td.continuationEntryAllowed and td.continuationEntryPaused: return "LOCATION_RESET_PENDING"
    if td.entryLocationQuality >= 80.0: return "LOCATION_EXCELLENT"
    if td.entryLocationQuality >= 60.0: return "LOCATION_GOOD"
    if td.entryLocationQuality >= 40.0: return "LOCATION_ACCEPTABLE"
    return "LOCATION_RESET_CONFIRMED"


def bucket_exhaustion(td: TransitionDecision) -> str:
    """Mirrors XAU_BucketExhaustion, .mq5 line ~10831."""
    if td.reversalProbability >= 60.0: return "EXHAUSTION_RESET_CONFIRMED"
    if td.exhaustionProbability >= 85.0: return "EXHAUSTION_EXTREME"
    if td.exhaustionProbability >= 60.0: return "EXHAUSTION_HIGH"
    if td.exhaustionProbability >= 35.0: return "EXHAUSTION_MODERATE"
    if td.transitionProbability >= 40.0: return "EXHAUSTION_RESETTING"
    return "EXHAUSTION_LOW"


def bucket_timing(td: TransitionDecision) -> str:
    """Mirrors XAU_BucketTiming, .mq5 line ~10841."""
    if td.lifecycle == OPPOSITE_DIRECTION_CONFIRMED and td.oppositeReclaim and td.oppositeRetestHeld:
        return "TIMING_READY"
    if td.reversalWaitForPullback: return "TIMING_WAIT_PULLBACK"
    if td.oppositeDisplacement and not td.oppositeReclaim: return "TIMING_WAIT_RECLAIM"
    if td.moveAlreadyConsumedPct >= 90.0: return "TIMING_LATE"
    if td.continuationEntryPaused: return "TIMING_WAIT_CONFIRMATION"
    if td.continuationEntryAllowed: return "TIMING_READY"
    return "TIMING_WAIT_CONFIRMATION"


def bucket_htf(signal: int, td: TransitionDecision) -> str:
    """Mirrors XAU_BucketHTF, .mq5 line ~10852."""
    if td.lifecycle in (TRANSITION_NEUTRAL, OPPOSITE_DIRECTION_FORMING):
        return "HTF_TRANSITIONING"
    if td.htfConsensusDir == 0: return "HTF_NEUTRAL"
    if td.htfConsensusDir == signal:
        return "HTF_STRONGLY_ALIGNED" if td.trendHealth >= 70.0 else "HTF_ALIGNED"
    return "HTF_STRONG_CONFLICT" if td.exhaustionProbability >= 60.0 else "HTF_CONFLICT"


def bucket_structure(signal: int, td: TransitionDecision) -> str:
    """Mirrors XAU_BucketStructure, .mq5 line ~10870."""
    confirmed_opposite = (td.smcBosDir != 0 and td.smcBosDir == -signal and td.htfConsensusDir == -signal)
    if confirmed_opposite: return "STRUCTURE_INVALIDATED"
    if td.smcBosDir != 0 and td.smcBosDir == -signal: return "STRUCTURE_OPPOSES"
    if td.smcBonus >= 2.0: return "STRUCTURE_STRONGLY_SUPPORTS"
    if td.smcBonus > 0.0: return "STRUCTURE_SUPPORTS"
    return "STRUCTURE_MIXED"


def bucket_pressure(td: TransitionDecision) -> str:
    """Mirrors XAU_BucketPressure, .mq5 line ~10883 (v6.24.12)."""
    if td.lifecycle in (TRANSITION_NEUTRAL, OPPOSITE_DIRECTION_FORMING):
        return "PRESSURE_TRANSITIONING"
    diff = td.buyConfidence - td.sellConfidence
    if diff >= 30.0: return "BUY_PRESSURE_STRONG"
    if diff >= 10.0: return "BUY_PRESSURE_MODERATE"
    if diff <= -30.0: return "SELL_PRESSURE_STRONG"
    if diff <= -10.0: return "SELL_PRESSURE_MODERATE"
    return "PRESSURE_BALANCED"


def thesis_action(signal: int, is_pyramid_add: bool, loc: str, exh: str, tim: str,
                  htf: str, structure: str, td: TransitionDecision) -> tuple:
    """Mirrors XAU_MarketThesisAction's priority order exactly, .mq5 line ~10896.
    Returns (action, reason)."""
    room_r = td.remainingRewardR if signal == td.dominantDirection else td.oppositeRemainingRewardR

    if structure == "STRUCTURE_INVALIDATED":
        return "HARD_BLOCK", "structure invalidated: confirmed opposite BOS+HTF"
    if loc == "LOCATION_EXTREME" and room_r < 0.5:
        return "HARD_BLOCK", "extreme location, no realistic remaining reward"
    if td.lifecycle in (TRANSITION_NEUTRAL, OPPOSITE_DIRECTION_FORMING):
        return "TRANSITION_WATCH", "opposite evidence developing, not yet confirmed"
    if td.lifecycle == OPPOSITE_DIRECTION_CONFIRMED and signal != td.dominantDirection and tim != "TIMING_READY":
        return "OPPOSITE_DISCOVERY", "opposite campaign confirmed, awaiting entry timing"

    if is_pyramid_add:
        campaign_action = td.existingBuyAction if signal == 1 else td.existingSellAction
        if campaign_action in BLOCKING_PYRAMID_ACTIONS:
            return "NO_MORE_ADDS", f"campaign action={campaign_action}"
        if loc in ("LOCATION_LATE", "LOCATION_EXTREME"):
            return "WAIT_FOR_PULLBACK", "poor addition location, wait for reset"
        return "ALLOW_ADD", "healthy campaign, valid addition location"

    if exh == "EXHAUSTION_EXTREME":
        return "PROTECT_RUNNER", "campaign exhausted: manage existing only, protect runner"

    if tim == "TIMING_WAIT_PULLBACK": return "WAIT_FOR_PULLBACK", "pullback not complete"
    if tim == "TIMING_WAIT_RECLAIM": return "WAIT_FOR_RECLAIM", "displacement without reclaim"
    if tim == "TIMING_FAILED": return "MANAGE_EXISTING_ONLY", "timing evidence failed"
    if tim in ("TIMING_WAIT_CONFIRMATION", "TIMING_STALE"):
        return "WAIT_FOR_CONFIRMATION", "awaiting fresh confirmation"

    if loc == "LOCATION_LATE": return "ALLOW_SCALP", "late location: scalp-only sizing"
    if loc == "LOCATION_EXTREME": return "WAIT_FOR_PULLBACK", "extreme location, insufficient room"

    if htf in ("HTF_CONFLICT", "HTF_STRONG_CONFLICT") and (
        loc in ("LOCATION_LATE", "LOCATION_EXTREME") or exh in ("EXHAUSTION_HIGH", "EXHAUSTION_EXTREME")):
        return "WAIT_FOR_CONFIRMATION", "HTF conflict combined with poor location/high exhaustion"
    if structure == "STRUCTURE_OPPOSES" and (loc == "LOCATION_LATE" or exh == "EXHAUSTION_HIGH"):
        return "WAIT_FOR_CONFIRMATION", "opposing structure combined with poor location/exhaustion"

    return "ALLOW_CORE", "healthy campaign, acceptable-or-better location, timing ready"


# v6.24.14/v6.24.15 additions -- OLD_DIRECTION_STATE + readiness state map.

def classify_old_direction_state(direction: int, td: TransitionDecision,
                                 prior_exhaustion: bool = False) -> str:
    """Mirrors XAU_ClassifyOldDirectionState, .mq5 (v6.24.14). `prior_exhaustion`
    defaults False here because this harness has no g_postClose equivalent
    (no persistent "did this direction just close very exhausted" memory
    across independent CSV rows) -- RESET_CONFIRMED can therefore never be
    produced by this mirror, which is the correct, conservative behavior
    given the data available (matches the real function's own "time alone
    cannot reset exhaustion" rule: without genuine prior-close evidence,
    there is nothing to reset FROM)."""
    existing_action = td.existingBuyAction if direction == 1 else td.existingSellAction
    fresh_allowed = True if direction == td.dominantDirection else False
    if existing_action == TRANSITION_EXIT_CONTROLLED or (
        td.lifecycle == OPPOSITE_DIRECTION_CONFIRMED and td.dominantDirection not in (0, direction)
    ):
        return "OLD_DIRECTION_INVALIDATED"
    if existing_action in (TRANSITION_STOP_ADDS, TRANSITION_TIGHTEN_PROTECTION, TRANSITION_EXIT_PROFITABLE) \
       or not fresh_allowed:
        if prior_exhaustion:
            return "OLD_DIRECTION_EXHAUSTED"
        return "OLD_DIRECTION_RESETTING" if td.lifecycle == TRANSITION_NEUTRAL else "OLD_DIRECTION_MATURE"
    if prior_exhaustion:
        return "OLD_DIRECTION_RESET_CONFIRMED"
    return "OLD_DIRECTION_MATURE" if td.lifecycle == 3 else "OLD_DIRECTION_HEALTHY"  # 3 == TREND_MATURE


def old_side_state_from_row_evidence(signal: int, htf_dir: int, entry_phase: str, late_chase: str) -> str:
    """Documented APPROXIMATION, not a mirror of any single .mq5 function:
    the CSV's per-row telemetry only ever describes evidence for the
    CANDIDATE's own direction, not a simultaneous read of the opposite
    side's campaign state (no dual-sided snapshot exists in this schema).
    htf_dir opposing the candidate's direction is used as the closest real
    proxy for "the opposite side still has structural support" -- the same
    real field (m15/m30 AGAINST) already used elsewhere in this file for
    htf_dir itself, not a new invented signal."""
    opposing = (htf_dir == -signal and signal != 0)
    if not opposing:
        return "OLD_DIRECTION_INVALIDATED"  # no real opposition detected -- old side not blocking
    if entry_phase == "LATE_OR_WEAK" or late_chase == "Y":
        return "OLD_DIRECTION_EXHAUSTED"
    return "OLD_DIRECTION_HEALTHY"


def map_to_readiness_state(old_side: str, thesis: dict) -> str:
    """Mirrors XAU_MapToReadinessState, .mq5 (v6.24.15). Produces the
    MARKET-EVIDENCE state only (the layer before the persistent "must be
    re-observed on a later bar" promotion to ENTRY_READY) -- this harness's
    rows are independent decision points, not a continuous per-bar stream,
    so the multi-bar persistence gate cannot be honestly replayed here.
    READINESS_CONFIRMED in this mirror means "the real EA's persistent
    engine would consider promoting this to ENTRY_READY on its NEXT
    observation of the same idea," not "already fired."""
    action = thesis["action"]
    loc = thesis["location"]
    pressure = thesis["pressure"]
    structure = thesis["structure"]
    timing = thesis["timing"]
    direction = thesis["direction"]

    if action == "HARD_BLOCK":
        return "READINESS_INVALIDATED"
    if old_side in ("OLD_DIRECTION_HEALTHY", "OLD_DIRECTION_MATURE"):
        return "READINESS_OLD_SIDE_ACTIVE"
    if old_side == "OLD_DIRECTION_EXHAUSTED" and action != "ALLOW_CORE":
        return "READINESS_WAIT_FOR_EXHAUSTION"
    if loc in ("LOCATION_LATE", "LOCATION_EXTREME"):
        return "READINESS_WAIT_FOR_LOCATION"
    pressure_against = (
        (direction == 1 and pressure in ("SELL_PRESSURE_MODERATE", "SELL_PRESSURE_STRONG")) or
        (direction == -1 and pressure in ("BUY_PRESSURE_MODERATE", "BUY_PRESSURE_STRONG"))
    )
    if pressure == "PRESSURE_BALANCED" or pressure_against:
        return "READINESS_WAIT_FOR_PRESSURE"
    if structure == "STRUCTURE_OPPOSES":
        return "READINESS_WAIT_FOR_STRUCTURE"
    if timing == "TIMING_WAIT_RECLAIM": return "READINESS_WAIT_FOR_RECLAIM"
    if timing == "TIMING_WAIT_PULLBACK": return "READINESS_WAIT_FOR_RETEST"
    if timing in ("TIMING_WAIT_CONFIRMATION", "TIMING_STALE"): return "READINESS_FORMING"
    if timing in ("TIMING_LATE", "TIMING_FAILED"): return "READINESS_WAIT_FOR_LOCATION"
    if action == "ALLOW_CORE" and timing == "TIMING_READY":
        return "READINESS_CONFIRMED"
    return "READINESS_FORMING"


def compute_thesis(signal: int, is_pyramid_add: bool, td: TransitionDecision) -> dict:
    """Mirrors XAU_ComputeMarketThesis, .mq5 line ~10981 -- the one entry
    point that computes all six buckets and the final action together."""
    loc = bucket_location(td)
    exh = bucket_exhaustion(td)
    tim = bucket_timing(td)
    htf = bucket_htf(signal, td)
    structure = bucket_structure(signal, td)
    pressure = bucket_pressure(td)
    action, reason = thesis_action(signal, is_pyramid_add, loc, exh, tim, htf, structure, td)
    return {
        "direction": signal, "location": loc, "exhaustion": exh, "timing": tim,
        "htf": htf, "structure": structure, "pressure": pressure,
        "action": action, "reason": reason,
    }
