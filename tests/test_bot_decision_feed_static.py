from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.11.0.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def test_backend_accepts_structured_decision_events_and_dedupes_noise():
    server = read(ROOT / "backend" / "server.py")

    for field in (
        "market_bias",
        "signal_direction",
        "ai_confidence",
        "trade_allowed",
        "decision",
        "blocked_by",
        "risk_lot_decision",
        "close_reason_exact",
        "was_ea_forced_close",
        "position_direction",
    ):
        assert field in server

    assert "dedupe_key" in server
    assert "repeat_count" in server
    assert "Repeated" not in server  # repeat wording belongs in UI, API returns data.
    assert "event_category" in server
    assert "timedelta(minutes=15)" in server
    assert "\"LOSS_CLOSE_BLOCKED\"" in server
    assert "kind: str = \"all\", limit: int = 80, search: str = \"\"" in server
    for kind in ("entries", "blocks", "exits", "risk", "ai", "errors", "overrides"):
        assert kind in server
    assert "\"details.ticket\"" in server
    assert "\"details.reason\"" in server
    assert "\"details.module\"" in server


def test_dashboard_shows_bot_decision_feed_with_filters_search_stats_and_history():
    dashboard = read(ROOT / "frontend" / "src" / "components" / "cloud" / "CloudDashboard.jsx")

    assert "Bot Decision Feed" in dashboard
    assert "DecisionSummaryCard" in dashboard
    assert "DecisionStats" in dashboard
    assert "DecisionHistory" in dashboard
    assert "Search ticket, reason, module, symbol, time" in dashboard
    for label in ("Entries", "Blocks", "Exits", "Risk", "AI", "Errors", "Overrides"):
        assert label in dashboard
    assert "eventRepeatText" in dashboard
    assert "Repeated ${count - 1} times in last 15 minutes." in dashboard
    assert "CloseReasonExact" not in dashboard  # UI uses normalized API field labels.
    assert "close_reason_exact" in dashboard
    assert "LOSS_CLOSE_BLOCKED" in dashboard
    assert "activity-filter-trade" in dashboard


def test_ea_publishes_structured_decision_cycle_entry_exit_and_override_events():
    ea = read(EA)

    assert "void BotMonitorDecisionEvent(" in ea
    assert '\\"timeframe\\":\\"M5\\"' in ea
    assert '\\"market_bias\\":\\"%s\\"' in ea
    assert '\\"signal_direction\\":\\"%s\\"' in ea
    assert '\\"ai_confidence\\":%.2f' in ea
    assert '\\"risk_lot_decision\\":\\"%s\\"' in ea
    assert '\\"close_reason_exact\\":\\"%s\\"' in ea
    assert '\\"was_ea_forced_close\\":%s' in ea

    assert "BotMonitorDecisionEvent(\"M5_DECISION\"" in ea
    assert "BotMonitorDecisionEvent(\"TRADE_EXECUTED\", \"ENTRY\"" in ea
    assert "BotMonitorDecisionEvent(\"LOSS_CLOSE_BLOCKED\", \"OVERRIDE\"" in ea
    assert "BotMonitorDecisionEvent(\"TRADE_CLOSED\", \"EXIT\"" in ea
    assert "BotMonitorDecisionEvent(\"DAILY_LOCK_IGNORED\", \"OVERRIDE\"" in ea
    assert "NoLimitTradingMode ignored it" in ea
    assert "Only broker SL, manual close, or emergency margin/account protection" in ea


def test_download_source_stays_synced_with_active_ea_after_decision_feed_change():
    assert read(EA) == read(BACKEND_EA)
