from pathlib import Path

from backend.analytics.xau_attribution_report import build_report


def test_xau_attribution_report_builds_from_memory_csvs(tmp_path: Path):
    executed = tmp_path / "XAUAI_ExecutedTradeBrain_XAUUSD.csv"
    blocked = tmp_path / "XAUAI_BlockedTradeMemory_XAUUSD.csv"
    intel = tmp_path / "XAUAI_TradingIntelligence_XAUUSD.csv"

    executed.write_text(
        "\n".join(
            [
                "event,time,posId,symbol,dir,setup,grade,signature,regime,session,hour,entryPrice,exitPrice,lots,sl,tp,profit,worstFloating,secondsNegative,outcome,exitReason,entryReason,setupScore,combined,atr,aiConfidence",
                "CLOSE,2099.01.01 10:00:00,1,XAUUSD,BUY,TREND_PULLBACK,A+,sig-a,1,LONDON,10,4500,4510,10,4490,4520,5000,-12000,1800,WEAK_RECOVERY_WIN,CLEAN_EXIT,timing,5.2,5.0,5,0",
                "CLOSE,2099.01.01 11:00:00,2,XAUUSD,BUY,TREND_PULLBACK,A+,sig-a,1,LONDON,11,4510,4500,10,4498,4520,-6000,-7000,900,LOSS,CLEAN_EXIT,timing,5.1,4.8,5,0",
                "POST_CLOSE,2099.01.01 11:05:00,1,XAUUSD,BUY,TREND_PULLBACK,A+,sig-a,1,LONDON,11,4500,4520,10,4490,4520,5000,3000,5,EXIT_EARLY_LEFT_PROFIT,EXIT_EARLY_LEFT_PROFIT checkpoint=5m,CLEAN_EXIT,5.2,5.0,5,0",
                "CLOSE,2099.01.01 12:00:00,3,XAUUSD,SELL,RANGE_REVERSAL,B,sig-b,2,NY,12,4520,4510,4,4530,4500,4000,-1000,120,WIN,CLEAN_EXIT,timing,3.8,3.6,4,0",
            ]
        ),
        encoding="utf-8",
    )

    blocked.write_text(
        "\n".join(
            [
                "event,time,symbol,dir,setup,grade,reasonKey,signalPrice,currentPrice,atr,checkpointMin,favATR,advATR,regime,setupScore,combined,extra",
                "BLOCKED,2099.01.01 10:00:00,XAUUSD,BUY,TREND_PULLBACK,A+,BAD-LOCATION,4500,4500,5,0,0,0,1,5.2,5.0,reason",
                "CHECK,2099.01.01 10:30:00,XAUUSD,BUY,TREND_PULLBACK,A+,BAD-LOCATION,4500,4515,5,30,3.0,0.5,1,5.2,5.0,wouldTP2R=Y",
                "CHECK,2099.01.01 11:00:00,XAUUSD,BUY,TREND_PULLBACK,A+,BAD-LOCATION,4500,4520,5,60,4.0,0.5,1,5.2,5.0,wouldTP2R=Y",
                "BLOCKED,2099.01.01 10:01:00,XAUUSD,BUY,TREND_PULLBACK,A+,SPREAD,4500,4500,5,0,0,0,1,5.2,5.0,reason",
            ]
        ),
        encoding="utf-8",
    )

    intel.write_text(
        "\n".join(
            [
                "schema,event,time,symbol,decisionId,posId,dir,setup,grade,signature,regime,session,hour,owner,action,reasonKey,setupScore,combined,atr,price,entryPrice,exitPrice,lots,sl,tp,profit,worstFloating,secondsNegative,checkpointMin,favATR,advATR,entryReason,exitReason,cloudSignalId,cloudCode,cloudOk,extra",
                "xauai_trading_intelligence_v1,CLOSE,2099.01.01 11:00:00,XAUUSD,2,2,BUY,TREND_PULLBACK,A+,sig-a,1,LONDON,11,EXIT,CLOSE,CLEAN_EXIT,5.1,4.8,5,4500,4510,4500,10,4498,4520,-6000,-7000,900,0,0,0,late missed move,CLEAN_EXIT,,0,Y,",
                "xauai_trading_intelligence_v1,BLOCK_CHECK,2099.01.01 10:30:00,XAUUSD,b1,0,BUY,TREND_PULLBACK,A+,sig-a,1,LONDON,10,BLOCKED_OUTCOME,CHECK,BAD-LOCATION,5.2,5.0,5,4515,4500,0,0,0,0,0,0,0,30,3.0,0.5,blockedSignal,,,0,Y,wouldTP2R=Y",
                "xauai_trading_intelligence_v1,POST_CLOSE,2099.01.01 11:05:00,XAUUSD,1,1,BUY,TREND_PULLBACK,A+,sig-a,1,LONDON,11,EXIT_BRAIN,POST_CLOSE,EXIT_EARLY_LEFT_PROFIT,5.2,5.0,5,4520,4500,4520,10,4490,4520,5000,3000,5,5,0,0,timing,EXIT_EARLY_LEFT_PROFIT checkpoint=5m,,0,Y,EXIT_EARLY_LEFT_PROFIT",
                "xauai_trading_intelligence_v1,CLOUD_SIGNAL,2099.01.01 11:06:00,XAUUSD,sig-cloud,0,BUY,,,,1,LONDON,11,CLOUD,SIGNAL_POST,CLOUD_SIGNAL_POST_FAILED,0,0,0,4500,4500,0,10,4490,4520,0,0,0,0,0,0,,cloud signal POST failed,,500,N,err=timeout",
            ]
        ),
        encoding="utf-8",
    )

    report = build_report(executed, blocked, days=7, intel_path=intel)

    assert "XAUAI Weekly Attribution Report" in report
    assert "Trading Intelligence Dataset QA" in report
    assert "Signal Grade Validation" in report
    assert "Blocked Trade Intelligence" in report
    assert "A/A+ losing trades: 1" in report
    assert "Profitable blocked trades: 1" in report
    assert "Late/missed-move executed trades: 1" in report
    assert "Cloud copy/fanout failures: 1" in report
    assert "BAD-LOCATION" in report
    assert "EXIT_EARLY_LEFT_PROFIT" in report
    assert "TREND_PULLBACK" in report
