from pathlib import Path
import json


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "backend" / "ea_code" / "XauCloud-Final.mq5"


def _function(text: str, signature: str) -> str:
    start = text.index(signature)
    opening = text.index("{", start)
    depth = 0
    for index in range(opening, len(text)):
        if text[index] == "{":
            depth += 1
        elif text[index] == "}":
            depth -= 1
            if depth == 0:
                return text[start:index + 1]
    raise AssertionError("unbalanced function")


def test_final_preserves_the_tested_basket_loss_removed_execution_policy():
    text = EA.read_text(encoding="utf-8", errors="ignore")
    assert 'XauCloud-Final_v6.27.1' in text
    assert 'input int    InpMagicNumber    = 20260820;' in text
    assert 'InpBasketDirLossBlock      = false' in text
    gate = _function(text, "bool BasketDirectionLossBlock(int dir, string &reason)")
    assert 'reason = "";' in gate
    assert "return false;" in gate


def test_final_retains_existing_smart_profit_and_broker_safety_contracts():
    text = EA.read_text(encoding="utf-8", errors="ignore")
    assert "XAU_ClampGoldStopToMaxDistance" in text
    assert "XAU_MAX_GOLD_SL_MOVE" in text
    assert "XAU_SmartProfitManage" in text
    assert "account_currency" in text
    assert "BotMonitorJsonSafe" in text


def test_final_is_the_single_current_download_authority():
    for manifest_path in (
        ROOT / "backend" / "ea_releases" / "manifest.json",
        ROOT / "backend_node" / "ea_releases" / "manifest.json",
    ):
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        assert manifest["current_version"] == "v6.27.1"
        release = manifest["releases"]["v6.27.1"]
        assert release["source_filename"] == "XauCloud-Final.mq5"
        assert release["ex5_filename"] == "XauCloud-Final.ex5"
        assert release["customer_filename"] == "XauCloud-Final.ex5"

    dashboard = (ROOT / "frontend" / "src" / "components" / "cloud" / "CloudDashboard.jsx").read_text(encoding="utf-8")
    assert 'info?.filename || "XauCloud-Final.ex5"' in dashboard
