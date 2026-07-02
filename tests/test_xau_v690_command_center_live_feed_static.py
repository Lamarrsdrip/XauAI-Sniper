from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.10.0.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"
SERVER = ROOT / "backend" / "server.py"
FEED_JSX = ROOT / "frontend" / "src" / "components" / "cloud" / "AIThoughtFeed.jsx"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def body(ea: str, start: str, end: str = "\n}\n") -> str:
    pos = ea.index(start)
    return ea[pos : ea.index(end, pos) + len(end)]


def test_source_and_backend_copy_stay_synced():
    assert read(EA) == read(BACKEND_EA)


def test_heartbeat_posts_to_cloud_unconditionally_before_any_deep_gate():
    """Root-cause fix for stale '7d ago' cards: the periodic status post
    must happen inside the same unconditional 60s block, before any of the
    entry-scan gates (equity protect, weekly target, growth daily lock,
    etc.) that could otherwise suppress every cloud post for a long
    stretch."""
    ea = read(EA)
    heartbeat = body(ea, "if(TimeCurrent() - g_lastHeartbeat >= 60)")
    assert 'BotMonitorDecisionEvent("BOT_STATUS_HEARTBEAT"' in heartbeat
    for category in ("SCANNING", "BLOCKED", "MANAGING_TRADE", "PROTECTING_PROFIT"):
        assert f'"{category}"' in heartbeat
    # this whole block must run before OnTick()'s daily/weekly reset and
    # entry-scan gates, i.e. appear early in OnTick()
    tick_start = ea.index("void OnTick()")
    heartbeat_pos = ea.index('BotMonitorDecisionEvent("BOT_STATUS_HEARTBEAT"', tick_start)
    assert heartbeat_pos - tick_start < 4000, "heartbeat post must be near the top of OnTick(), not behind deep gates"


def test_thesis_status_now_reaches_the_cloud_not_just_the_local_journal():
    ea = read(EA)
    fn = body(ea, "void XAU_LogTradeThesisStatus(ulong ticket, bool isBuy, double openPx, double curSL,")
    assert "PrintFormat(\"TRADE_THESIS_STATUS:" in fn  # local log preserved
    assert 'WebRequest("POST", InpCloudURL + "/api/cloud/monitor/thesis-status"' in fn
    assert '\\"dist_to_sl\\":%.5f,\\"dist_to_tp\\":%.5f' in fn
    assert '\\"recovery_mode\\":\\"%s\\"' in fn


def test_backend_ingests_thesis_status_and_upserts_per_ticket():
    server = read(SERVER)
    assert "class TradeThesisStatusReq(BaseModel):" in server
    endpoint = body(server, '@api_router.post("/cloud/monitor/thesis-status")', "\n    return {\"ok\": True}\n")
    assert "cloud_trade_thesis_status.update_one(" in endpoint
    assert "upsert=True" in endpoint


def test_bot_status_endpoint_exists_and_flags_staleness():
    server = read(SERVER)
    endpoint = body(server, '@api_router.get("/cloud/monitor/bot-status")',
                     "\"stale\": age_sec is not None and age_sec > 360,")
    assert 'event_type": "BOT_STATUS_HEARTBEAT"' in endpoint
    assert '"stale": age_sec is not None and age_sec > 360' in endpoint


def test_decision_feed_excludes_heartbeat_spam_and_groups_repeats():
    server = read(SERVER)
    assert '_DECISION_FEED_EXCLUDED_EVENT_TYPES = ["BOT_STATUS_HEARTBEAT"]' in server
    feed = body(server, "async def cloud_monitor_decision_feed(limit: int = 60, ticket: str = \"\",",
                "return {\"cards\": cards, \"timeline\": timeline, \"count\": len(cards)}")
    assert "event_type" in feed and "$nin" in feed
    assert "_ai_group_repeated_cards(cards)" in feed

    group_fn = body(server, "def _ai_group_repeated_cards(cards: list) -> list:", "return grouped")
    assert 'prev.setdefault("repeated_at", [])' in group_fn
    assert 'prev["repeat_count"]' in group_fn


def test_blocked_reason_is_specific_not_generic():
    server = read(SERVER)
    assert "_BLOCK_REASON_PHRASES = [" in server
    assert '"Blocked because the reward-to-risk ratio is too low' in server
    assert '"Blocked because AI confidence is weak' in server
    assert '"Blocked because market structure' in server
    # confirm the old bug (always the generic phrase) is actually gone
    blocked_block = body(server, 'elif card_type == "TRADE_BLOCKED":', "bullets.insert(0, blocked_by)")
    assert 'decision_text = "Waiting for higher quality setup"' not in blocked_block


def test_would_enter_again_is_three_way_not_binary():
    server = read(SERVER)
    fn = body(server, "def _ai_would_enter_again(latest_card: dict) -> dict:",
              'return {"answer": "YES", "reason": "Thesis still holds at current confidence."}')
    assert '"answer": "YES"' in fn
    assert '"answer": "NO"' in fn
    assert '"answer": "WAIT"' in fn


def test_frontend_has_a_dedicated_current_bot_decision_panel():
    src = read(FEED_JSX)
    assert "function BotDecisionPanel({ status })" in src
    for category in ("SCANNING", "WAITING", "BLOCKED", "MANAGING_TRADE", "PROTECTING_PROFIT", "HOLDING", "PREPARING_EXIT"):
        assert category in src
    assert '"/cloud/monitor/bot-status"' in src
    assert "<BotDecisionPanel status={botStatus} />" in src


def test_frontend_current_trade_panel_shows_recovery_and_distance_to_sl_tp():
    src = read(FEED_JSX)
    assert "Recovery Mode active" in src
    assert "Distance to SL" in src
    assert "Distance to TP" in src
    assert "VERDICT_STYLE" in src and "WAIT:" in src


def test_frontend_still_polls_every_8_seconds_for_freshness():
    src = read(FEED_JSX)
    assert "setInterval(fetchAll, 8000)" in src
