import difflib
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PRODUCTION_PATH = ROOT / "backend" / "ea_code" / "XauCloud-60pips.mq5"
FIXEDSLTP_PATH = ROOT / "backend" / "ea_code" / "XauCloud-FixedSLTP.mq5"
SHADOWML_PATH = ROOT / "backend" / "ea_code" / "XauCloud-ShadowML.mq5"
COMBINED_PATH = ROOT / "backend" / "ea_code" / "XauCloud-Combined.mq5"


def src(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore")


def find_fn(source: str, pattern: str) -> str:
    m = re.search(pattern, source, flags=re.DOTALL)
    assert m, f"pattern not found: {pattern!r}"
    return m.group(1)


def test_combined_exists_and_is_distinct_from_all_three_sources():
    for p in (PRODUCTION_PATH, FIXEDSLTP_PATH, SHADOWML_PATH, COMBINED_PATH):
        assert p.exists()
    combined = src(COMBINED_PATH)
    assert combined != src(PRODUCTION_PATH)
    assert combined != src(FIXEDSLTP_PATH)
    assert combined != src(SHADOWML_PATH)


def test_version_banner_is_its_own_distinct_version():
    combined = src(COMBINED_PATH)
    assert 'XAUAI_EA_VERSION "XAUCloud-Combined_v6.28.0"' in combined
    assert 'XAUAI_EA_VERSION_NUM "6.280"' in combined


def test_fixedsltp_change_is_present_broker_tp_attached_at_entry():
    combined = src(COMBINED_PATH)
    assert "bool pendingIsGeneralProfile = (XAU_OwnerExitProfileForEntryRegime(frozenEntryRegime) == OWNER_EXIT_GENERAL);" in combined
    assert "trade.Buy(lots, Symbol(), 0, sl, brokerTP, ownerDirectionComment)" in combined
    assert 'XAU_RExit_RequestClose(idx, ticket, "FIXED_60_PIP_EXIT")' not in combined, (
        "the manual +60 close authority must still be gone in the merged build"
    )
    fn = find_fn(combined, r"double XAU_FixedSixtyPipTPPrice\(.*?\)\s*\{(.*?)\n\}")
    assert "InpFixed60PipExit / XAUCLOUD_PIPS_PER_PRICE_UNIT" in fn


def test_shadowml_change_is_present_observation_only():
    combined = src(COMBINED_PATH)
    assert "XAU_ShadowMLRecordDecision(signal, setupName" in combined
    fn = find_fn(combined, r"void XAU_ShadowMLRecordDecision\(.*?\)\s*\{(.*?)\n\}")
    for token in (
        "OrderSend", "trade.Buy", "trade.Sell", "trade.PositionModify",
        "trade.PositionClose", "XAU_RExit_RequestClose", "SafeModifySL",
    ):
        assert token not in fn, f"shadow recorder must never call {token}"
    assert '"/api/ml/shadow/record"' in combined


def test_the_two_changes_occupy_disjoint_regions_no_interaction():
    """FixedSLTP touches OpenTrade's order-send/reconciliation and
    XAU_Fixed60PipExitOnlyManage; ShadowML touches GetHiveVerdict's cache, a
    new recorder function, and the decision-snapshot call site. These are
    different functions entirely -- confirm neither change's diff hunks land
    inside the other's changed functions (i.e. this was a clean union, not a
    hand-resolved conflict that could have silently altered either change)."""
    combined_lines = src(COMBINED_PATH).splitlines(keepends=True)
    prod_lines = src(PRODUCTION_PATH).splitlines(keepends=True)
    diff = list(difflib.unified_diff(prod_lines, combined_lines, n=0))
    hunk_starts = []
    for line in diff:
        if line.startswith("@@"):
            old_range = line.split(" ")[1].lstrip("-")
            hunk_starts.append(int(old_range.split(",")[0]))

    def region(line_no: int) -> str:
        if 1940 <= line_no <= 2045:
            return "banner"
        if 4130 <= line_no <= 4155:
            return "ml_cache_globals"
        if 13260 <= line_no <= 13420:
            return "get_hive_verdict_and_recorder"
        if 22100 <= line_no <= 22260:
            return "call_site"
        if 22660 <= line_no <= 22690:
            return "tp_helper"
        if 24600 <= line_no <= 24870:
            return "open_trade"
        if 30400 <= line_no <= 30650:
            return "exit_manage"
        return f"UNKNOWN({line_no})"

    regions = {region(s) for s in hunk_starts}
    assert "UNKNOWN" not in "".join(regions), f"unexpected region in merged diff: {regions}"
    fixedsltp_regions = {"tp_helper", "open_trade", "exit_manage"}
    shadowml_regions = {"ml_cache_globals", "get_hive_verdict_and_recorder", "call_site"}
    assert regions & fixedsltp_regions, "expected FixedSLTP's regions to be present"
    assert regions & shadowml_regions, "expected ShadowML's regions to be present"
    assert regions <= (fixedsltp_regions | shadowml_regions | {"banner"}), (
        f"found changes outside the union of both source builds' regions: {regions}"
    )


def test_signal_engine_untouched_in_combined_build():
    prod = src(PRODUCTION_PATH)
    combined = src(COMBINED_PATH)
    score_setups_prod = re.search(r"\bScoreSetups\(.*?\)\s*\{(.*?)\n\}", prod, flags=re.DOTALL)
    score_setups_combined = re.search(r"\bScoreSetups\(.*?\)\s*\{(.*?)\n\}", combined, flags=re.DOTALL)
    assert score_setups_prod and score_setups_combined
    assert score_setups_prod.group(1) == score_setups_combined.group(1)


def test_ten_dollar_sl_unchanged_in_combined_build():
    sl_line = re.search(r"^input double InpStopLossGoldMove = 10\.0;.*$", src(PRODUCTION_PATH), flags=re.MULTILINE)
    assert sl_line and sl_line.group(0) in src(COMBINED_PATH)


def test_4807_fix_preserved_in_combined_build():
    combined = src(COMBINED_PATH)
    pg = find_fn(combined, r"int PG_HTFTrend\(\)\s*\{(.*?)\n\}")
    assert ": hEMAFast;" in pg and "if(ownsEMA) IndicatorRelease(hEMA);" in pg
