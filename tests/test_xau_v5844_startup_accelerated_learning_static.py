from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def test_trading_intelligence_dataset_build_controls_exist():
    text = EA.read_text()

    assert "v5.8.50" in text
    assert "InpBotMonitorEnable" in text
    assert "InpTradingIntelDataset" in text
    assert "InpTradingIntelJson" in text
    assert "InpMarketIntelSnapshots" in text
    assert "InpStartupIntelSync" in text
    assert "XAUAI_TradingIntelligence_" in text
    assert "xauai_trading_intelligence_v1" in text
    assert "XAU_IntelAppend(" in text
    assert "XAU_IntelAppendJson" in text
    assert "XAU_LogTradingIntelStartupHealth" in text
    assert "XAU_RunStartupIntelligenceSync" in text
    assert "XAU_RecordMarketSnapshot" in text
    assert '"DATASET_READY"' in text
    assert '"STARTUP_SYNC"' in text
    assert '"MARKET_SNAPSHOT"' in text


def test_accelerated_learning_mode_is_fast_but_low_risk():
    text = EA.read_text()

    assert "InpAcceleratedLearningMode" in text
    assert "InpAccelLearningMinHours" in text and "= 24" in text
    assert "InpAccelLearningMinObs" in text and "= 50" in text
    assert "InpAccelLearningMaxScoreAdj" in text and "= 0.25" in text
    assert "XAU_AcceleratedLearningAdjust" in text
    assert '"ACCEL_LEARNING"' in text
    assert "LOW_RISK_SCORE_ONLY" in text
    assert "does not change lot, SL, TP, max risk, drawdown, or emergency locks" in text


def test_startup_sync_uses_soft_context_target_not_four_hour_delay():
    text = EA.read_text()

    assert "contextCriticalOk = (barsM5 >= 100)" in text
    assert "contextTargetMet" in text
    assert "does not wait for 4h shadow outcomes" in text
    assert "InpStartupIntelMinCandles     = 200" in text


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
