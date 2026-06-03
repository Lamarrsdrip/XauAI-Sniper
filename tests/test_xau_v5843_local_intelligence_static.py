from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def test_trading_intelligence_dataset_build_controls_exist():
    text = EA.read_text()

    assert "v5.8.43" in text
    assert "LOCAL INTELLIGENCE READY" in text
    assert "InpTradingIntelDataset" in text
    assert "InpTradingIntelJson" in text
    assert "XAUAI_TradingIntelligence_" in text
    assert "xauai_trading_intelligence_v1" in text
    assert "XAU_IntelAppend(" in text
    assert "XAU_IntelAppendJson" in text
    assert "XAU_LogTradingIntelStartupHealth" in text
    assert '"DATASET_READY"' in text


def test_cloud_is_optional_and_not_baked_into_local_master():
    text = EA.read_text()

    assert "InpCloudFanout       = false" in text
    assert 'InpCloudAgentToken   = ""' in text


def test_trade_block_exit_and_cloud_events_feed_intelligence_dataset():
    text = EA.read_text()

    assert 'XAU_IntelAppend(eventName, (string)r.posId' in text
    assert '"BLOCK_CHECK"' in text
    assert '"CLOUD_SIGNAL"' in text
    assert '"CLOUD_CLOSE"' in text
    assert '"CLOUD_PARTIAL"' in text
    assert '"CLOUD_SIGNAL_POST_FAILED"' in text


def test_report_fit_scout_controls_still_exist():
    text = EA.read_text()

    assert "InpBlockedMemoryScoutEnable" in text
    assert "InpBlockedMemoryScoutLotMulti = 0.22" in text
    assert "XAU_BlockedMemoryEdgeSupportsScout" in text
    assert "REPORT-FIT SCOUT" in text
