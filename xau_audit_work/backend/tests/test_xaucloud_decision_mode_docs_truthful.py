"""
XauCloud final-production audit finding XC-001: /architecture, /docs/how-it-works,
/docs/installation, /docs/setup-guide and /docs/video-guide described a "Selectable
Decision Authority" and told customers to "select M30 three-snapshot mode explicitly",
but on the production branch InpDecisionMode is a compile-time const locked to
XAU_DECISION_M10_LEGACY -- there is no selectable M30 mode in the shipped EA. Customers
were told a feature exists that does not. Fixed by rewriting the docs strings to state
M10 legacy is the sole authoritative decision mode in this release, without touching
any EA logic.
"""
import importlib
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def _load_source() -> str:
    return (BACKEND_DIR / "server.py").read_text(encoding="utf-8")


def test_no_selectable_m30_language_remains():
    src = _load_source()
    forbidden = [
        "Selectable Decision Authority",
        "M30 three-snapshot mode must be selected explicitly",
        "Is M30 mode active automatically?",
        "selecting legacy M10 or optional M30 mode",
        "Explicit M10 or M30 selection",
    ]
    for phrase in forbidden:
        assert phrase not in src, f"misleading M30-selectable phrase still present: {phrase!r}"


def test_docs_state_m10_legacy_is_sole_authoritative_mode():
    src = _load_source()
    assert "M10 legacy is the sole authoritative decision mode in this release" in src
    assert "This release runs M10 legacy decision mode only" in src


def test_dormant_m30_path_disclosed_not_hidden():
    src = _load_source()
    # the audit's principle is truthful disclosure, not silent deletion -- the
    # dormant M30 path is acknowledged as existing-but-inactive, not erased
    assert "not selectable or executable" in src
