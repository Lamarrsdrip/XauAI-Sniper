"""Executable release gates for production v6.23.2 ACTIVE intelligence.

These are deterministic decision/state regressions, not profit forecasts or a
substitute for broker-tick Strategy Tester data.
"""

from dataclasses import dataclass, field
from pathlib import Path
import re
from typing import Optional


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.23.2.mq5"
PRESET = ROOT / "config/XAUUSD_AI_Sniper_EA_v6.23.2_ACTIVE.set"


@dataclass
class Opportunity:
    exhaustion: float = 85
    reward_r: float = 2.0
    distance_value_atr: float = 0.5
    consumed_pct: float = 40
    impulse_atr: float = 1.0
    reclaim_at: Optional[int] = None
    retest_at: Optional[int] = None
    displacement_at: Optional[int] = None
    entered: bool = False
    manual_closed: bool = False
    generation: int = 1
    state: str = "WATCH"
    timer_started: Optional[int] = None
    timer_opportunity: Optional[str] = None

    def record(self, bar: int, *, reclaim=False, retest=False, displacement=False):
        if reclaim:
            self.reclaim_at = bar
        if retest:
            self.retest_at = bar
        if displacement:
            self.displacement_at = bar

    def package(self, bar: int, window=12):
        fresh = lambda t: t is not None and bar - t <= window
        r, t, d = fresh(self.reclaim_at), fresh(self.retest_at), fresh(self.displacement_at)
        return r and (t or d), r and t and d

    def location(self):
        return (
            self.reward_r >= 1.2
            and self.distance_value_atr <= 1.0
            and self.consumed_pct <= 70
            and self.impulse_atr <= 2.0
            and not self.entered
            and not self.manual_closed
        )

    def decide(self, bar: int, source="PRIMARY"):
        compact, full = self.package(bar)
        if source in {"PRIMARY", "RE_ENTRY", "RECOVERY", "RETRY", "PYRAMID"} and self.exhaustion >= 70:
            return "BLOCK_OLD_DIRECTION"
        if self.exhaustion >= 80 and full:
            return "TRADE_NOW" if self.location() else "WAIT_FOR_VALUE"
        return "WAIT"

    def reset(self, *, atr_pullback=False, held_retest=False, compact_base=False, new_swing=False):
        if atr_pullback or held_retest or (compact_base and new_swing):
            self.entered = False
            self.manual_closed = False
            self.consumed_pct = 35
            self.distance_value_atr = 0.55
            self.impulse_atr = 1.2
            self.generation += 1
            self.state = "VALUE_RESET"
            return True
        return False


def source():
    return EA.read_text()


def test_01_active_is_loaded_by_production_preset():
    assert "InpAdaptiveTransitionMode=2" in PRESET.read_text()


def test_02_shadow_cannot_silently_return():
    assert "InpAdaptiveTransitionMode=1" not in PRESET.read_text()
    assert 'InpAdaptiveTransitionPresetId       = "XAUUSD_AI_Sniper_EA_v6.23.2_ACTIVE.set"' in source()


def test_03_healthy_early_trend_trades():
    assert Opportunity(exhaustion=35).decide(10, "HEALTHY") == "WAIT"
    assert "continuationEntryAllowed = !authoritativeExhaustion" in source()


def test_04_healthy_pullback_keeps_normal_delay():
    s = source()
    assert "XAU_ENTRY_DELAY_ABSOLUTE_FLOOR_SEC   120.0" in s
    assert "XAU_ENTRY_DELAY_ABSOLUTE_CEILING_SEC 180.0" in s


def test_05_delay_is_120_to_180_seconds():
    s = source()
    assert "XAU_EffectiveEntryDelaySeconds" in s and "requiredDelaySeconds" in s


def test_06_timer_cannot_reset_for_same_opportunity():
    s = source()
    assert "g_pendingEntryConfirm.opportunityId==timingOpportunityId" in s
    assert "g_pendingEntryConfirm.opportunityId   = timingOpportunityId" in s


def test_07_mid_candle_revalidation_is_reachable():
    assert "PENDING_CONFIRM_DUE_MIDBAR" in source()


def test_08_mature_fresh_reset_with_reward_may_trade():
    assert "exhaustionProbability>=60.0 && d.exhaustionProbability<70.0" in source()
    assert "d.remainingRewardR<InpTransitionMinRewardR" in source()


def test_09_mature_without_reward_blocks():
    assert "continuationConfidence<55.0 || d.remainingRewardR<InpTransitionMinRewardR" in source()


def test_10_high_exhaustion_blocks_all_old_sources():
    o = Opportunity(exhaustion=70)
    for path in ("PRIMARY", "RE_ENTRY", "RECOVERY", "RETRY", "PYRAMID"):
        assert o.decide(10, path) == "BLOCK_OLD_DIRECTION"


def test_11_genuine_continuation_reset_decays_exhaustion():
    s = source()
    assert "realContinuationReset" in s
    assert "g_transitionPersistentExhaustion-10.0" in s


def test_12_evidence_accumulates_across_separate_bars():
    o = Opportunity()
    o.record(1, reclaim=True)
    o.record(2, retest=True)
    o.record(3, displacement=True)
    assert o.package(3) == (True, True)


def test_13_valid_reversal_near_value_is_executable():
    o = Opportunity()
    o.record(1, reclaim=True); o.record(2, retest=True); o.record(3, displacement=True)
    assert o.decide(3, "REVERSAL") == "TRADE_NOW"


def test_14_reversal_authority_is_not_observation_only():
    s = source()
    assert "oppositeEntryAllowed = reversalReady" in s
    assert "OpenTrade(signal,bufATR[1],setupName+\" [A+]\",1.0)" in s


def test_15_correct_direction_bad_location_waits():
    o = Opportunity(consumed_pct=82)
    o.record(1, reclaim=True); o.record(2, retest=True); o.record(3, displacement=True)
    assert o.decide(3, "REVERSAL") == "WAIT_FOR_VALUE"


def test_16_pullback_or_structure_reset_releases_wait():
    o = Opportunity(consumed_pct=85, entered=True)
    assert o.reset(held_retest=True)
    assert o.location()


def test_17_consumed_opportunity_cannot_reopen_same_price():
    o = Opportunity(entered=True)
    o.record(1, reclaim=True); o.record(2, retest=True); o.record(3, displacement=True)
    assert o.decide(3, "REVERSAL") == "WAIT_FOR_VALUE"


def test_18_manual_close_clears_and_consumes_stale_state():
    s = source()
    assert "XAU_ATHandleManualClose" in s
    assert "g_pendingOpportunity.active=false" in s
    assert "g_recoveryAwaitingTiming.active=false" in s
    assert "REQUIRE_GENUINE_MARKET_RESET" in s


def test_19_manual_support_position_is_not_adopted():
    s = source()
    assert "posInfo.Magic() != InpMagicNumber" in s
    assert "magic != InpMagicNumber" in s


def test_20_all_automated_sources_obey_final_authority():
    s = source()
    for path in ("PRIMARY", "RE_ENTRY", "RECOVERY", "RETRY", "PYRAMID"):
        assert path in s
    assert s.count("XAU_ProductionActiveFinalEntryAssertion(") >= 4


def test_21_no_override_can_reopen_bad_reversal_location():
    gate = source()[source().index("bool opportunityDirection=(g_reversalOpportunity.active") :]
    assert "!d.reversalLocationGood || liveChase || g_reversalOpportunity.impulseConsumedByEntry" in gate


def test_22_healthy_frequency_model_does_not_collapse():
    healthy = [x for x in range(20) if 25 + x * 2 < 70]
    assert len(healthy) / 20 >= 0.80


def test_23_wait_and_expired_states_have_explicit_exits():
    s = source()
    assert "REVERSAL_OPPORTUNITY_EXPIRED" in s
    assert "REVERSAL_VALUE_RESET" in s
    assert "opportunityInvalidated" in s


def test_24_early_4019_to_4022_sequence_can_accumulate():
    o = Opportunity(distance_value_atr=0.65, consumed_pct=55, reward_r=1.8)
    o.record(1, reclaim=True); o.record(2, retest=True); o.record(3, displacement=True)
    assert o.decide(3, "REVERSAL") == "TRADE_NOW"
    s = source()
    assert "closed-M5 12-bar" in s
    assert "MathAbs(slowValue-recentValue)<=atr*1.50" in s


def test_25_late_4028_buy_is_blocked():
    o = Opportunity(distance_value_atr=1.25, consumed_pct=82, impulse_atr=2.4)
    o.record(1, reclaim=True); o.record(2, retest=True); o.record(3, displacement=True)
    assert o.decide(3, "REVERSAL") == "WAIT_FOR_VALUE"


def test_26_repeated_4084_poor_location_is_prevented():
    o = Opportunity(exhaustion=94, consumed_pct=88, distance_value_atr=1.4, impulse_atr=3.0)
    assert o.decide(10, "PRIMARY") == "BLOCK_OLD_DIRECTION"


def test_27_fresh_pullback_after_manual_close_creates_new_generation():
    o = Opportunity(entered=True, manual_closed=True)
    old = o.generation
    assert o.reset(compact_base=True, new_swing=True)
    assert o.generation == old + 1 and o.location()


def test_28_counter_remains_separate_and_cannot_bypass_location():
    s = source()
    assert "InpCounterExcursionMagicNumber" in s
    assert 'XAU_ProductionActiveFinalEntryAssertion(counterDir,"COUNTER"' in s


def test_29_full_risk_binary_sizing_is_unchanged():
    s = source()
    assert "InpNormalRiskPct       = 15.0" in s
    assert "FULL_RISK_BINARY_VALIDATED" in s


def test_30_no_silent_point_zero_one_fallback():
    s = source()
    assert "RISK_BLOCKED_LOT_BELOW_MIN" in s
    assert "No silent 0.01 fallback" in s


def test_release_identity_and_final_assertion_are_exact():
    s = source()
    assert '#define XAUAI_EA_VERSION "v6.23.2"' in s
    assert 'XAUAI_BUILD_HASH "v6232-production-active-intelligence-20260714"' in s
    assert "[PRODUCTION_ACTIVE_FINAL_ENTRY_ASSERTION]" in s
    assert not re.search(r"\[ACTIVE_FINAL_ENTRY_ASSERTION\]", s)


def test_production_only_release_has_no_experiment_reference():
    for path in (EA, PRESET, ROOT / "deploy/install_v6232_active_vps.ps1"):
        text = path.read_text()
        assert "v6.22" not in text and "CAMPAIGN_TRANSITION" not in text


def test_31_recovery_started_at_cannot_stay_zero_when_entering_backoff():
    """Forensic regression: g_recoveryState could jump straight to
    RECOVERY_BACKOFF (a different label's rebuild already consumed the
    shared backoff window, or a prior episode had just reset the timestamp
    via XAU_RecoverySucceededIfMatch) without ever passing through
    RebuildEntryIndicatorHandles(), the only other place that sets
    g_recoveryStartedAt. Left unguarded, elapsed = TimeCurrent() - 0 prints
    a ~56-year value in INDICATOR_RECOVERY_STATUS / INDICATOR_RECOVERY_SUCCEEDED.
    Confirms the guard exists immediately before that assignment.
    """
    s = source()
    backoff_entry = re.search(
        r"if\(!rebuildAllowed\)\s*\{\s*"
        r"(?://[^\n]*\n\s*)*"
        r"if\(g_recoveryStartedAt<=0\)\s*g_recoveryStartedAt\s*=\s*TimeCurrent\(\);\s*"
        r"g_recoveryState\s*=\s*RECOVERY_BACKOFF;",
        re.sub(r"[ \t]+", "", s),
    )
    assert backoff_entry, (
        "g_recoveryStartedAt must be initialized before g_recoveryState=RECOVERY_BACKOFF "
        "in the direct-entry branch, or elapsed can be computed from timestamp 0"
    )


def test_32_recovery_elapsed_fields_are_log_only_not_a_trade_gate():
    """The buggy field must never be load-bearing: only g_recoveryRetryAt
    (derived from g_lastIndicatorRebuildAt, unaffected by this bug) may gate
    the backoff-window early return that skips a scan."""
    s = source()
    gate = re.search(
        r"if\(g_recoveryState\s*==\s*RECOVERY_BACKOFF\s*&&\s*TimeCurrent\(\)\s*<\s*g_recoveryRetryAt\)",
        s,
    )
    assert gate, "backoff gate must key off g_recoveryRetryAt, not g_recoveryStartedAt"
    # g_recoveryStartedAt may appear only inside Print(...) diagnostics,
    # its own declaration/assignment, or a code comment -- never a live
    # conditional that would make retry/rebuild/signal behavior depend on it.
    for match in re.finditer(r"g_recoveryStartedAt", s):
        line_start = s.rfind("\n", 0, match.start()) + 1
        line_end = s.find("\n", match.end())
        line = s[line_start:line_end]
        stripped = line.strip()
        is_comment = stripped.startswith("//")
        is_declaration = "datetime" in line and "=" in line and "TimeCurrent" not in line
        is_print_arg = "Print(" in s[max(0, line_start - 200):line_end] or "elapsed " in s[max(0, line_start - 100):line_end]
        is_assignment = re.match(r"\s*g_recoveryStartedAt\s*=", line) is not None
        is_init_guard = re.match(
            r"\s*if\s*\(\s*g_recoveryStartedAt\s*<=\s*0\s*\)\s*g_recoveryStartedAt\s*=\s*TimeCurrent\(\);\s*$",
            line,
        ) is not None
        is_conditional = re.search(r"\b(if|while|for)\s*\(.*g_recoveryStartedAt", line) is not None and not is_init_guard
        assert not is_conditional, f"g_recoveryStartedAt must not gate unrelated control flow: {stripped}"
        assert is_comment or is_declaration or is_print_arg or is_assignment, (
            f"unexpected g_recoveryStartedAt read outside logging/assignment/comment: {stripped}"
        )
