from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SERVER = (ROOT / "backend/server.py").read_text(encoding="utf-8")
EA = (ROOT / "XAUUSD_AI_Sniper_EA.mq5").read_text(encoding="utf-8")
EA_BACKEND = (ROOT / "backend/ea_code/XAUUSD_AI_Sniper_EA.mq5").read_text(encoding="utf-8")
INDEX = (ROOT / "XauIndex_EA_v3.1.mq5").read_text(encoding="utf-8")
INDEX_BACKEND = (ROOT / "backend/ea_code_xauindex/XauIndex_EA.mq5").read_text(encoding="utf-8")


def test_canonical_ea_and_backend_copy_are_identical():
    assert EA == EA_BACKEND


def test_xauindex_and_backend_copy_are_identical():
    assert INDEX == INDEX_BACKEND


def test_all_active_ea_ai_clients_send_pin_and_account():
    for source in (EA, INDEX):
        assert '\\"pin\\":\\"%s\\",\\"account_id\\"' in source
        assert source.count('\\"pin\\":\\"%s\\"') >= 7
        assert "/api/ai/analyze" in source
        assert "/api/ai/manage-position" in source
        assert "/api/ai/feedback" in source
        assert "/api/ai/memory/record" in source


def test_journal_weekly_and_pattern_clients_send_account_binding():
    for source in (EA, INDEX):
        assert '\\"account_login\\":\\"%I64d\\"' in source
        assert '\\"account_id\\":\\"%I64d\\",\\"symbol\\"' in source
        assert "/api/journal/log" in source
        assert "/api/journal/weekly-report" in source
        assert "/api/ml/patterns/save" in source
        assert "/api/ml/patterns/load" in source


def test_server_requires_account_on_every_ea_data_or_ai_write():
    required_markers = (
        'detail="account_id is required"',
        'detail="account is required"',
        'detail="account_login is required"',
    )
    for marker in required_markers:
        assert marker in SERVER
    assert SERVER.count("await _resolve_monitor_license(") >= 20


def test_server_stores_non_secret_license_identity_not_pin_for_new_records():
    assert 'data.pop("pin", None)' in SERVER
    assert 'record.pop("pin", None)' in SERVER
    assert 'doc.pop("pin", None)' in SERVER
    assert '"license_id": lic.get("id", "")' in SERVER


def test_news_failure_is_unknown_and_not_an_indefinite_global_cage():
    assert SERVER.count('"status": "DEGRADED_UNKNOWN"') >= 2
    assert SERVER.count('"safe_to_trade": None') >= 2
    assert SERVER.count('"global_block": False') >= 2


def test_optional_llm_adapter_preserves_both_provider_interfaces():
    adapter = (ROOT / "backend/llm_adapter.py").read_text(encoding="utf-8")
    requirements = (ROOT / "backend/requirements.txt").read_text(encoding="utf-8")
    assert "class LlmChat" in adapter
    assert "class UserMessage" in adapter
    assert "emergentintegrations" not in requirements
    assert "from llm_adapter import LlmChat, UserMessage" in SERVER
