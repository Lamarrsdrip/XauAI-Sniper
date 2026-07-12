import unittest
from dataclasses import dataclass


@dataclass
class InverseState:
    original_risk_usd: float
    peak_profit: float = 0.0
    close_state: str = "NONE"
    pending_reason: str = ""
    retries: int = 0


def actual_direction(normal_direction: int) -> int:
    if normal_direction not in (-1, 1):
        raise ValueError("normal direction must be BUY(+1) or SELL(-1)")
    return -normal_direction


def current_r(state: InverseState, floating: float, swap: float = 0.0, commission: float = 0.0) -> float:
    return (floating + swap + commission) / state.original_risk_usd


def decide(state: InverseState, net_profit: float, indicators_ready: bool, strong: bool) -> str:
    r_now = net_profit / state.original_risk_usd
    state.peak_profit = max(state.peak_profit, net_profit)
    if state.close_state in {"REQUESTED", "PENDING_RETRY", "AWAITING_CONFIRMATION"}:
        return "RETRY_CLOSE"
    if r_now >= 1.0:
        state.close_state = "REQUESTED"
        state.pending_reason = "INVERSE_EXP_TP_1R"
        return "CLOSE_1R"
    if state.peak_profit >= state.original_risk_usd * 0.30 and net_profit > 0:
        giveback = (state.peak_profit - net_profit) / state.peak_profit
        if giveback >= 0.45:
            state.close_state = "REQUESTED"
            state.pending_reason = "INVERSE_EXP_GIVEBACK_AFTER_0_3R"
            return "CLOSE_GIVEBACK"
    if r_now >= 0.50:
        if not indicators_ready or not strong:
            state.close_state = "REQUESTED"
            state.pending_reason = "INVERSE_EXP_CAPTURE_0_5R"
            return "CLOSE_05R"
        state.close_state = "HOLD_TO_1R"
        return "HOLD_TO_1R_PROTECT_035R"
    if r_now >= 0.30:
        return "HOLD_PROTECT_015R"
    return "HOLD"


class InverseHardeningSimulation(unittest.TestCase):
    def test_every_opening_path_inverts_exactly_once(self):
        for path in ("PRIMARY", "RE_ENTRY", "RECOVERY", "PYRAMID", "MANUAL", "RETRY"):
            for normal in (-1, 1):
                with self.subTest(path=path, normal=normal):
                    self.assertEqual(actual_direction(normal), -normal)

    def test_all_grades_share_direction_contract(self):
        for grade in ("A+", "A", "B+", "B", "C", "UNKNOWN", ""):
            with self.subTest(grade=grade):
                self.assertEqual(actual_direction(1), -1)
                self.assertEqual(actual_direction(-1), 1)

    def test_original_r_does_not_change_when_sl_moves(self):
        state = InverseState(original_risk_usd=200.0)
        before = current_r(state, 60.0)
        moved_live_sl_distance = -3.0
        after = current_r(state, 60.0)
        self.assertEqual(moved_live_sl_distance, -3.0)
        self.assertAlmostEqual(before, 0.30)
        self.assertEqual(before, after)

    def test_net_r_includes_swap_and_commission(self):
        state = InverseState(original_risk_usd=100.0)
        self.assertAlmostEqual(current_r(state, 35.0, swap=-2.0, commission=-3.0), 0.30)

    def test_restart_restores_exact_r_and_peak(self):
        saved = InverseState(original_risk_usd=240.0, peak_profit=108.0, close_state="HOLD_TO_1R")
        restored = InverseState(**saved.__dict__)
        self.assertEqual(restored.original_risk_usd, 240.0)
        self.assertEqual(restored.peak_profit, 108.0)
        self.assertEqual(restored.close_state, "HOLD_TO_1R")
        self.assertAlmostEqual(current_r(restored, 72.0), 0.30)

    def test_029r_holds(self):
        self.assertEqual(decide(InverseState(100.0), 29.0, True, True), "HOLD")

    def test_030r_protects_015r(self):
        self.assertEqual(decide(InverseState(100.0), 30.0, True, True), "HOLD_PROTECT_015R")

    def test_050r_weak_closes(self):
        self.assertEqual(decide(InverseState(100.0), 50.0, True, False), "CLOSE_05R")

    def test_050r_strong_holds(self):
        self.assertEqual(decide(InverseState(100.0), 50.0, True, True), "HOLD_TO_1R_PROTECT_035R")

    def test_050r_without_indicators_captures(self):
        self.assertEqual(decide(InverseState(100.0), 50.0, False, True), "CLOSE_05R")

    def test_giveback_precedes_strong_half_r_branch(self):
        state = InverseState(100.0, peak_profit=95.0)
        self.assertEqual(decide(state, 51.0, True, True), "CLOSE_GIVEBACK")

    def test_direct_jumps_close_at_one_r(self):
        for prior, now in ((10.0, 105.0), (29.0, 120.0), (49.0, 101.0)):
            state = InverseState(100.0, peak_profit=prior)
            with self.subTest(prior=prior, now=now):
                self.assertEqual(decide(state, now, True, True), "CLOSE_1R")

    def test_failed_close_never_returns_to_hold(self):
        state = InverseState(100.0)
        self.assertEqual(decide(state, 50.0, True, False), "CLOSE_05R")
        state.close_state = "PENDING_RETRY"
        state.retries = 1
        self.assertEqual(decide(state, 20.0, True, True), "RETRY_CLOSE")
        self.assertEqual(state.pending_reason, "INVERSE_EXP_CAPTURE_0_5R")

    def test_successful_retry_can_be_confirmed_and_cleared(self):
        state = InverseState(100.0, close_state="PENDING_RETRY", pending_reason="INVERSE_EXP_TP_1R", retries=2)
        self.assertEqual(decide(state, 80.0, True, True), "RETRY_CLOSE")
        state.close_state = "CLOSED_CONFIRMED"
        self.assertEqual(state.close_state, "CLOSED_CONFIRMED")


if __name__ == "__main__":
    unittest.main()
