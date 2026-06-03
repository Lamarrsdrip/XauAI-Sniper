from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def test_report_fit_scout_controls_exist():
    text = EA.read_text()

    assert "v5.8.41" in text
    assert "InpBlockedMemoryScoutEnable" in text
    assert "InpBlockedMemoryScoutLotMulti = 0.22" in text
    assert "XAU_BlockedMemoryEdgeSupportsScout" in text
    assert "REPORT-FIT SCOUT" in text


def test_hot_cycle_b_grade_risk_cut_exists():
    text = EA.read_text()

    assert "InpXAU_CycleBGradeDeepGainPct" in text
    assert "InpXAU_CycleBGradeLotMulti" in text
    assert "REPORT-FIT B-CYCLE CUT" in text
    assert 'grade == "B" && dayGainPct >= InpXAU_CycleBGradeDeepGainPct' in text
