from pathlib import Path


SOURCE = Path(__file__).resolve().parents[1] / "backend" / "ea_code" / "XauCloud.io.mq5"


def test_pattern_save_sanitizes_json_string_fields():
    source = SOURCE.read_text()
    save_patterns = source[source.index("void SavePatterns()"):source.index("void LoadPatterns()")]

    assert "BotMonitorJsonSafe(patterns[i].signature, 240)" in save_patterns
    assert "BotMonitorJsonSafe(InpLicensePIN, 64)" in save_patterns
    assert "BotMonitorJsonSafe(Symbol(), 32)" in save_patterns
    assert "StringGetCharacter(s, i) < 32" in source
