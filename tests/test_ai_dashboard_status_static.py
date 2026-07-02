from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA_ROOT = ROOT / "XAUUSD_AI_Sniper_EA_v6.8.0.mq5"
EA_BACKEND = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"
SERVER = ROOT / "backend" / "server.py"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_ea_dashboard_has_explicit_ai_status_labels():
    ea = read(EA_ROOT)

    for token in (
        "g_aiLastStatus",
        "g_aiLastFailureReason",
        "g_aiTransportFails",
        "Local Decision (Budget Guard)",
        "Claude Timeout",
        "GPT Error",
        "Invalid AI Response",
        "Cache Reuse",
        "Provider Unavailable",
        "AI status:",
        "Fails count:",
    ):
        assert token in ea

    assert 'g_aiClaudeVote = "unknown"' not in ea
    assert 'g_aiGPTVote    = "unknown"' not in ea


def test_ea_resets_and_increments_fails_only_for_real_transport_failures():
    ea = read(EA_ROOT)

    assert "XAU_AIRecordTransportFailure" in ea
    assert "XAU_AIRecordSuccessfulResponse" in ea
    assert "XAU_AIRecordBudgetGuard" in ea
    assert "XAU_AIRecordCacheReuse" in ea
    assert "non-200 WebRequest/API timeout/provider unreachable" in ea
    assert "XAU_AIRecordTransportFailure(res" in ea
    assert "XAU_AIRecordSuccessfulResponse(" in ea
    assert "XAU_AIRecordBudgetGuard(aiCostReason)" in ea
    assert "XAU_AIRecordCacheReuse(" in ea


def test_backend_surfaces_provider_error_and_invalid_response_status():
    server = read(SERVER)

    for token in (
        "Claude Timeout",
        "GPT Error",
        "Invalid AI Response",
        "Provider Unavailable",
        "Local Decision (Budget Guard)",
        "ai_status",
        "provider_status",
    ):
        assert token in server


def test_ea_and_backend_copy_stay_identical_for_dashboard_status_contract():
    assert read(EA_ROOT) == read(EA_BACKEND)
