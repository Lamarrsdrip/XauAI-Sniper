from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
# v6.5.0 (audit bug #11): CURRENT used to be hardcoded and went stale every
# release (the exact staleness pattern the ecosystem audit flagged). Derive
# it from the EA's own version macro instead, so this test stays meaningful
# across every future version bump without manual edits.
_EA_FILES = sorted(ROOT.glob("XAUUSD_AI_Sniper_EA_v*.mq5"),
                   key=lambda p: [int(x) for x in re.findall(r"\d+", p.stem)])
_EA_SRC = _EA_FILES[-1].read_text(encoding="utf-8", errors="ignore")
_VER_MATCH = re.search(r'#define XAUAI_EA_VERSION "(v[\d.]+)"', _EA_SRC)
assert _VER_MATCH, "could not derive current EA version from any XAUUSD_AI_Sniper_EA_v*.mq5 file"
CURRENT = _VER_MATCH.group(1)
OLD_LABELS = ["v6.3.6", "v6.4.9", "v6.4.13", "v6.4.14", "v6.4.18", "v6.4.19"]


def read(path):
    return path.read_text(encoding="utf-8", errors="ignore")


def test_public_site_command_and_admin_labels_show_current_release():
    files = [
        ROOT / "frontend" / "src" / "components" / "Footer.jsx",
        ROOT / "frontend" / "src" / "components" / "cloud" / "CloudLanding.jsx",
        ROOT / "frontend" / "src" / "components" / "cloud" / "CloudDashboard.jsx",
        ROOT / "frontend" / "src" / "components" / "AdminPortal.jsx",
        ROOT / "frontend" / "src" / "components" / "DownloadSection.jsx",
        ROOT / "frontend" / "src" / "components" / "FeaturesSection.jsx",
    ]
    for path in files:
        src = read(path)
        assert CURRENT in src, f"{path.name} should show current release"
        for old in OLD_LABELS:
            assert old not in src, f"{path.name} still contains stale release label {old}"


def test_backend_trade_memory_default_uses_current_release():
    src = read(ROOT / "backend" / "server.py")
    assert f'ea_version: str = "{CURRENT}"' in src
