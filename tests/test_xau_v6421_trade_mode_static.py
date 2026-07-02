from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.7.0.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"
REPORT = ROOT / "test_reports" / "xau_v6_4_21_forensic_performance_comparison_2026-07-01.md"

# v6.5.0 (audit bug #11): the release-identity test that used to live here
# (asserting exact v6.4.21 header/version/build-hash strings) is now
# permanently obsolete — those strings only ever existed in that one
# release. Each release's own identity is verified by its own dedicated
# test file (see test_xau_v6425_phase1_exit_defects_static.py). The two
# functional tests below (June balance lot mode, aggressive-growth B-grade
# handling) test enduring behavior and are kept.


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def test_june_17_19_balance_lot_mode_is_default_and_logs_breakdown():
    ea = read(EA)

    assert "enum ENUM_XAU_LOT_SIZING_MODE { REAL_RISK_MODE=0, JUNE_16_19_BALANCE_MODE=1 };" in ea
    assert "input ENUM_XAU_LOT_SIZING_MODE InpLotSizingMode = JUNE_16_19_BALANCE_MODE" in ea
    assert "InpJuneBalanceLotPer1000" in ea
    assert "juneBaseLot = (balance / 1000.0) * InpJuneBalanceLotPer1000 * juneGradeMult" in ea
    assert "LOT_MODE=JUNE_16_19_BALANCE_MODE | balance=$%.2f | grade=%s" in ea
    assert "Growth Guard lot cap bypassed by lot mode" in ea
    assert "PYRAMID LOT_MODE=JUNE_16_19_BALANCE_MODE | risk caps bypassed" in ea
    assert "capApplied=%s" in ea


def test_aggressive_growth_allows_clean_b_grade_context_instead_of_blind_blocking():
    ea = read(EA)

    assert "enum ENUM_XAU_TRADE_MODE { SAFE_MODE=0, BALANCED_MODE=1, AGGRESSIVE_GROWTH_MODE=2 };" in ea
    assert "bool XAU_ModeAllowsAggressiveB()" in ea
    assert "return (InpTradeMode == AGGRESSIVE_GROWTH_MODE);" in ea
    assert 'if(grade == "B" && XAU_ModeAllowsAggressiveB() && combinedScore >= 4.20) return true;' in ea
    assert "Aggressive Growth allowed B-grade after fast-confirm warning" in ea
    assert "AGGRESSIVE_GROWTH B-TIMING WARNING" in ea
    assert "AGGRESSIVE_GROWTH BAD-LOCATION WARNING" in ea
    assert "SMART-GUARD WARNING" in ea


def test_forensic_comparison_uses_june_17_19_and_proves_hybrid_choice():
    report = read(REPORT)

    assert "Period A: 2026.06.17 through 2026.06.19" in report
    assert "June 16 was a big account" in report
    assert "| Net profit | -$122,126.01 | +$348.88 | -$264.90 |" in report
    assert "| Profit factor | 0.01 | 1.88 | 0.71 |" in report
    assert "Hybrid strategy is the correct path" in report


def test_compile_log_reports_zero_errors_and_warnings():
    log = read(ROOT / "test_reports" / "metaeditor_v6421.log")
    assert re.search(r"Result:\s+0 errors,\s+0 warnings", log), log[-1000:]
