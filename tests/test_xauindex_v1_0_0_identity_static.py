from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XauIndex_EA_v1.0.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code_xauindex" / "XauIndex_EA.mq5"
GOLD_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"
DOWNLOAD = ROOT / "frontend" / "src" / "components" / "DownloadSection.jsx"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def test_xauindex_source_and_backend_copy_stay_synced():
    assert read(EA) == read(BACKEND_EA)


def test_xauindex_is_versioned_and_branded_independently_from_xauai_sniper():
    ea = read(EA)

    # its own fresh version line, not a continuation of the 6.x gold lineage
    assert '#property version   "1.00"' in ea
    assert '#define XAUAI_EA_VERSION "v1.0.0"' in ea
    assert '#define XAUAI_EA_VERSION_NUM "1.0.0"' in ea

    # user-facing product name must say XauIndex, not XauAI Sniper, so the
    # two products are never confused with one another on a customer's MT5
    assert '#property copyright "XauIndex by emriz.eth"' in ea
    assert 'Print("=== XAUINDEX ", XAUAI_EA_VERSION,' in ea
    assert 'XAUAI SNIPER' not in ea


def test_xauindex_is_a_separate_file_from_the_gold_only_lineage():
    # the two products must not be the same file on disk — XauAI Sniper
    # (gold-only, maintained separately) must be free to version independently
    # (e.g. Codex's own v6.6.x line) without touching XauIndex at all.
    assert EA != GOLD_EA
    if GOLD_EA.exists():
        assert read(EA) != read(GOLD_EA)


def test_download_page_has_a_separate_xauindex_section_and_endpoints():
    src = read(DOWNLOAD)
    assert "xauindex-download-section" in src
    assert "/download/xauindex/info" in src
    assert "/download/xauindex/ea" in src
    assert "/download/xauindex/package" in src
    # must not silently reuse the gold EA's download endpoint
    assert 'href={`${api}/download/xauindex/ea`}' in src


def test_backend_serves_xauindex_from_its_own_directory_not_the_gold_one():
    server = read(ROOT / "backend" / "server.py")
    assert '"/download/xauindex/info"' in server
    assert '"/download/xauindex/ea"' in server
    assert '"/download/xauindex/package"' in server
    assert 'ROOT_DIR / "ea_code_xauindex" / "XauIndex_EA.mq5"' in server
    assert 'filename_prefix="XauIndex_EA"' in server
