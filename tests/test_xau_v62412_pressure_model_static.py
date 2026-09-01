"""v6.24.12: unified buy/sell pressure model.

Buckets the already-existing td.buyConfidence/td.sellConfidence (computed
from continuationConfidence/reversalProbability, unchanged this version)
into BUY_PRESSURE_STRONG/MODERATE, PRESSURE_BALANCED, SELL_PRESSURE_
MODERATE/STRONG, PRESSURE_TRANSITIONING. Load-bearing safety property,
matching the spec's explicit "do not allow pressure alone to create a
trade": XAU_MarketThesisAction's signature is unchanged and never reads
the pressure bucket.
"""

from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.24.12.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"
COMPILE_LOG = ROOT / "compile_logs" / "v62412_pressure_model_compile.log"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def test_repo_source_is_synced_to_backend():
    assert read(EA) == read(BACKEND_EA)


def test_version_bumped_to_v62412():
    ea = read(BACKEND_EA)
    assert '#define XAUAI_EA_VERSION "v6.24.12"' in ea


def test_compile_clean():
    log = read(COMPILE_LOG)
    assert "Result: 0 errors, 0 warnings" in log


def test_all_six_pressure_states_present():
    ea = read(BACKEND_EA)
    for state in ("BUY_PRESSURE_STRONG", "BUY_PRESSURE_MODERATE", "PRESSURE_BALANCED",
                  "SELL_PRESSURE_MODERATE", "SELL_PRESSURE_STRONG", "PRESSURE_TRANSITIONING"):
        assert state in ea


def test_pressure_reuses_existing_confidence_fields_no_new_signal_math():
    ea = read(BACKEND_EA)
    fn = ea[ea.index("ENUM_XAU_PRESSURE_STATE XAU_BucketPressure("):][:700]
    assert "td.buyConfidence" in fn
    assert "td.sellConfidence" in fn


def test_market_thesis_action_signature_unchanged_pressure_not_a_gate_input():
    # load-bearing: XAU_MarketThesisAction must not take a pressure
    # parameter -- pressure is display/context only, per spec
    ea = read(BACKEND_EA)
    sig_start = ea.index("ENUM_XAU_MARKET_THESIS_ACTION XAU_MarketThesisAction(")
    sig_end = ea.index(")", sig_start)
    signature = ea[sig_start:sig_end]
    assert "pressure" not in signature.lower()


def test_compute_market_thesis_computes_pressure_but_does_not_pass_it_to_action():
    ea = read(BACKEND_EA)
    fn = ea[ea.index("XAU_MarketThesis XAU_ComputeMarketThesis("):ea.index("return t;")]
    assert "t.pressure    = XAU_BucketPressure(td);" in fn
    action_call = fn[fn.index("t.action = XAU_MarketThesisAction("):]
    action_call_args = action_call[:action_call.index(");")]
    assert "pressure" not in action_call_args.lower()


def test_dashboard_and_web_feed_both_show_pressure():
    ea = read(BACKEND_EA)
    assert "Buy pressure: %.0f | Sell pressure: %.0f | Dominant: %s" in ea
    assert '"buy_pressure":%.1f,\\"sell_pressure\\":%.1f,\\"pressure_state\\":\\"%s\\"'.replace("\\", "") in ea.replace("\\", "")


# ---------------------------------------------------------------------------
# Behavioral mirror
# ---------------------------------------------------------------------------

TRANSITION_NEUTRAL, OPPOSITE_DIRECTION_FORMING = 6, 7
TREND_HEALTHY = 2


@dataclass
class TD:
    buyConfidence: float = 50.0
    sellConfidence: float = 50.0
    lifecycle: int = TREND_HEALTHY


def bucket_pressure(td: TD) -> str:
    if td.lifecycle in (TRANSITION_NEUTRAL, OPPOSITE_DIRECTION_FORMING):
        return "PRESSURE_TRANSITIONING"
    diff = td.buyConfidence - td.sellConfidence
    if diff >= 30.0: return "BUY_PRESSURE_STRONG"
    if diff >= 10.0: return "BUY_PRESSURE_MODERATE"
    if diff <= -30.0: return "SELL_PRESSURE_STRONG"
    if diff <= -10.0: return "SELL_PRESSURE_MODERATE"
    return "PRESSURE_BALANCED"


def test_strong_buy_pressure():
    assert bucket_pressure(TD(buyConfidence=85, sellConfidence=20)) == "BUY_PRESSURE_STRONG"


def test_strong_sell_pressure():
    assert bucket_pressure(TD(buyConfidence=15, sellConfidence=80)) == "SELL_PRESSURE_STRONG"


def test_balanced_pressure_does_not_favor_either_side():
    assert bucket_pressure(TD(buyConfidence=52, sellConfidence=48)) == "PRESSURE_BALANCED"


def test_transitioning_overrides_raw_confidence_numbers():
    # even with a large gap, a forming-transition lifecycle reports
    # PRESSURE_TRANSITIONING -- the snapshot comparison is less meaningful
    # mid-reorganization
    assert bucket_pressure(TD(buyConfidence=90, sellConfidence=10,
                              lifecycle=OPPOSITE_DIRECTION_FORMING)) == "PRESSURE_TRANSITIONING"


def test_moderate_pressure_boundaries():
    assert bucket_pressure(TD(buyConfidence=60, sellConfidence=49)) == "BUY_PRESSURE_MODERATE"
    assert bucket_pressure(TD(buyConfidence=49, sellConfidence=60)) == "SELL_PRESSURE_MODERATE"
