from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"
DOWNLOAD = ROOT / "frontend" / "src" / "components" / "DownloadSection.jsx"
README = ROOT / "README.md"


def read(path):
    return path.read_text(encoding="utf-8", errors="ignore")


def test_backend_download_metadata_header_reports_current_release():
    ea = read(EA)
    match = re.search(r"v(\d+\.\d+\.\d+)\s*[—\-]+\s*(.+)", ea[:3000])
    assert match, "download metadata parser must find the EA release header"
    assert f"v{match.group(1)}" == "v6.4.21"
    assert "Trade Mode" in match.group(2)
    edition = match.group(2).strip().rstrip("|").strip()
    assert edition == "Trade Mode + June 17-19 Balance Lot Restore"
    assert '#define XAUAI_EA_VERSION "v6.4.21"' in ea
    assert '#define XAUAI_BUILD_HASH "v6421-trade-mode-fear-cage-audit-20260701"' in ea


def test_backend_download_parser_strips_banner_pipe_from_edition():
    server = read(ROOT / "backend" / "server.py")
    assert 'rstrip("|").strip()' in server


def test_frontend_download_fallback_does_not_show_old_release():
    src = read(DOWNLOAD)
    assert '|| "v6.4.21"' in src
    assert "v6.4.9" not in src
    assert "XAUUSD_AI_Sniper_EA_MASTER_v6.4.21_TRADE_MODE_JUNE_17_19_BALANCE_LOT_RESTORE.mq5" in src


def test_readme_download_release_is_current():
    src = read(README)
    assert "v6.4.21" in src
    assert "v6.4.9" not in src
