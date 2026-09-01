"""Campaign forensic audit tooling + Mac/VPS telemetry export (built
against EA v6.24.11's log/trace format).

These are standalone Python scripts (scripts/campaign_forensic_audit.py,
scripts/export_telemetry.py), not EA source changes -- no version bump,
no MetaEditor compile. Tests actually EXECUTE both scripts against
synthetic data built from real formats (the exact July 15 sequence from
the forensic audit for the campaign grouper; the EA's own real
PrintFormat strings, copy-checked against the source, for the telemetry
parser) rather than only asserting on script text.
"""

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CAMPAIGN_SCRIPT = ROOT / "scripts" / "campaign_forensic_audit.py"
TELEMETRY_SCRIPT = ROOT / "scripts" / "export_telemetry.py"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def test_scripts_exist():
    assert CAMPAIGN_SCRIPT.exists()
    assert TELEMETRY_SCRIPT.exists()


def test_scripts_do_not_read_raw_account_files_from_the_repo():
    # same privacy convention as scripts/audit_v6232_active_intelligence.py:
    # raw account-identifying exports must never be committed/expected in-repo
    campaign_src = CAMPAIGN_SCRIPT.read_text()
    telemetry_src = TELEMETRY_SCRIPT.read_text()
    for src in (campaign_src, telemetry_src):
        assert "argparse" in src
        assert "required=True" in src  # paths are always caller-supplied, never hardcoded


# ---------------------------------------------------------------------------
# campaign_forensic_audit.py — functional test against the real July 15 sequence
# ---------------------------------------------------------------------------

JULY15_DEALS_CSV = """Ticket,Time,Type,Volume,Price,Time_1,Price_1,Profit,Comment
1001,2026.07.15 15:30:00,sell,0.32,4035.09,2026.07.15 16:10:00,4034.94,58.80,TREND_PULLBACK [A]
1002,2026.07.15 16:20:00,sell,0.18,4027.58,2026.07.15 18:25:00,4038.62,-198.72,TREND_PULLBACK [A]
1003,2026.07.15 18:25:00,sell,0.35,4028.30,2026.07.15 18:25:12,4039.56,-394.10,TREND_PULLBACK [A]
1004,2026.07.15 18:32:43,buy,0.20,4050.52,2026.07.15 19:20:00,4053.45,58.60,TREND_PULLBACK [A]
1005,2026.07.16 09:00:00,sell,0.21,4053.37,2026.07.16 10:00:00,4066.49,-275.52,TREND_PULLBACK [A]
"""

MFE_MAE_CSV = """ticket,mae,mfe
1001,0.20,0.90
1002,1.10,0.15
1003,3.09,0.08
"""


def run_campaign_audit(tmp_path, extra_args=None):
    deals = tmp_path / "deals.csv"
    deals.write_text(JULY15_DEALS_CSV, encoding="utf-8")
    out = tmp_path / "report.json"
    cmd = [sys.executable, str(CAMPAIGN_SCRIPT), "--deals", str(deals), "--out", str(out)]
    if extra_args:
        cmd += extra_args
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr
    return json.loads(out.read_text())


def test_campaign_grouping_matches_the_real_july15_narrative(tmp_path):
    report = run_campaign_audit(tmp_path)
    assert report["total_trades_parsed"] == 5
    assert report["total_campaigns"] == 3
    # SELL core + 2 additions, then BUY, then a later separate SELL
    campaigns = report["campaigns"]
    assert campaigns[0]["direction"] == "SELL"
    assert campaigns[0]["addition_count"] == 2
    assert campaigns[0]["core_trade_ticket"] == "1001"
    assert campaigns[1]["direction"] == "BUY"
    assert campaigns[1]["addition_count"] == 0
    assert campaigns[2]["direction"] == "SELL"
    assert report["direction_flips"] == 2


def test_campaign_net_pl_is_realized_sum_not_fabricated(tmp_path):
    report = run_campaign_audit(tmp_path)
    sell_campaign = report["campaigns"][0]
    assert sell_campaign["net_pl"] == round(58.80 - 198.72 - 394.10, 2)


def test_bar_dependent_fields_are_null_with_explicit_reason_when_no_mfe_mae_csv(tmp_path):
    report = run_campaign_audit(tmp_path)
    c = report["campaigns"][0]
    assert c["campaign_mfe"] is None
    assert c["campaign_mae"] is None
    assert "_bar_dependent_fields_reason" in c
    assert "not derivable" in c["_bar_dependent_fields_reason"]


def test_mfe_mae_csv_fills_worst_case_not_best_case(tmp_path):
    mfe_mae = tmp_path / "mfe_mae.csv"
    mfe_mae.write_text(MFE_MAE_CSV, encoding="utf-8")
    report = run_campaign_audit(tmp_path, extra_args=["--mfe-mae-csv", str(mfe_mae)])
    c = report["campaigns"][0]
    # regression guard for the exact bug caught during self-review: MAE
    # must be the WORST (largest-magnitude) adverse excursion across the
    # campaign's trades (3.09, from ticket 1003), not the smallest (0.20)
    assert c["campaign_mae"] == 3.09
    assert c["campaign_mfe"] == 0.9


def test_no_mae_min_regression_in_source():
    src = CAMPAIGN_SCRIPT.read_text()
    assert 'min(m["mae"]' not in src
    assert 'max(m["mae"]' in src


# ---------------------------------------------------------------------------
# export_telemetry.py — functional test against real EA PrintFormat output
# ---------------------------------------------------------------------------

SAMPLE_JOURNAL_LINES = [
    "2026.07.15 18:25:12.251   DECISION_SNAPSHOT | symbol=XAUUSD generation=10 bar=2026.07.15 20:20 signal=SELL bias=SELL structure=BOS=-1 HTF=-1 regime=TREND_DOWN setup=TREND_PULLBACK setupScore=4.10 score=4.10 grade=A aiStatus=AI_NOT_CALLED horizon=INTRADAY_TREND",
    "2026.07.15 18:25:17.449   MARKET_THESIS | direction=BUY location=LOCATION_GOOD exhaustion=EXHAUSTION_LOW timing=TIMING_READY HTF=HTF_ALIGNED structure=STRUCTURE_SUPPORTS action=ALLOW_CORE reason=healthy campaign",
    "2026.07.15 18:27:44.198   STRUCTURAL_SL_TRACE | signal=SELL horizon=INTRADAY_TREND slSource=EMERGENCY_VOLATILITY_INVALIDATION rawLevel=0.00 buffer=0.45 finalSL=4051.35 slDist=12.62 applied=N",
    "2026.07.15 18:27:44.201   RISK_MARGIN_TRACE | horizon=INTRADAY_TREND slSource=EMERGENCY_VOLATILITY_INVALIDATION balance=$10000.00 equity=$9800.00 riskPct=15.000% riskUSD=$1500.00 slDist=12.62 moneyLossPerLotAtSL=$1262.00 rawLot=1.1885 normalizedLot=1.19 requiredMargin=$2380.00 freeMargin=$7500.00 marginReserve=$750.00(10.0%) finalLot=1.19 actualRiskPct=15.021% decision=APPROVED",
    "2026.07.15 18:25:12.300   CAMPAIGN_OPENED | CAMP-1 dir=SELL setup=TREND_PULLBACK horizon=INTRADAY_TREND invalidation=4051.35 dest1=3956.68 destPrimary=3956.68 destRunner=3956.68",
    "2026.07.15 18:30:20.010   CAMPAIGN_CLOSED | CAMP-1 dir=SELL finalRealizedPL=-302.88 additions=2 peakFloating=178.88 MFE=178.88 MAE=-302.88 givenBack=481.76",
    "2026.07.15 18:26:30.000   PYRAMID_BLOCKED_CAMPAIGN_EXHAUSTION: dir=SELL lifecycle=TREND_EXHAUSTING action=TRANSITION_STOP_ADDS exhaustion=88% remainingRewardR=0.30 oppositeRemainingRewardR=2.10",
]


def run_telemetry_export(tmp_path, machine_label="MAC"):
    log_path = tmp_path / "20260715.log"
    log_path.write_text("\n".join(SAMPLE_JOURNAL_LINES) + "\n", encoding="utf-16")
    out = tmp_path / "telemetry.json"
    cmd = [sys.executable, str(TELEMETRY_SCRIPT), "--log", str(log_path),
           "--machine-label", machine_label, "--out", str(out)]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr
    return json.loads(out.read_text())


def test_telemetry_parses_all_sample_record_types(tmp_path):
    export = run_telemetry_export(tmp_path)
    counts = export["record_counts"]
    for expected_type in ("decision_snapshot", "market_thesis", "structural_sl_trace",
                          "risk_margin_trace", "campaign_opened", "campaign_closed",
                          "pyramid_blocked_exhaustion"):
        assert counts.get(expected_type) == 1, f"{expected_type}: {counts}"


def test_telemetry_extracted_fields_are_correct_not_just_present(tmp_path):
    export = run_telemetry_export(tmp_path)
    snap = export["records_by_type"]["decision_snapshot"][0]
    assert snap["symbol"] == "XAUUSD"
    assert snap["signal"] == "SELL"
    assert snap["grade"] == "A"
    assert snap["horizon"] == "INTRADAY_TREND"
    closed = export["records_by_type"]["campaign_closed"][0]
    assert closed["campaign_id"] == "CAMP-1"
    assert closed["final_realized_pl"] == "-302.88"


def test_telemetry_machine_label_recorded_for_side_by_side_comparison(tmp_path):
    mac_export = run_telemetry_export(tmp_path, machine_label="MAC")
    assert mac_export["machine_label"] == "MAC"


def test_telemetry_timestamp_regex_does_not_swallow_message_content_regression():
    # regression guard for the exact bug caught during self-review: an
    # earlier version's prefix regex used a greedy \S* to skip a
    # source-tag token between the timestamp and the message, which (when
    # no such token was present) consumed the first real word of the
    # message instead -- verified by the functional tests above actually
    # parsing successfully, and asserted here at the source level.
    src = TELEMETRY_SCRIPT.read_text()
    assert "LOG_LINE_PREFIX" not in src  # old, buggy approach removed
    assert "LOG_LINE_TIMESTAMP" in src
    assert "pattern.search(line)" in src  # searches the full line, not a hand-stripped message


def test_telemetry_patterns_reference_the_actual_ea_printformat_markers():
    # cross-check the parser's marker strings actually exist verbatim in
    # the EA source it's meant to parse -- catches silent drift if the EA's
    # log format ever changes without updating this script.
    ea = BACKEND_EA.read_text(encoding="utf-8", errors="ignore")
    telemetry_src = TELEMETRY_SCRIPT.read_text()
    for marker in ("DECISION_SNAPSHOT |", "MARKET_THESIS |", "STRUCTURAL_SL_TRACE |",
                   "RISK_MARGIN_TRACE |", "CAMPAIGN_OPENED |", "CAMPAIGN_CLOSED |",
                   "PYRAMID_BLOCKED_CAMPAIGN_EXHAUSTION:"):
        assert marker in ea, f"EA no longer emits {marker!r}"
        assert marker.split(" ")[0].rstrip("|:") in telemetry_src
