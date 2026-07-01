from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
EA_NAMED = ROOT / "XAUUSD_AI_Sniper_EA_v6.4.20.mq5"
EA_ROOT = ROOT / "XAUUSD_AI_Sniper_EA_v6.4.6.mq5"
EA_BACKEND = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"
DOWNLOAD = ROOT / "frontend" / "src" / "components" / "DownloadSection.jsx"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def section(text: str, start: str, end: str) -> str:
    return text[text.index(start):text.index(end, text.index(start))]


def test_v6420_release_identity_is_consistent_across_active_sources():
    named = read(EA_NAMED)
    root = read(EA_ROOT)
    backend = read(EA_BACKEND)

    assert named == root == backend
    assert "v6.4.20" in named[:1000]
    assert "Full Build Integrity Audit + TTM Compile Fix" in named[:1000]
    assert '#property version   "6.420"' in named
    assert '#property version   "6.4.20"' not in named
    assert '#define XAUAI_EA_VERSION "v6.4.20"' in named
    assert '#define XAUAI_EA_VERSION_NUM "6.4.20"' in named
    assert '#define XAUAI_BUILD_HASH "v6420-build-integrity-audit-20260701"' in named
    assert 'input group "=== TRADE THESIS MONITOR (v6.4.20) ==="' in named


def test_ttm_struct_is_not_used_as_an_illegal_pointer():
    ea = read(EA_NAMED)
    ttm_eval = section(ea, "string TTM_Evaluate", "// ======================================================================\n// END TTM FUNCTIONS")

    assert "TradeTTMRecord *" not in ttm_eval
    assert "&g_ttm[idx]" not in ttm_eval
    assert "idx < 0 || idx >= TTM_MAX_POSITIONS || !g_ttm[idx].active" in ttm_eval
    assert "g_ttm[idx].prevScore = g_ttm[idx].liveScore" in ttm_eval
    assert "g_ttm[idx].thesisBroken = true" in ttm_eval


def test_compile_log_reports_zero_errors_and_zero_warnings():
    log_path = ROOT / "test_reports" / "metaeditor_v6420.log"
    log = read(log_path)
    assert re.search(r"Result:\s+0 errors,\s+0 warnings", log), log[-1000:]


def test_site_download_fallback_matches_release_parser_filename():
    src = read(DOWNLOAD)
    assert '|| "v6.4.20"' in src
    assert '|| "Full Build Integrity Audit + TTM Compile Fix"' in src
    assert "XAUUSD_AI_Sniper_EA_MASTER_v6.4.20_FULL_BUILD_INTEGRITY_AUDIT_TTM_COMPILE_FIX.mq5" in src
