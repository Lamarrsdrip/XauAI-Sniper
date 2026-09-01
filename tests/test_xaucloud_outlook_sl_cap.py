"""Focused static/pure regressions for the shared $10 execution SL ceiling."""
from pathlib import Path


EA = (Path(__file__).resolve().parents[1] / "backend" / "ea_code" / "XauCloud.io.mq5").read_text(encoding="utf-8")


def capped_sl(entry: float, requested: float, direction: int) -> float:
    return max(requested, entry - 10.0) if direction == 1 else min(requested, entry + 10.0)


def test_outlook_and_normal_stop_examples_use_the_same_cap():
    assert capped_sl(4350.0, 4335.0, 1) == 4340.0
    assert capped_sl(4350.0, 4365.0, -1) == 4360.0
    assert capped_sl(4350.0, 4340.0, 1) == 4340.0
    assert capped_sl(4350.0, 4360.0, -1) == 4360.0
    assert capped_sl(4350.0, 4345.0, 1) == 4345.0


def test_canonical_cap_covers_outlook_entry_postfill_and_later_modifications():
    assert "#define XAU_MAX_GOLD_SL_MOVE 10.0" in EA
    assert "double XAU_ClampGoldStopToMaxDistance(double referencePrice, double proposedSL, int direction)" in EA
    open_trade = EA[EA.index("bool OpenTrade("):EA.index("void LogExit(")]
    assert "sl = XAU_ClampGoldStopToMaxDistance(price, requestedOutlookSL, signal);" in open_trade
    assert "? XAU_ClampGoldStopToMaxDistance(confirmedOpen, explicitSL, signal)" in open_trade
    modify = EA[EA.index("bool SafeModifySL("):EA.index("double StrategyReferenceBalance()")]
    assert "XAU_ClampGoldStopToMaxDistance(actualEntry, newSL, isBuy ? 1 : -1)" in modify
    pending = EA[EA.index("void XAU_ProcessPendingOutlook()"):EA.index("void BotMonitorPollCommands()")]
    assert "outlookSL = XAU_ClampGoldStopToMaxDistance(price, outlookSL, dir);" in pending
    assert "g_pendingOutlook.outlookSL     = oEffectiveSL;" in EA


def test_safe_tick_rounding_cannot_widen_beyond_the_boundary():
    assert "MathCeil(price / tickSize" in EA
    assert "MathFloor(price / tickSize" in EA


def test_fallback_outlook_zone_uses_the_same_customer_visible_cap():
    confidence = (Path(__file__).resolve().parents[1] / "backend_node" / "src" / "services" / "marketOutlookConfidence.ts").read_text(encoding="utf-8")
    assert "sl = clampGoldStopToMaxDistance(midEntry, sl, direction);" in confidence
