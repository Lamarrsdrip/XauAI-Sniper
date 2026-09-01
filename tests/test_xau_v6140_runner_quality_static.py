from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.14.0.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def body(src: str, name: str) -> str:
    start = src.index(name)
    brace = src.index("{", start)
    depth = 0
    for i in range(brace, len(src)):
        if src[i] == "{":
            depth += 1
        elif src[i] == "}":
            depth -= 1
            if depth == 0:
                return src[start : i + 1]
    raise AssertionError(f"Could not find body for {name}")


def test_current_release_source_is_synced_to_download_file():
    ea = read(EA)
    backend = read(BACKEND_EA)
    assert ea == backend
    assert '#define XAUAI_EA_VERSION "v6.14.0"' in ea
    assert "v6140-24h-runner-quality-htf-location-20260706" in ea


def test_runner_conviction_hold_widens_floor_only_with_trend_room_proof():
    ea = read(EA)
    smart_exit = body(ea, "bool XAU_SmartExit3Layer")
    assert "InpRunnerConvictionHoldEnable" in ea
    assert "XAU_RunnerContinuationRoomATR" in ea
    assert "XAU_RunnerConvictionActive" in ea
    assert "runnerConvictionHold" in smart_exit
    assert "RUNNER_CONVICTION_HOLD" in smart_exit
    assert "lockPct = MathMin(lockPct" in smart_exit
    assert "InpRunnerConvictionGivebackPct" in smart_exit
    assert "thesisHoldAllowed = true;" in smart_exit


def test_basket_hard_cap_can_defer_full_close_for_valid_runner():
    ea = read(EA)
    basket = body(ea, "bool ManageBasket")
    helper = body(ea, "bool XAU_BasketRunnerConvictionActive")
    assert "BASKET_RUNNER_CONVICTION_HOLD" in basket
    assert "XAU_BasketRunnerConvictionActive" in basket
    assert "XAU_BasketStructureBroken(basketDir)" in helper
    assert "roomATR >= InpRunnerConvictionMinRoomATR" in helper
    assert "g_basketFloorUSD = MathMax(1.0, g_basketPeakUSD * InpRunnerConvictionFloorPct / 100.0)" in basket


def test_htf_trend_follow_requires_location_quality_not_direction_alone():
    ea = read(EA)
    score = body(ea, "int ScoreSetups(double &score, string &setupName)")
    assert "InpHTFTrendFollowRequireValueRetest" in ea
    assert "InpHTFTrendFollowMaxEMADistanceATR" in ea
    assert "valueRetestTrigger" in score
    assert "structureMomentumTrigger" in score
    assert "newsMomentumTrigger" in score
    assert "htfEntryQualityTrigger" in score
    assert "hasRealTrigger = (hasRealTrigger && htfEntryQualityTrigger)" in score


def test_strong_momentum_override_can_help_htf_without_becoming_a_blanket_bypass():
    ea = read(EA)
    precheck = body(ea, "bool XAU_BasicStrongMomentumPrecheck")
    allowed = body(ea, "bool XAU_StrongMomentumOverrideAllowed")
    assert 'StringFind(setupName, "HTF_TREND_FOLLOW") >= 0' in precheck
    assert 'StringFind(setupName, "HTF_TREND_FOLLOW") >= 0' in allowed
    assert "STRONG_MOMENTUM_OVERRIDE rejected: HTF consensus is hostile" in allowed
    assert "roomOk" in allowed and "riskOk" in allowed


def test_adaptive_news_fast_track_still_requires_confirmation_and_rr():
    ea = read(EA)
    news = body(ea, "bool XAU_EvaluateAdaptiveNewsMomentumEntry")
    assert "InpAdaptiveNewsFastTrackM15" in ea
    assert "strongImpulseFastTrack" in news
    assert "m15MomentumAccepted" in news
    assert "NEWS_OBSERVING: continuation not confirmed yet" in news
    assert "minNewsRR" in news
    assert "NEWS_ENTRY_BLOCKED_POOR_RR" in news
    assert "NEWS_ENTRY_ALLOWED" in news


def test_forward_report_floating_stats_update_every_tick():
    ea = read(EA)
    on_tick = body(ea, "void OnTick")
    stats = body(ea, "void XAU_UpdateForwardFloatingStats")
    assert "XAU_UpdateForwardFloatingStats();" in on_tick
    assert "AccountInfoDouble(ACCOUNT_PROFIT)" in stats
    assert "g_ftReport_MaxFloat" in stats
    assert "g_ftReport_MaxFav" in stats
    assert "g_ftReport_MaxDD" in stats
