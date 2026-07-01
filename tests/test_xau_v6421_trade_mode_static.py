from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.4.21.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"
REPORT = ROOT / "test_reports" / "xau_v6_4_21_forensic_performance_comparison_2026-07-01.md"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def test_v6421_release_identity_and_download_source_are_synced():
    ea = read(EA)
    backend = read(BACKEND_EA)

    assert ea == backend
    assert "v6.4.21" in ea[:1200]
    assert "Trade Mode + June 17-19 Balance Lot Restore" in ea[:1200]
    assert '#property version   "6.421"' in ea
    assert '#property version   "6.4.21"' not in ea
    assert '#define XAUAI_EA_VERSION "v6.4.21"' in ea
    assert '#define XAUAI_EA_VERSION_NUM "6.4.21"' in ea
    assert '#define XAUAI_BUILD_HASH "v6421-trade-mode-fear-cage-audit-20260701"' in ea


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
