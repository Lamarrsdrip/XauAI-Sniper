"""Functional tests for the AI Thought Engine (backend/server.py's narrative
translation layer for the redesigned Trading-page conversational feed).

backend/server.py requires MONGO_URL/DB_NAME at import time and connects to
live infra elsewhere in the module, so — consistent with this repo's
established static-testing convention — we extract just the pure,
side-effect-free narrative functions by source range and exec them in an
isolated namespace. This still gives real functional coverage (calling the
actual functions with real inputs and checking real outputs), not just
string-matching, without needing a database or API keys."""
import re
from pathlib import Path
from typing import List, Dict, Any

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "backend" / "server.py"

_START_MARKER = "_REGIME_PHRASES = {"
_END_MARKER = 'return {"answer": "YES", "reason": "Thesis still holds at current confidence."}'


def _load_narrative_engine():
    src = SERVER.read_text(encoding="utf-8", errors="ignore")
    start = src.index(_START_MARKER)
    end = src.index(_END_MARKER, start) + len(_END_MARKER)
    snippet = src[start:end]
    ns: Dict[str, Any] = {"re": re, "List": List, "Dict": Dict}
    exec(compile(snippet, "ai_thought_engine_extract", "exec"), ns)
    return ns


ENGINE = _load_narrative_engine()


def _event(**kw):
    base = {
        "id": "e1", "ts": "2026-07-02T09:10:00+00:00", "ticket": "", "event_type": "INFO",
        "event_category": "info", "severity": "INFO", "module": "", "decision": "", "reason": "",
        "blocked_by": "", "allowed": None, "mode": "", "market_bias": "", "signal_direction": "",
        "ai_confidence": None, "score": None, "symbol": "XAUUSD", "message": "", "profit": None,
        "close_reason_exact": "", "position_direction": "", "grade": "", "details": {},
    }
    base.update(kw)
    return base


def test_bias_word_maps_directions_correctly():
    fn = ENGINE["_ai_bias_word"]
    assert fn("+1") == "Bullish"
    assert fn("BUY") == "Bullish"
    assert fn("-1") == "Bearish"
    assert fn("SELL") == "Bearish"
    assert fn("") == ""
    assert fn(None) == ""


def test_reason_clauses_split_dedupe_and_cap():
    fn = ENGINE["_ai_split_reason_clauses"]
    out = fn("HTF trend aligned; London momentum increasing; Fresh BOS confirmed",
              "HTF trend aligned. Risk acceptable.")
    assert "HTF trend aligned" in out
    assert out.count("HTF trend aligned") == 1  # deduped even though it appeared in both texts
    assert "London momentum increasing" in out
    assert "Risk acceptable" in out
    assert len(out) <= 6


def test_classify_card_type_from_event_shape():
    classify = ENGINE["_ai_classify_card_type"]
    assert classify(_event(event_category="entries", event_type="TRADE_EXECUTED", ticket="123")) == "TRADE_EXECUTED"
    assert classify(_event(event_category="exits", event_type="EXIT", ticket="123")) == "TRADE_CLOSED"
    assert classify(_event(event_category="blocks", allowed=False)) == "TRADE_BLOCKED"
    assert classify(_event(allowed=False, event_type="RISK_CHECK")) == "TRADE_BLOCKED"
    assert classify(_event(event_category="ai", event_type="AI_DIRECTOR_VERDICT", ticket="")) == "MARKET_ANALYSIS"
    assert classify(_event(ticket="999", event_category="info")) == "LIVE_THOUGHT"
    assert classify(_event()) == "INFO"


def test_trade_executed_card_reports_confidence_increase():
    build = ENGINE["_ai_build_thought_card"]
    prev = {}
    ev1 = _event(event_category="ai", event_type="AI_DIRECTOR_VERDICT", ticket="",
                 market_bias="+1", ai_confidence=87, reason="H1 and H4 trend aligned; Fresh BOS confirmed")
    card1 = build(ev1, prev)
    assert card1["type"] == "MARKET_ANALYSIS"
    assert card1["headline"] == "AI Market Analysis"
    assert card1["bias"] == "Bullish"
    assert card1["confidence"] == 87
    assert card1["tone"] == "bullish"

    ev2 = _event(event_category="entries", event_type="TRADE_EXECUTED", ticket="555",
                 market_bias="+1", ai_confidence=93, position_direction="BUY",
                 decision="Entry allowed", reason="M5 confirmed momentum")
    # simulate the same underlying signal continuing (prev conf carries by ticket only,
    # so seed the ticket's prior confidence directly as the engine would after a real
    # multi-event sequence keyed on the same ticket)
    prev["555"] = 87
    card2 = build(ev2, prev)
    assert card2["type"] == "TRADE_EXECUTED"
    assert card2["headline"] == "Trade Executed"
    assert card2["tone"] == "success"
    assert card2["confidence"] == 93
    assert card2["confidence_delta"] == 6
    assert any("87" in b and "93" in b for b in card2["reason_bullets"])


def test_live_thought_card_is_calm_when_confidence_is_healthy():
    build = ENGINE["_ai_build_thought_card"]
    ev = _event(ticket="555", ai_confidence=81, market_bias="+1",
               reason="Normal retracement, higher timeframe remains bullish")
    card = build(ev, {"555": 93})
    assert card["type"] == "LIVE_THOUGHT"
    assert card["headline"] == "Live Thoughts"
    assert card["tone"] == "neutral"
    assert card["confidence_delta"] == -12


def test_live_thought_card_escalates_to_warning_on_weak_or_dropping_confidence():
    build = ENGINE["_ai_build_thought_card"]
    ev = _event(ticket="555", ai_confidence=63, reason="Momentum weakening")
    card = build(ev, {"555": 81})
    assert card["type"] == "LIVE_THOUGHT"
    assert card["headline"] == "Warning"
    assert card["tone"] == "warning"
    assert "Not exiting yet" in card["action_text"]


def test_trade_closed_card_reports_profit_and_tone():
    build = ENGINE["_ai_build_thought_card"]
    win = build(_event(ticket="555", event_category="exits", event_type="EXIT",
                       profit=128.0, close_reason_exact="Momentum exhausted, structure weakening"), {})
    assert win["type"] == "TRADE_CLOSED"
    assert win["result_usd"] == 128.0
    assert win["tone"] == "success"

    loss = build(_event(ticket="556", event_category="exits", event_type="EXIT",
                        profit=-40.0, close_reason_exact="Stop loss hit"), {})
    assert loss["result_usd"] == -40.0
    assert loss["tone"] == "danger"


def test_trade_blocked_card_hides_raw_variables_and_shows_reasons():
    build = ENGINE["_ai_build_thought_card"]
    ev = _event(event_category="blocks", allowed=False, ai_confidence=46,
               blocked_by="AI confidence below minimum",
               reason="HTF trend disagrees; Poor reward/risk; Momentum fading")
    card = build(ev, {})
    assert card["type"] == "TRADE_BLOCKED"
    assert card["headline"] == "Trade Blocked"
    assert card["tone"] == "danger"
    # v6.9.0: decision_text must show the SPECIFIC reason, not the old
    # hardcoded generic phrase, regardless of whether the exact code is one
    # of the recognized humanized phrases or falls back to a cleaned code.
    assert card["decision_text"] != "Waiting for higher quality setup"
    assert "ai confidence below minimum" in card["decision_text"].lower()
    assert card["reason_bullets"][0] == "AI confidence below minimum"
    # raw engine internals must never leak into the default (non-advanced) fields
    for field in ("headline", "decision_text", "simple_text"):
        assert "ATR" not in card[field]
        assert "tcmScore" not in card[field]


def test_advanced_payload_carries_raw_telemetry_for_developer_details():
    build = ENGINE["_ai_build_thought_card"]
    ev = _event(ticket="555", event_type="TRADE_EXECUTED", event_category="entries",
               module="EntryEngine", score=7.45, details={"regime": "STRONG_TREND", "session": "LONDON"})
    card = build(ev, {})
    assert card["advanced"]["module"] == "EntryEngine"
    assert card["advanced"]["score"] == 7.45
    assert card["advanced"]["regime"] == "STRONG_TREND"
    assert card["advanced"]["details"] == {"regime": "STRONG_TREND", "session": "LONDON"}


def test_would_enter_again_verdict_is_three_way_yes_no_wait():
    fn = ENGINE["_ai_would_enter_again"]
    healthy = {"confidence": 87, "tone": "neutral", "confidence_delta": 3}
    v = fn(healthy)
    assert v["answer"] == "YES"

    borderline = {"confidence": 60, "tone": "warning", "confidence_delta": -15}
    v2 = fn(borderline)
    assert v2["answer"] == "WAIT"
    assert "dropped" in v2["reason"].lower()

    clearly_bad = {"confidence": 30, "tone": "danger", "confidence_delta": -20}
    v3 = fn(clearly_bad)
    assert v3["answer"] == "NO"

    unknown = {"confidence": None, "tone": "neutral"}
    v4 = fn(unknown)
    assert v4["answer"] == "WAIT"


def test_block_reason_humanizer_maps_known_codes_and_degrades_gracefully():
    fn = ENGINE["_ai_humanize_block_reason"]
    assert "reward-to-risk" in fn("GROWTH_RR_BLOCK").lower()
    assert "ai confidence" in fn("B-CONFIDENT-SKIP-WARN").lower()
    assert "structure" in fn("SMC_HARD_CONFLICT").lower()
    # unrecognized code still produces something specific, never blank
    assert fn("") == ""
    assert fn("SOME_NEW_CODE") == "Blocked: some new code"
