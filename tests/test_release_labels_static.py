from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
# v6.5.0 (audit bug #11): CURRENT used to be hardcoded and went stale every
# release. Derive it from the EA's own version macro instead.
# v1.0.0 (XauIndex fork): with two separate products now sharing the
# "XAUUSD_AI_Sniper_EA_v*.mq5" root-directory naming pattern (the gold-only
# lineage, plus retired forks like v6.7.0 that became XauIndex), "highest
# version number found in the directory" is no longer the same thing as
# "the version the site actually serves." Read the live, deployed source of
# truth instead — backend/ea_code/XAUUSD_AI_Sniper_EA.mq5 is exactly what
# /api/download/info and /api/download/ea serve to customers.
_EA_SRC = (ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5").read_text(
    encoding="utf-8", errors="ignore")
_VER_MATCH = re.search(r'#define XAUAI_EA_VERSION "(v[\d.]+)"', _EA_SRC)
assert _VER_MATCH, "could not derive current EA version from backend/ea_code/XAUUSD_AI_Sniper_EA.mq5"
CURRENT = _VER_MATCH.group(1)
OLD_LABELS = ["v6.3.6", "v6.4.9", "v6.4.13", "v6.4.14", "v6.4.18", "v6.4.19"]


def read(path):
    return path.read_text(encoding="utf-8", errors="ignore")


def test_public_site_command_and_admin_labels_show_current_release():
    # CloudDashboard.jsx intentionally excluded: it displays a CONNECTED
    # USER'S actual live EA version from their own heartbeat
    # (heartbeat.ea_version), not a marketing "latest release" label. It used
    # to hard-code a fallback literal version string when no heartbeat had
    # arrived yet, which fabricated a version number the user's EA might not
    # actually be running -- fixed to fall through to "Waiting" instead. That
    # fix means this file will never contain a literal CURRENT-version
    # string by design, and re-adding one would reintroduce the bug.
    files = [
        ROOT / "frontend" / "src" / "components" / "Footer.jsx",
        ROOT / "frontend" / "src" / "components" / "cloud" / "CloudLanding.jsx",
        ROOT / "frontend" / "src" / "components" / "AdminPortal.jsx",
        ROOT / "frontend" / "src" / "components" / "DownloadSection.jsx",
        ROOT / "frontend" / "src" / "components" / "FeaturesSection.jsx",
    ]
    for path in files:
        src = read(path)
        assert CURRENT in src, f"{path.name} should show current release"
        for old in OLD_LABELS:
            assert old not in src, f"{path.name} still contains stale release label {old}"

    dash_src = read(ROOT / "frontend" / "src" / "components" / "cloud" / "CloudDashboard.jsx")
    assert 'heartbeat.ea_version||"—"' in dash_src or "heartbeat.ea_version" in dash_src, \
        "CloudDashboard.jsx should read the live EA version from heartbeat, not a hardcoded literal"
    for old in OLD_LABELS:
        assert old not in dash_src, f"CloudDashboard.jsx still contains stale release label {old}"


def test_backend_trade_memory_default_uses_current_release():
    src = read(ROOT / "backend" / "server.py")
    assert f'ea_version: str = "{CURRENT}"' in src
