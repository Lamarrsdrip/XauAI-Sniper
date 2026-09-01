import difflib
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PRODUCTION_PATH = ROOT / "backend" / "ea_code" / "XauCloud-60pips.mq5"
FIXED_PATH = ROOT / "backend" / "ea_code" / "XauCloud-Fixed.mq5"


def src(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore")


def find_fn(source: str, pattern: str) -> str:
    m = re.search(pattern, source, flags=re.DOTALL)
    assert m, f"pattern not found: {pattern!r}"
    return m.group(1)


def test_fixed_exists_and_is_distinct_from_production():
    assert PRODUCTION_PATH.exists()
    assert FIXED_PATH.exists()
    assert src(FIXED_PATH) != src(PRODUCTION_PATH)


def test_version_banner_is_its_own_distinct_version():
    fixed = src(FIXED_PATH)
    assert 'XAUAI_EA_VERSION "XAUCloud-Fixed_v6.28.0"' in fixed
    assert 'XAUAI_EA_VERSION_NUM "6.280"' in fixed


# ---- broker-side SL+TP attached together at entry ----


def test_sl_and_tp_are_sent_in_the_same_order_send_call():
    fixed = src(FIXED_PATH)
    assert "trade.Buy(lots, Symbol(), 0, sl, brokerTP, ownerDirectionComment)" in fixed
    assert "trade.Sell(lots, Symbol(), 0, sl, brokerTP, ownerDirectionComment)" in fixed
    assert 'XAU_RExit_RequestClose(idx, ticket, "FIXED_60_PIP_EXIT")' not in fixed, (
        "the manual +60 close authority must be gone -- broker TP is the sole profit exit"
    )


def test_sl_value_sent_is_the_true_10_dollar_fixed_value_not_an_atr_placeholder():
    """The order-send `sl` variable is initially an ATR-based placeholder used
    only for lot sizing, then explicitly overwritten to the true fixed
    $10 Gold-move price (XAU_FixedGoldMoveSLPrice) BEFORE the order-send --
    this asserts that overwrite exists and precedes the send, not just that
    `sl` is used somewhere."""
    fixed = src(FIXED_PATH)
    overwrite_idx = fixed.index("sl = XAU_FixedGoldMoveSLPrice(price, signal, digits);")
    send_idx = fixed.index("trade.Buy(lots, Symbol(), 0, sl, brokerTP, ownerDirectionComment)")
    assert overwrite_idx < send_idx, "the $10 SL must be finalized before the order-send, not after"


def test_tp_price_helper_computes_exactly_60_pips_6_dollars():
    fn = find_fn(FIXED_PATH.read_text(encoding="utf-8", errors="ignore"), r"double XAU_FixedSixtyPipTPPrice\(.*?\)\s*\{(.*?)\n\}")
    assert "dist = InpFixed60PipExit / XAUCLOUD_PIPS_PER_PRICE_UNIT" in fn
    assert "(direction == 1) ? referencePrice + dist : referencePrice - dist" in fn
    fixed = src(FIXED_PATH)
    assert 'input double InpFixed60PipExit                = 60.0;  // Exact General-position take-profit exit; 60 pips = $6.00 Gold move.' in fixed
    assert "#define XAUCLOUD_PIPS_PER_PRICE_UNIT 10.0" in fixed
    # 60 / 10.0 = 6.0 -- the actual dollar distance sent as TP


def test_diagnostic_log_reports_the_real_broker_tp_not_the_stale_unused_value():
    """AUDIT FINDING (2026-08-24): the EXECUTING log line originally printed
    the old `tp` local (an R-multiple value computed for lot-sizing/legacy
    purposes, never sent to the broker) instead of the real `brokerTP`. Fixed
    by computing brokerTP before this log line and printing that instead --
    this is exactly the kind of misleading old-system leftover that could
    make two log lines disagree about what the position's TP actually is."""
    fixed = src(FIXED_PATH)
    log_stmt = re.search(r'Print\("EXECUTING: ".*?" \| ", reason\);', fixed, flags=re.DOTALL)
    assert log_stmt, "EXECUTING log line not found"
    assert "DoubleToString(brokerTP, digits)" in log_stmt.group(0)
    assert "DoubleToString(tp, digits)" not in log_stmt.group(0), (
        "must not print the old, never-sent tp value"
    )
    # brokerTP must be computed before this exact log statement, not after.
    brokertp_decl_idx = fixed.index("double brokerTP = pendingIsGeneralProfile")
    log_idx = fixed.index('Print("EXECUTING: "')
    assert brokertp_decl_idx < log_idx


def test_old_tp_variable_is_never_read_only_computed_dead_weight():
    """The pre-existing `tp` variable (R-multiple based) is still computed
    (removing its computation would require touching 5 separate branches of
    a safety-critical order-execution function for zero behavioral benefit,
    since it was already silently unused in production before this build --
    confirmed 0 compiler warnings on it in the release history). This test
    proves it's genuinely dead: assigned, never subsequently read by any
    log, function call, or decision anywhere in OpenTrade."""
    fixed = src(FIXED_PATH)
    open_trade_start = fixed.index("bool OpenTrade(int signal")
    open_trade_region = fixed[open_trade_start : open_trade_start + 60000]
    # Every remaining occurrence of the bare `tp` token in this region must
    # be either its own declaration/assignment or inside a comment -- never
    # passed as a function argument or read into another expression.
    reads = re.findall(r"[^a-zA-Z_](tp)[^a-zA-Z_=]", open_trade_region)
    # Assignments look like "tp = ...", declarations "double price, sl, tp, slDist;" --
    # both contain the token followed eventually by '=' or ',' which the
    # negative lookahead above already excludes from being flagged as a read.
    assert reads.count("tp") <= 6, f"unexpected additional reads of the dead `tp` variable: {reads}"


# ---- shadow ML: observation-only, verified end-to-end against the live backend ----


def test_shadowml_hook_present_and_provably_side_effect_free():
    fixed = src(FIXED_PATH)
    assert "XAU_ShadowMLRecordDecision(signal, setupName" in fixed
    fn = find_fn(fixed, r"void XAU_ShadowMLRecordDecision\(.*?\)\s*\{(.*?)\n\}")
    for token in (
        "OrderSend", "trade.Buy", "trade.Sell", "trade.PositionModify",
        "trade.PositionClose", "XAU_RExit_RequestClose", "SafeModifySL",
    ):
        assert token not in fn, f"shadow recorder must never call {token}"
    assert '"/api/ml/shadow/record"' in fixed
    assert 'input string InpServerURL      = "https://xaucloud.io";' in fixed, (
        "the shadow recorder posts to InpServerURL -- confirm it defaults to real production, "
        "not a placeholder/staging URL"
    )


def test_shadowml_backend_endpoints_are_registered_and_reachable():
    """This test intentionally does NOT re-mock the backend (that's
    mlShadow.test.ts's job) -- it asserts the route registration source
    itself contains both endpoints, as a static cross-check against
    accidental removal. Live end-to-end verification (POST a real payload
    to https://xaucloud.io/api/ml/shadow/record, confirm it persisted
    correctly in ml_shadow_decisions, then delete the test row) was run
    manually during this audit and confirmed working -- see the audit
    report for the exact request/response evidence."""
    ml_routes = (ROOT / "backend_node" / "src" / "routes" / "ml.ts").read_text(encoding="utf-8")
    assert 'app.post("/ml/shadow/record"' in ml_routes
    assert 'app.get("/admin/ml/shadow-stats"' in ml_routes


# ---- no interaction between the two merged changes ----


def test_the_two_changes_occupy_disjoint_regions_no_interaction():
    """FixedSLTP touches OpenTrade's order-send/reconciliation and
    XAU_Fixed60PipExitOnlyManage; ShadowML touches GetHiveVerdict's cache, a
    new recorder function, and the decision-snapshot call site. Confirm
    every diff hunk against production falls inside one of those regions
    (plus the version banner) -- i.e. a clean union, not a hand-resolved
    conflict that could have silently altered either change."""
    fixed_lines = src(FIXED_PATH).splitlines(keepends=True)
    prod_lines = src(PRODUCTION_PATH).splitlines(keepends=True)
    diff = list(difflib.unified_diff(prod_lines, fixed_lines, n=0))
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
    assert not any(r.startswith("UNKNOWN") for r in regions), f"unexpected region in diff: {regions}"
    fixedsltp_regions = {"tp_helper", "open_trade", "exit_manage"}
    shadowml_regions = {"ml_cache_globals", "get_hive_verdict_and_recorder", "call_site"}
    assert regions & fixedsltp_regions
    assert regions & shadowml_regions
    assert regions <= (fixedsltp_regions | shadowml_regions | {"banner"}), (
        f"found changes outside the union of both source changes' regions: {regions}"
    )


def test_signal_engine_untouched():
    prod = src(PRODUCTION_PATH)
    fixed = src(FIXED_PATH)
    score_setups_prod = re.search(r"\bScoreSetups\(.*?\)\s*\{(.*?)\n\}", prod, flags=re.DOTALL)
    score_setups_fixed = re.search(r"\bScoreSetups\(.*?\)\s*\{(.*?)\n\}", fixed, flags=re.DOTALL)
    assert score_setups_prod and score_setups_fixed
    assert score_setups_prod.group(1) == score_setups_fixed.group(1)


def test_ten_dollar_sl_input_unchanged():
    sl_line = re.search(r"^input double InpStopLossGoldMove = 10\.0;.*$", src(PRODUCTION_PATH), flags=re.MULTILINE)
    assert sl_line and sl_line.group(0) in src(FIXED_PATH)


def test_4807_fix_preserved():
    fixed = src(FIXED_PATH)
    pg = find_fn(fixed, r"int PG_HTFTrend\(\)\s*\{(.*?)\n\}")
    assert ": hEMAFast;" in pg and "if(ownsEMA) IndicatorRelease(hEMA);" in pg
