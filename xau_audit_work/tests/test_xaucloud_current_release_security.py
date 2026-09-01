import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "backend" / "ea_releases" / "manifest.json"


def current_source() -> str:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    release = manifest["releases"][manifest["current_version"]]
    source_name = release.get("source_filename", "XauCloud-60pips.mq5")
    return (ROOT / "backend" / "ea_code" / source_name).read_text(encoding="utf-8", errors="ignore")


def test_current_ea_never_writes_license_pin_to_logs_or_alerts():
    source = current_source()
    output_calls = re.findall(r"\b(?:Print|PrintFormat|Alert)\s*\((.*?)\);", source, flags=re.DOTALL)

    leaking_calls = [call for call in output_calls if "InpLicensePIN" in call]
    assert not leaking_calls, "The current EA must never print or alert the configured license PIN."

    assert not any("pendingUrl" in call for call in output_calls), (
        "The pending-command URL contains the PIN query parameter and must never be logged."
    )


def test_current_ea_still_sends_license_only_in_authenticated_cloud_payloads():
    source = current_source()
    assert r'{\"pin\":\"%s\"' in source
    assert 'BotMonitorJsonSafe(InpLicensePIN' in source
    assert "query redacted" in source


def test_current_ea_helpers_do_not_release_authoritative_indicator_handles():
    source = current_source()
    pg = re.search(r"int PG_HTFTrend\(\)\s*\{(.*?)\n\}", source, flags=re.DOTALL)
    direction = re.search(r"int TFDirectionByEMA\(.*?\)\s*\{(.*?)\n\}", source, flags=re.DOTALL)
    assert pg and direction

    assert ": hEMAFast;" in pg.group(1)
    assert ": hATR;" in pg.group(1)
    assert "if(ownsEMA) IndicatorRelease(hEMA);" in pg.group(1)
    assert "if(ownsATR) IndicatorRelease(loc_hATR);" in pg.group(1)

    assert "ownsEMA = false" in direction.group(1)
    assert "ownsATR = false" in direction.group(1)
    assert "if(ownsEMA) IndicatorRelease(hEMA);" in direction.group(1)
    assert "if(ownsATR) IndicatorRelease(loc_hATR);" in direction.group(1)
