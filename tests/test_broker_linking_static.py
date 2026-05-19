from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_backend_exposes_broker_compatibility_flow():
    server = read("backend/server.py")
    assert "@api_router.get(\"/cloud/mt5/brokers\")" in server
    assert "@api_router.get(\"/cloud/mt5/compatibility\")" in server
    assert "@api_router.post(\"/cloud/mt5/test-connection\")" in server
    assert "@api_router.get(\"/cloud/mt5/logs\")" in server
    assert "cloud_broker_logs" in server
    assert "_broker_error_hint" in server
    assert "custom_review" in server


def test_worker_reports_broker_health_and_gold_symbol_mapping():
    worker = read("backend/worker_agent/worker_agent.py")
    assert "VERSION = \"1.5.4\"" in worker
    assert "\"XAUUSD.raw\"" in worker
    assert "\"XAUUSDecn\"" in worker
    assert "\"symbol_mapping\"" in worker
    assert "\"latency_ms\"" in worker
    assert "getattr(acct, \"trade_allowed\", True)" in worker
    assert "getattr(term, \"trade_allowed\", True)" in worker


def test_cloud_dashboard_has_user_visible_broker_checks():
    dashboard = read("frontend/src/components/cloud/CloudDashboard.jsx")
    assert "/cloud/mt5/compatibility" in dashboard
    assert "/cloud/mt5/test-connection" in dashboard
    assert "/cloud/mt5/logs" in dashboard
    assert "BROKER COMPATIBILITY" in dashboard
    assert "broker-test-button" in dashboard


if __name__ == "__main__":
    test_backend_exposes_broker_compatibility_flow()
    test_worker_reports_broker_health_and_gold_symbol_mapping()
    test_cloud_dashboard_has_user_visible_broker_checks()
    print("broker linking static checks passed")
