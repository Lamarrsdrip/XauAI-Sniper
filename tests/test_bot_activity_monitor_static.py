from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_backend_exposes_bot_monitor_and_command_center_endpoints():
    server = read("backend/server.py")

    assert "BotHeartbeatReq" in server
    assert "@api_router.post(\"/cloud/monitor/heartbeat\")" in server
    assert "@api_router.post(\"/cloud/monitor/activity\")" in server
    assert "@api_router.get(\"/cloud/monitor/status\")" in server
    assert "@api_router.get(\"/cloud/monitor/activity\")" in server
    assert "cloud_bot_heartbeats" in server
    assert "cloud_bot_activity" in server
    assert "BOT_OFFLINE_NO_HEARTBEAT" in server
    assert "Remote monitoring only; this endpoint never executes trades" in server
    assert "CloudCommandReq" in server
    assert "SAFE_REMOTE_COMMANDS" in server
    assert "@api_router.post(\"/cloud/command/request\")" in server
    assert "@api_router.get(\"/cloud/command/pending\")" in server
    assert "@api_router.post(\"/cloud/command/ack\")" in server
    assert "cloud_bot_commands" in server


def test_ea_sends_live_monitor_heartbeat_and_activity_events():
    ea = read("backend/ea_code/XAUUSD_AI_Sniper_EA.mq5")

    assert "InpBotMonitorEnable" in ea
    assert "InpBotMonitorHeartbeatSec = 20" in ea
    assert "BotMonitorHeartbeat()" in ea
    assert "BotMonitorActivity(" in ea
    assert "/api/cloud/monitor/heartbeat" in ea
    assert "/api/cloud/monitor/activity" in ea
    assert "BotMonitorPollCommands()" in ea
    assert "BotMonitorAckCommand(" in ea
    assert "/api/cloud/command/pending" in ea
    assert "/api/cloud/command/ack" in ea
    assert "g_remotePauseNewTrades" in ea
    assert "PAUSE_NEW_TRADES" in ea
    assert "CLOSE_ALL_TRADES" in ea
    assert "algo_trading" in ea
    assert "trading_allowed" in ea
    assert "open_positions" in ea
    assert "last_error" in ea


def test_cloud_dashboard_is_repurposed_as_mobile_monitor():
    dashboard = read("frontend/src/components/cloud/CloudDashboard.jsx")

    assert "Bot Activity Monitor" in dashboard
    assert "/cloud/monitor/status" in dashboard
    assert "/cloud/monitor/activity" in dashboard
    assert "data-testid=\"bot-monitor-dashboard\"" in dashboard
    assert "data-testid=\"bot-status-card\"" in dashboard
    assert "activity-filter-trade" in dashboard
    assert "BOT OFFLINE / NO HEARTBEAT" in dashboard
    assert "XAU AI Sniper Command Center" in dashboard
    assert "Monitor + PIN-safe control" in dashboard
    assert "/cloud/command/request" in dashboard
    assert "Pause new trades" in dashboard
    assert "Close all trades" in dashboard


def test_command_center_routing_replaces_cloud_public_route():
    app = read("frontend/src/App.js")
    landing = read("frontend/src/components/cloud/CloudLanding.jsx")
    auth = read("frontend/src/components/cloud/CloudAuth.jsx")

    assert "path=\"/command\"" in app
    assert "path=\"/command/dashboard\"" in app
    assert "to=\"/command\"" in app
    assert "copy trading hub" not in landing
    assert "Buy the licensed XAU AI Sniper EA" in landing
    assert "XAU AI Sniper Command Center" in auth
