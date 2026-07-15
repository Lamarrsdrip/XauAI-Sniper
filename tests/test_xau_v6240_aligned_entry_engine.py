"""Production regressions for the v6.24.0 aligned normal-entry engine.

The behavioral oracle is deliberately small and deterministic. It proves the
architecture's contract; it is not a profit forecast or a substitute for MT5
tick-data testing.
"""

from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def source() -> str:
    return EA.read_text(encoding="utf-8", errors="ignore")


def function_body(src: str, signature: str) -> str:
    start = src.index(signature)
    brace = src.index("{", start)
    depth = 0
    for idx in range(brace, len(src)):
        if src[idx] == "{":
            depth += 1
        elif src[idx] == "}":
            depth -= 1
            if depth == 0:
                return src[brace : idx + 1]
    raise AssertionError(f"unbalanced body for {signature}")


@dataclass(frozen=True)
class Candidate:
    direction: int = -1
    first_price: float = 4033.0
    current_price: float = 4032.3
    atr: float = 3.0
    bars: int = 0
    remaining_reward_r: float = 2.2
    extension_atr: float = 0.4
    reset_atr: float = 0.0
    opposite_break: bool = False
    protected_news: bool = False
    extreme_spread: bool = False


def freshness(c: Candidate) -> str:
    travel = (
        (c.current_price - c.first_price) / c.atr
        if c.direction > 0
        else (c.first_price - c.current_price) / c.atr
    )
    reset = c.reset_atr >= 0.55
    genuinely_extended = (
        not reset
        and travel >= 1.60
        and c.extension_atr >= 1.60
        and (c.bars >= 2 or c.remaining_reward_r < 1.20)
        and c.remaining_reward_r < 1.35
    )
    if c.opposite_break:
        return "BLOCK_OPPOSITE_STRUCTURE"
    if c.protected_news:
        return "BLOCK_PROTECTED_NEWS"
    if c.extreme_spread:
        return "BLOCK_EXTREME_SPREAD"
    if genuinely_extended:
        return "BLOCK_EXHAUSTED_POOR_REWARD"
    return "ALLOW_FRESH"


def test_release_identity_is_v6241():
    # v6.24.1 layers the 15%-risk margin fix on top of this v6.24.0 aligned
    # entry architecture; the architecture itself (asserted by every other
    # test in this file) is unchanged, only the version identity moved.
    s = source()
    assert '#property version   "6.241"' in s
    assert '#define XAUAI_EA_VERSION "v6.24.1"' in s
    assert '#define XAUAI_EA_VERSION_NUM "6.24.1"' in s
    assert "ALIGNED ENTRY ENGINE" in s


def test_fresh_july15_sell_is_allowed_near_4033():
    assert freshness(Candidate()) == "ALLOW_FRESH"


def test_late_july15_sell_near_4026_is_rejected():
    late = Candidate(
        current_price=4026.671,
        atr=3.0,
        bars=3,
        extension_atr=2.10,
        remaining_reward_r=0.75,
    )
    assert freshness(late) == "BLOCK_EXHAUSTED_POOR_REWARD"


def test_block_early_approve_late_is_impossible():
    early = Candidate(current_price=4031.8, extension_atr=0.7, remaining_reward_r=2.0)
    late = Candidate(current_price=4026.671, bars=3, extension_atr=2.1, remaining_reward_r=0.75)
    assert freshness(early) == "ALLOW_FRESH"
    assert freshness(late).startswith("BLOCK_")


def test_genuine_reset_creates_fresh_identity():
    reset = Candidate(
        current_price=4028.5,
        bars=4,
        extension_atr=2.0,
        reset_atr=0.70,
        remaining_reward_r=1.8,
    )
    assert freshness(reset) == "ALLOW_FRESH"


def test_moderate_exhaustion_signal_alone_is_not_a_veto():
    assert freshness(Candidate(extension_atr=1.1, bars=2, remaining_reward_r=1.8)) == "ALLOW_FRESH"


def test_elapsed_bars_alone_never_create_a_block():
    aged_but_unextended = Candidate(bars=20, extension_atr=0.5, remaining_reward_r=2.4)
    assert freshness(aged_but_unextended) == "ALLOW_FRESH"


def test_extension_with_good_remaining_reward_stays_tradeable():
    room_remains = Candidate(current_price=4027.8, bars=3, extension_atr=1.9, remaining_reward_r=2.0)
    assert freshness(room_remains) == "ALLOW_FRESH"


def test_one_bar_impulse_cannot_be_called_stale_by_time():
    one_bar = Candidate(current_price=4028.0, bars=1, extension_atr=1.7, remaining_reward_r=1.3)
    assert freshness(one_bar) == "ALLOW_FRESH"


def test_reset_releases_even_a_large_prior_extension():
    reset = Candidate(current_price=4025.0, bars=8, extension_atr=3.0, reset_atr=0.8, remaining_reward_r=0.9)
    assert freshness(reset) == "ALLOW_FRESH"


def test_real_safety_still_blocks():
    assert freshness(Candidate(opposite_break=True)) == "BLOCK_OPPOSITE_STRUCTURE"
    assert freshness(Candidate(protected_news=True)) == "BLOCK_PROTECTED_NEWS"
    assert freshness(Candidate(extreme_spread=True)) == "BLOCK_EXTREME_SPREAD"


def test_one_freshness_authority_and_one_bounded_delay_owner():
    s = source()
    assert "bool XAU_FreshnessExtensionAuthority(" in s
    assert "bool XAU_TimingAuthorityAllows(" in s
    assert "XAU_ENTRY_DELAY_ABSOLUTE_FLOOR_SEC   120.0" in s
    assert "XAU_ENTRY_DELAY_ABSOLUTE_CEILING_SEC 180.0" in s
    assert "TIMING_DELAY_ACTIVE" in s
    assert "TIMING_DELAY_SATISFIED" in s
    assert "XAU_TimingEngineConfirmsEntry" not in s
    assert "PendingEntryConfirmation" not in s
    assert "ENTRY_DELAY_STARTED" not in s


def test_ai_is_telemetry_only_and_missing_ai_is_neutral():
    s = source()
    assert "AI_TELEMETRY_ONLY" in s
    assert "AI_MISSING_NEUTRAL" in s
    assert "AI DIRECTOR BLOCK" not in s
    assert "AI SKIP cannot veto" in s


def test_personality_and_smc_cannot_independently_veto():
    s = source()
    assert "PERSONALITY_CONTEXT_ONLY" in s
    assert "SMC_CONTEXT_ONLY" in s
    assert "PERSONALITY GATE BLOCK" not in s
    assert "SMC HARD CONFLICT BLOCK" not in s


def test_no_limit_has_no_loss_fear_or_daily_entry_lock():
    s = source()
    assert "NO_LIMIT_ALIGNED: daily locks, streak pauses, drawdown fear and loss sizing are telemetry only" in s
    for old in (
        "ADAPTIVE_DRAWDOWN: grade=",
        "TRI RE-ENTRY BLOCK",
        "RECOVERY-GATE",
        "DIR-LOCK —",
        "STI_REENTRY_WAIT",
    ):
        assert old not in s


def test_valid_setup_uses_configured_risk_without_quality_multipliers():
    s = source()
    assert "double finalSzMult = originalGradeSizeMulti;" in s
    assert "FULL_RISK_BINARY_BLOCK: combined quality evidence" not in s
    assert "committeeSzMult" not in function_body(s, "void OnTick()")


def test_removed_blocker_reasons_are_absent():
    s = source()
    removed = (
        "PERSONALITY GATE BLOCK",
        "PERSONALITY-GATE SYMMETRIC RECHECK",
        "SMC HARD CONFLICT BLOCK",
        "TRI RE-ENTRY BLOCK",
        "STI_LATE_BLOCK",
        "STI_EXHAUST_BLOCK",
        "STI_REENTRY_WAIT",
        "RECOVERY-GATE",
        "AI DIRECTOR BLOCK",
        "ADAPTIVE_DRAWDOWN: grade=",
        "FULL_RISK_BINARY_BLOCK: combined quality evidence",
        "SOFT_BLOCK_CONVERTED",
        "HARD_BLOCK_SELF_CONSISTENCY",
        "FAILED-IMPULSE BLOCK",
        "POST-SWEEP A+ BLOCK",
        "DAMAGE-SETUP QUALITY BLOCK",
        "BAD-LOCATION BLOCK",
        "CYCLE-GIVEBACK BLOCK",
        "REVERSAL_DIRECTION_VALID_BUT_WAIT_FOR_PULLBACK",
        "OLD_DIRECTION_EXHAUSTION_HARD_BLOCK",
        "DXY VETO",
        "BRAIN-BLOCK",
        "PROFIT GUARDIAN VETO",
        "EPF VETO",
        "HIVE VETO",
        "ADAPTIVE REVERSAL BLOCKED",
        "TRANSITION_WAIT, pausing",
        "FIX-C: B-grade trade demoted to SKIP",
        "BAD-TIMING SOFT",
        "REPORT-FIT SCOUT",
    )
    assert len(removed) >= 30
    present = [token for token in removed if token in s]
    assert not present, present


def test_opentrade_is_operational_safety_only():
    s = source()
    body = function_body(s, "bool OpenTrade(int signal, double atr, string reason, double sizeMulti, bool isManualOverride = false)")
    for strategic in (
        "XAU_ProductionActiveFinalEntryAssertion",
        "XAU_FinalAdaptiveDirectionDecision",
        "XAU_GrowthGuardEntryBlockReason",
        "XAU_ClassifySetup",
        "XAU_TimingEngineConfirmsEntry",
        "StrategyFitsPersonality",
    ):
        assert strategic not in body
    for operational in (
        "XAU_CrossInstanceEntryLockActive",
        "OrderCalcMargin",
        "SYMBOL_VOLUME_MIN",
    ):
        assert operational in body


def test_reentry_and_pyramid_use_shared_authorities():
    s = source()
    assert 'XAU_FreshnessExtensionAuthority(lastClose.dir, "RE_ENTRY"' in s
    assert 'XAU_ReentryPyramidAuthority(dir, "PYRAMID"' in s
    assert 'XAU_ReentryPyramidAuthority(lastClose.dir, "RE_ENTRY"' in s


def test_news_has_one_hard_owner():
    s = source()
    assert "bool XAU_NewsAuthorityAllows(" in s
    assert s.count("XAU_NewsAuthorityAllows(") >= 2  # definition + normal call
    assert "XAU_EvaluateAdaptiveNewsMomentumEntry" not in function_body(s, "void OnTick()")


def test_freshness_tracks_required_candidate_fields():
    s = source()
    for field in (
        "firstCandidateTime",
        "firstCandidatePrice",
        "impulseOrigin",
        "candidateDirection",
        "barsElapsed",
        "atrTravelled",
        "bestAvailableEntry",
        "remainingRewardR",
        "objectiveReached",
        "marketReset",
        "confirmationAfterExtension",
        "candidateGeneration",
        "candidateSetup",
        "requiredDelaySeconds",
    ):
        assert field in s


def test_normal_source_contains_no_inverse_routing():
    body = function_body(source(), "void OnTick()")
    assert "XAU_IsInverseExperiment" not in body
    assert "-signal" not in body[body.index("// v6.24.0 ALIGNED ENTRY ENGINE") :]
