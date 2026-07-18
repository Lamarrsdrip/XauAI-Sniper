"""Executable deterministic mirror of the v6.25.12 owner R-exit policy.

This harness is deliberately small: it models persisted peak/floor/profile
state, restart round-trips, profile-only campaign inheritance, and the
canonical R-manager close decisions. It does not invent indicators or
trading decisions.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass


GENERAL = "GENERAL"
BREAKOUT = "BREAKOUT"
OWNER_CLOSE = "OWNER_R_EXIT_FLOOR_BREACH"
OWNER_TP_1R = "OWNER_R_EXIT_TP_1R"
OWNER_GIVEBACK_45 = "OWNER_R_EXIT_GIVEBACK_45"
OWNER_RUNNER_FAILED = "OWNER_R_EXIT_RUNNER_CONTINUATION_FAILED"
BREAKOUT_BLOCK = "BLOCK"
BREAKOUT_NORMAL = "NORMAL"
BREAKOUT_INVERSE = "INVERSE"
BREAKOUT_REGIMES = {"BRKT_UP", "BRKT_DN"}


def execution_direction(approved_signal: int, regime: str, mode: str) -> int | None:
    if regime in BREAKOUT_REGIMES and mode == BREAKOUT_BLOCK:
        return None
    if regime in BREAKOUT_REGIMES and mode == BREAKOUT_INVERSE:
        return -approved_signal
    return approved_signal


def exit_profile_for_regime(regime: str) -> str:
    return BREAKOUT if regime in BREAKOUT_REGIMES else GENERAL


def required_floor(peak_r: float, profile: str) -> float:
    if profile == BREAKOUT:
        if peak_r < 0.50:
            return 0.0
        if peak_r < 0.70:
            return 0.40
        return max(0.40, peak_r * 0.70)
    if peak_r < 0.40:
        return 0.0
    if peak_r < 0.50:
        return 0.30
    return max(0.30, peak_r * 0.70)


def strict_pyramid_gate(
    *,
    core_floor_confirmed: bool,
    direction_ok: bool,
    opposite_direction_present: bool,
    structure_ok: bool,
    pressure_ok: bool,
    timing_ok: bool,
    exhaustion_ok: bool,
    margin_ok: bool,
) -> tuple[bool, str]:
    checks = (
        (core_floor_confirmed, "CORE_FLOOR_NOT_CONFIRMED"),
        (direction_ok, "DIRECTION_NOT_CURRENTLY_APPROVED"),
        (not opposite_direction_present, "OPPOSITE_DIRECTION_FORMING_OR_CONFIRMED"),
        (structure_ok, "STRUCTURE_OPPOSES"),
        (pressure_ok, "PRESSURE_OPPOSES"),
        (timing_ok, "TIMING_OR_LOCATION_LATE_CHASE"),
        (exhaustion_ok, "EXHAUSTION_HIGH_OR_EXTREME"),
        (margin_ok, "MARGIN_50_PERCENT_BUFFER"),
    )
    for passed, reason in checks:
        if not passed:
            return False, reason
    return True, "PYRAMID_GATE_APPROVED"


@dataclass
class OwnerState:
    profile: str
    peak_r: float = 0.0
    floor_r: float = 0.0

    def observe(self, current_r: float) -> float:
        self.peak_r = max(self.peak_r, current_r)
        self.floor_r = max(self.floor_r, required_floor(self.peak_r, self.profile))
        return self.floor_r

    def close_allowed(self, current_r: float, authority: str) -> bool:
        floor_safe = self.floor_r <= 0.0 or current_r >= self.floor_r
        if authority == OWNER_CLOSE:
            return self.floor_r > 0.0 and floor_safe
        if authority == OWNER_TP_1R:
            return current_r >= 1.0 and floor_safe
        if authority == OWNER_GIVEBACK_45:
            return self.peak_r >= 0.30 and current_r > 0.0 and floor_safe
        if authority == OWNER_RUNNER_FAILED:
            return self.floor_r > 0.0 and floor_safe
        return False

    def restart(self) -> "OwnerState":
        return OwnerState(**asdict(self))

    def inherited_leg(self) -> "OwnerState":
        # New legs inherit the frozen profile, not another entry geometry's
        # peak/floor. A legacy basket-money floor cannot be transplanted.
        return OwnerState(profile=self.profile)
