from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.12.0.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def body(ea: str, start: str, end: str = "\n}\n") -> str:
    pos = ea.index(start)
    return ea[pos : ea.index(end, pos) + len(end)]


def test_v6100_version_labels_and_download_source_are_current():
    ea = read(EA)

    assert 'v6.12.0 - CALIBRATED ENTRY + SMARTER RUNNERS' in ea
    assert '#property version   "6.120"' in ea
    assert '#define XAUAI_EA_VERSION "v6.12.0"' in ea
    assert '#define XAUAI_EA_VERSION_NUM "6.12.0"' in ea
    assert '#define XAUAI_BUILD_HASH "v6120-calibrated-entry-runners-20260703"' in ea
    assert 'v6.10.0 CHANGES (2026-07-02) — ADAPTIVE NEWS MOMENTUM ENGINE' in ea  # preserve the previous line's news-engine fixes in the changelog.
    assert "v6.9.0" in ea  # preserve the previous line's live-feed fixes in the changelog.
    assert read(EA) == read(BACKEND_EA)


def test_news_engine_has_four_phases_and_named_command_center_reasons():
    ea = read(EA)

    assert "enum ENUM_ADAPTIVE_NEWS_PHASE" in ea
    for token in (
        "ANP_PRE_NEWS",
        "ANP_RELEASE_COOLDOWN",
        "ANP_POST_INTERPRETATION",
        "ANP_CONTINUATION_ALLOWED",
        "NEWS_PROTECTION",
        "NEWS_RELEASE_COOLDOWN",
        "NEWS_OBSERVING",
        "NEWS_CONTINUATION_CONFIRMED",
        "NEWS_ENTRY_BLOCKED_OVEREXTENDED",
        "NEWS_ENTRY_BLOCKED_SPREAD",
        "NEWS_ENTRY_BLOCKED_POOR_RR",
        "NEWS_ENTRY_ALLOWED",
    ):
        assert token in ea

    assert "XAU_AdaptiveNewsCalendarPhase(" in ea
    assert "XAU_UpdateAdaptiveNewsPhase(" in ea
    assert "XAU_EvaluateAdaptiveNewsMomentumEntry(" in ea


def test_scheduled_news_is_not_a_binary_calendar_block_after_release_cooldown():
    ea = read(EA)
    on_tick = body(ea, "void OnTick()")

    assert "XAU_UpdateAdaptiveNewsPhase" in on_tick
    assert "NEWS_PROTECTION: waiting before event" in on_tick
    assert "NEWS_RELEASE_COOLDOWN: observing first impulse" in on_tick
    assert "NEWS_OBSERVING:" in on_tick
    assert "scheduled high-impact window still active" not in body(ea, "bool XAU_NewsAftermathCanFastTrack(")

    # Calendar still protects pre-news/release, but post-release interpretation
    # is handled by the adaptive momentum gate after a real signal exists.
    assert "if(adaptiveNewsHardBlock)" in on_tick
    assert "XAU_EvaluateAdaptiveNewsMomentumEntry(signal, setupName, grade, combinedScore, adaptiveNewsWhy)" in on_tick


def test_adaptive_news_momentum_requires_confirmation_and_blocks_chasing():
    ea = read(EA)
    evaluator = body(ea, "bool XAU_EvaluateAdaptiveNewsMomentumEntry(")

    for required in (
        "XAU_NewsImpulseSnapshot",
        "spreadNormal",
        "impulseDir != signal",
        "heldMidpoint",
        "m5Momentum",
        "m15Momentum",
        "htfAligned",
        "extensionATR > InpAdaptiveNewsMaxExtensionATR",
        "roomATR < InpAdaptiveNewsMinRoomATR",
        "rr < InpAdaptiveNewsMinRR",
        "NEWS_ENTRY_BLOCKED_OVEREXTENDED",
        "NEWS_ENTRY_BLOCKED_SPREAD",
        "NEWS_ENTRY_BLOCKED_POOR_RR",
        "NEWS_ENTRY_ALLOWED",
    ):
        assert required in evaluator

    assert "return false;" in evaluator
    assert "return true;" in evaluator


def test_post_news_risk_multiplier_is_applied_after_grade_floor():
    ea = read(EA)

    assert "input double InpAdaptiveNewsRiskMult" in ea
    assert "input double InpAdaptiveNewsHighConfRiskMult" in ea
    assert "g_adaptiveNewsLotMulti" in ea
    after_floor = ea.index("finalSzMult after  enforcement")
    risk_apply = ea.index("finalSzMult *= g_adaptiveNewsLotMulti")
    assert risk_apply > after_floor
    assert "NEWS_POST_RISK" in ea
