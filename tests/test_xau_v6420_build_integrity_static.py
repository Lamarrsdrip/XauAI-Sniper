from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
EA_NAMED = ROOT / "XAUUSD_AI_Sniper_EA_v6.9.0.mq5"
EA_BACKEND = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"
DOWNLOAD = ROOT / "frontend" / "src" / "components" / "DownloadSection.jsx"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def section(text: str, start: str, end: str) -> str:
    return text[text.index(start):text.index(end, text.index(start))]


# v6.5.0 (audit bug #11): the exact v6.4.21 release-identity assertions that
# used to live here are permanently obsolete (that header/build-hash text
# only ever existed in that one release). Each release verifies its own
# identity in its own dedicated test file. The TTM group label below is a
# historical "when this feature was added" marker, not a release version, so
# it stays unchanged across releases and is still checked.
def test_ttm_input_group_marks_the_release_that_introduced_it():
    named = read(EA_NAMED)
    assert 'input group "=== TRADE THESIS MONITOR (v6.4.21) ==="' in named


def test_ttm_struct_is_not_used_as_an_illegal_pointer():
    ea = read(EA_NAMED)
    ttm_eval = section(ea, "string TTM_Evaluate", "// ======================================================================\n// END TTM FUNCTIONS")

    assert "TradeTTMRecord *" not in ttm_eval
    assert "&g_ttm[idx]" not in ttm_eval
    assert "idx < 0 || idx >= TTM_MAX_POSITIONS || !g_ttm[idx].active" in ttm_eval
    assert "g_ttm[idx].prevScore = g_ttm[idx].liveScore" in ttm_eval
    assert "g_ttm[idx].thesisBroken = true" in ttm_eval


def test_compile_log_reports_zero_errors_and_zero_warnings():
    log_path = ROOT / "test_reports" / "metaeditor_v650.log"
    log = read(log_path)
    assert re.search(r"Result:\s+0 errors,\s+0 warnings", log), log[-1000:]


def test_site_download_fallback_is_present_and_self_consistent():
    # v6.5.0 (audit bug #11): the fallback filename FORMAT itself changed
    # (from the verbose "_MASTER_..._RESTORE.mq5" style to a plain
    # "XAUUSD_AI_Sniper_EA_vX.X.X.mq5") starting v6.4.22 — checking the exact
    # old string is no longer meaningful. Check the fallback exists and is
    # internally consistent (version/edition/filename all present) instead of
    # pinning one release's literal values.
    src = read(DOWNLOAD)
    assert 'info?.version' in src and 'info?.edition' in src and 'info?.filename' in src
    assert "XAUUSD_AI_Sniper_EA_MASTER_v6.4.21_TRADE_MODE_JUNE_17_19_BALANCE_LOT_RESTORE.mq5" not in src
