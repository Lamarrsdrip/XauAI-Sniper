"""Executable deterministic mirror of the v6.25.9 owner R-exit policy.

This harness is deliberately small: it models persisted peak/floor/profile
state, restart round-trips, campaign inheritance, and the single close
decision. It does not invent indicators or trading decisions.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass


GENERAL = "GENERAL"
TREND_UP = "TREND_UP"
OWNER_CLOSE = "OWNER_R_EXIT_FLOOR_BREACH"
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


def required_floor(peak_r: float, profile: str) -> float:
    if profile == TREND_UP:
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
        return authority == OWNER_CLOSE and self.floor_r > 0.0 and current_r >= self.floor_r

    def restart(self) -> "OwnerState":
        return OwnerState(**asdict(self))

    def inherited_leg(self) -> "OwnerState":
        return OwnerState(profile=self.profile, peak_r=self.peak_r, floor_r=self.floor_r)
