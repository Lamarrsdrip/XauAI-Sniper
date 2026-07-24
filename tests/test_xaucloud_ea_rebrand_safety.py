"""
XauCloud rebrand safety (Phase 5): confirms the EA's cosmetic display strings were
renamed to XauCloud while every internal/compatibility identifier the audit classified
as unsafe-to-rename (domain, filename-prefix lookups, telemetry filename prefixes, order
comment strings, macro names) is untouched. See audits/xaucloud/03_rebrand_ledger.md.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def test_root_and_backend_copies_synced():
    assert read(EA) == read(BACKEND_EA)


def test_cosmetic_banners_renamed_to_xaucloud():
    ea = read(EA)
    assert '#property copyright "XauCloud by emriz.eth"' in ea
    assert ea.count('#property description "XauCloud v6.25.24') == 1
    assert 'Print("=== XAUCLOUD ", XAUAI_EA_VERSION,' in ea
    assert 'FileWrite(h, "# XauCloud Learning Report");' in ea
    assert 'FileWrite(fh, "=== XAUCLOUD " + XAUAI_EA_VERSION +' in ea
    assert 'd += " XAUCLOUD " + XAUAI_EA_VERSION +' in ea


def test_no_stale_xauai_sniper_cosmetic_banners_remain():
    ea = read(EA)
    assert '#property copyright "XauAI Sniper' not in ea
    assert 'Print("=== XAUAI SNIPER "' not in ea
    assert '"# XAU AI Sniper Learning Report"' not in ea


def test_domain_unchanged():
    ea = read(EA)
    assert '#property link      "https://xauaisniper.com"' in ea


def test_internal_macro_names_unchanged_only_their_values_are_reused():
    ea = read(EA)
    # the macro/schema *names* the ledger classified unsafe-to-rename are still present
    assert "XAUAI_EA_VERSION" in ea
    assert "XAUAI_BUILD_HASH" in ea
    assert '"XAUAI_TRADEBRAIN_SEED_V1"' in ea


def test_order_comment_prefix_unchanged():
    ea = read(EA)
    assert '"XAU-SNIPER|' in ea


if __name__ == "__main__":
    import sys
    import pytest
    sys.exit(pytest.main([__file__, "-q"]))
