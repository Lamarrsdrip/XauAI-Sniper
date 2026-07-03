from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
EA_ROOT = ROOT / "XAUUSD_AI_Sniper_EA_v6.11.0.mq5"
EA_BACKEND = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_v6412_version_and_backend_copy_match():
    root = read(EA_ROOT)
    backend = read(EA_BACKEND)

    assert root == backend
    assert '#property version   "6.110"' in root
    assert '#define XAUAI_EA_VERSION "v6.11.0"' in root
    assert '#define XAUAI_EA_VERSION_NUM "6.11.0"' in root


def test_trend_continuation_inputs_and_helpers_exist():
    ea = read(EA_ROOT)

    for token in (
        "InpXAU_TrendContinuationMode",
        "InpXAU_TCM_MinTrendScore",
        "InpXAU_TCM_MinRemainingRoomATR",
        "InpXAU_TCM_LotMulti",
        "InpXAU_TCM_NewsFastTrack",
        "InpXAU_TCM_MemoryMinMissedProfitATR",
        "XAU_EstimatedContinuationRoomATR",
        "XAU_TrendContinuationScore",
        "XAU_NewsAftermathCanFastTrack",
        "XAU_BlockedContinuationMissedProfitBias",
    ):
        assert token in ea


def test_broker_noise_does_not_arm_news_aftermath_pause():
    ea = read(EA_ROOT)
    tick = ea[ea.index("void OnTick()"):]
    spread_start = tick.index("string spreadEventType = \"NORMAL\";")
    spread_end = tick.index("if(g_postNewsState == PNS_AFTERMATH", spread_start)
    spread_logic = tick[spread_start:spread_end]

    for token in (
        "InpNewsAftermathArmMulti",
        "InpNewsAftermathIgnoreBrokerNoise",
        "BROKER-SPREAD-NOISE",
        "no NEWS_AFTERMATH timer armed",
    ):
        assert token in ea

    assert 'spreadEventType = "BROKER_NOISE"' in spread_logic
    assert re.search(r'if\s*\(\s*InpNewsAftermathIgnoreBrokerNoise\s*&&\s*spreadEventType\s*==\s*"BROKER_NOISE"\s*\)\s*aftermathArmEvent\s*=\s*false', spread_logic)
    assert "spreadEventType == \"NEWS_SPIKE\"" in spread_logic
    assert "scheduledNewsNow" in spread_logic
    assert "spread >= InpMaxSpread * 1.50" in spread_logic


def test_bad_rr_uses_remaining_room_and_continuation_qualification():
    ea = read(EA_ROOT)
    guard = ea[ea.index("bool XAUEntryTimingGuard"):ea.index("// v5.3.0 — master pre-trade gate aggregator")]

    assert "estimatedContinuationRoomATR" in guard
    assert re.search(r"directionalRoomATR\s*=\s*MathMax\s*\(\s*directionalRoomATR\s*,\s*estimatedContinuationRoomATR", guard)
    assert "trendContinuationQualified" in guard
    assert re.search(r"bool\s+aBadRR\s*=.*!trendContinuationQualified", guard, re.S)
    assert "BAD-RR TRUE BLOCK" in guard
    assert "CONTINUATION QUALIFIED" in guard


def test_missed_move_and_post_sweep_trigger_qualification_not_auto_block():
    ea = read(EA_ROOT)
    guard = ea[ea.index("bool XAUEntryTimingGuard"):ea.index("// v5.3.0 — master pre-trade gate aggregator")]

    assert "continuationCandidate" in guard
    assert re.search(r"missedMove.*continuationCandidate|continuationCandidate.*missedMove", guard, re.S)
    assert re.search(r"postSweepTrap.*continuationCandidate|continuationCandidate.*postSweepTrap", guard, re.S)
    assert "TRUE-LATE BLOCK" in guard
    assert "TRUE-EXHAUSTION BLOCK" in guard
    assert re.search(r"if\s*\(\s*extensionNoReset\s*&&\s*!trendContinuationQualified\s*\)", guard)
    assert re.search(r"if\s*\(\s*locationBlock\s*&&\s*!trendContinuationQualified\s*\)", guard)


def test_clean_continuation_accepts_breakdown_or_breakout_structure():
    ea = read(EA_ROOT)
    guard = ea[ea.index("bool XAUEntryTimingGuard"):ea.index("// v5.3.0 — master pre-trade gate aggregator")]

    assert "structureContinuationCandidate" in guard
    assert "freshStructureBreak" in guard
    assert re.search(r"cleanContinuation\s*=.*structureContinuationCandidate", guard, re.S)
    assert "clean-breakdown" in guard or "clean-breakout" in guard


def test_news_aftermath_fast_track_and_blocked_memory_feedback():
    ea = read(EA_ROOT)

    assert "POST_NEWS_FAST_TRACK" in ea
    assert re.search(r"spreadBlocksEntry.*XAU_NewsAftermathCanFastTrack", ea, re.S)
    assert "BLOCKED-CONTINUATION MEMORY" in ea
    assert "BLOCK_MISSED_PROFIT" in ea
    assert "Use only in aggregate" in ea


def test_broker_noise_no_longer_arms_fake_news_aftermath():
    ea = read(EA_ROOT)

    assert "InpNewsAftermathArmMulti" in ea
    assert "InpNewsAftermathIgnoreBrokerNoise" in ea
    assert "BROKER-SPREAD-NOISE" in ea
    assert "no NEWS_AFTERMATH timer armed" in ea
    assert re.search(r"spreadEventType\s*==\s*\"BROKER_NOISE\".*aftermathArmEvent\s*=\s*false", ea, re.S)
