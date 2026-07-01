from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CURRENT = "v6.4.21"
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
