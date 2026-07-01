from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"
DOWNLOAD = ROOT / "frontend" / "src" / "components" / "DownloadSection.jsx"
README = ROOT / "README.md"


def read(path):
    return path.read_text(encoding="utf-8", errors="ignore")


def test_backend_download_metadata_header_reports_current_release():
    # v6.5.0 (audit bug #11): this used to assert an exact v6.4.21 header/
    # edition/build-hash, which is guaranteed to go stale every release. Test
    # the PARSER's behavior (it must find a well-formed header and correctly
    # extract version+edition) against whatever the header currently says,
    # and cross-check it against the version macro instead of a fixed string.
    ea = read(EA)
    match = re.search(r"v(\d+\.\d+\.\d+)\s*[—\-]+\s*(.+)", ea[:3000])
    assert match, "download metadata parser must find the EA release header"
    parsed_version = f"v{match.group(1)}"
    edition = match.group(2).strip().rstrip("|").strip()
    assert len(edition) > 0
    ver_macro = re.search(r'#define XAUAI_EA_VERSION "(v[\d.]+)"', ea)
    assert ver_macro, "XAUAI_EA_VERSION macro must be present"
    assert parsed_version == ver_macro.group(1), "header-parsed version must match the XAUAI_EA_VERSION macro"


def test_backend_download_parser_strips_banner_pipe_from_edition():
    server = read(ROOT / "backend" / "server.py")
    assert 'rstrip("|").strip()' in server


def test_frontend_download_fallback_is_current_and_self_consistent():
    # v6.5.0 (audit bug #11): check the fallback version/filename in the
    # frontend match the EA's own version macro, instead of pinning one
    # release's exact literal string (which cannot survive a version bump).
    ea = read(EA)
    ver_macro = re.search(r'#define XAUAI_EA_VERSION "(v[\d.]+)"', ea)
    assert ver_macro
    current = ver_macro.group(1)
    src = read(DOWNLOAD)
    assert f'|| "{current}"' in src, f"DownloadSection.jsx fallback version should be {current}"
    assert f'XAUUSD_AI_Sniper_EA_{current}.mq5' in src


def test_readme_documents_dynamic_version_source_not_a_stale_literal():
    # v6.5.0 (audit bug #11): README used to hardcode a version number and go
    # stale every release. It should now point at the live source of truth
    # instead of embedding any specific version literal.
    src = read(README)
    assert "/api/download/info" in src
    assert "_get_ea_meta" in src
    assert not re.search(r"v6\.4\.\d+", src), "README should not hardcode a specific EA version number"
