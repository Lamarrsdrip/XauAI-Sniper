from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_worker_defaults_to_one_mt5_account():
    worker = (ROOT / "backend" / "worker_agent" / "worker_agent.py").read_text()

    assert 'WORKER_MAX_USERS", "1"' in worker
    assert "NEEDS_DEDICATED_WORKER" in worker
    assert '"X-Worker-Id": WORKER_ID' in worker
    assert "DEDICATED WORKER GUARD" in worker


def test_backend_routes_pending_users_by_worker_id():
    server = (ROOT / "backend" / "server.py").read_text()

    assert 'request.headers.get("X-Worker-Id")' in server
    assert 'query["assigned_worker_id"] = worker_id' in server
    assert "max_users: int = 1" in server


def test_download_worker_matches_source_worker():
    source = (ROOT / "backend" / "worker_agent" / "worker_agent.py").read_text()
    public = (ROOT / "frontend" / "public" / "worker_agent_v1.5.5.py").read_text()

    assert public == source
