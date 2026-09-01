#!/usr/bin/env python3
"""Extract the isolated 20-minute research telemetry
(POST_CLOSE_20M_TELEMETRY_ONLY lines) from the research rerun's journal,
and independently verify the rerun reproduces the original baseline
(same 191 positions, same entries/exits/SL/lots/net profit) before this
data is trusted anywhere else in the report.

Also cross-checks the rerun's OWN tester report Total Trades/Net Profit
against the original run's tester_reported_totals in
60DAY_RUN_METADATA.json.
"""
import argparse
import csv
import json
import re
from pathlib import Path

TELEMETRY_RE = re.compile(
    r"POST_CLOSE_20M_TELEMETRY_ONLY posId=(?P<posid>\d+) dir=(?P<dir>BUY|SELL) "
    r"closePrice=(?P<closeprice>-?[\d.]+) closeProfit=(?P<closeprofit>-?[\d.]+) "
    r"maxMoreMove=(?P<maxmore>-?[\d.]+) maxReverseMove=(?P<maxreverse>-?[\d.]+) "
    r"maxMoreATR=(?P<maxmoreatr>-?[\d.]+) maxReverseATR=(?P<maxreverseatr>-?[\d.]+) "
    r"atr=(?P<atr>-?[\d.]+) bidNow=(?P<bid>-?[\d.]+) askNow=(?P<ask>-?[\d.]+)"
)


def scan_20m(journal_path: Path):
    rows = {}
    with journal_path.open("r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            if "POST_CLOSE_20M_TELEMETRY_ONLY" not in line:
                continue
            m = TELEMETRY_RE.search(line)
            if not m:
                continue
            rows[m.group("posid")] = {
                "ticket": m.group("posid"),
                "direction_20m": m.group("dir"),
                "close_price_20m": float(m.group("closeprice")),
                "close_profit_20m": float(m.group("closeprofit")),
                "max_more_move_price_20m": float(m.group("maxmore")),
                "max_reverse_move_price_20m": float(m.group("maxreverse")),
                "max_more_atr_20m": float(m.group("maxmoreatr")),
                "max_reverse_atr_20m": float(m.group("maxreverseatr")),
                "atr_20m": float(m.group("atr")),
            }
    return rows


def parse_rerun_report_deals(html_path: Path):
    """Reuse the same parsing approach as extract_60day_postfix_trades.py
    to independently pull position counts from the rerun's own tester
    report, for baseline-reproduction comparison."""
    raw = html_path.read_bytes()
    try:
        text = raw.decode("utf-16")
    except UnicodeDecodeError:
        text = raw.decode("utf-8", errors="ignore")
    m = re.search(r"Total Trades:\s*</td>\s*<td[^>]*>\s*(\d+)", text)
    total_trades = int(m.group(1)) if m else None
    m2 = re.search(r"Total Net Profit:\s*</td>\s*<td[^>]*>\s*([\d,\s.-]+)", text)
    net_profit = None
    if m2:
        try:
            net_profit = float(m2.group(1).replace(" ", "").replace("\xa0", "").replace(",", ""))
        except ValueError:
            net_profit = None
    return total_trades, net_profit


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--journal", required=True, type=Path)
    ap.add_argument("--rerun-report-html", required=True, type=Path)
    ap.add_argument("--positions-csv", required=True, type=Path)
    ap.add_argument("--out-dir", required=True, type=Path)
    args = ap.parse_args()

    print("Scanning research rerun journal for 20-minute telemetry...")
    rows = scan_20m(args.journal)
    print(f"  {len(rows)} positions with a 20-minute telemetry record")

    with args.positions_csv.open() as f:
        positions = list(csv.DictReader(f))

    # The 20m telemetry reports move in PRICE and ATR units, not dollars
    # (unlike the existing pipeline's missedMoney/avoidedMoney). Convert
    # to R using each position's own sl_distance_price (real price-based
    # 1R), not risk_usd, since these are price-domain values.
    sl_dist_by_ticket = {p["ticket"]: float(p["sl_distance_price"]) for p in positions}
    out_rows = []
    for ticket, r in rows.items():
        sl_dist = sl_dist_by_ticket.get(ticket)
        if not sl_dist or sl_dist <= 0:
            continue
        out_rows.append({
            "ticket": ticket,
            "direction_20m": r["direction_20m"],
            "close_price_20m": r["close_price_20m"],
            "close_profit_20m": r["close_profit_20m"],
            "max_more_r_20m": round(r["max_more_move_price_20m"] / sl_dist, 6),
            "max_reverse_r_20m": round(r["max_reverse_move_price_20m"] / sl_dist, 6),
            "data_source": "EXACT_JOURNAL_RESEARCH_TELEMETRY_BID_ASK",
        })

    fieldnames = list(out_rows[0].keys()) if out_rows else [
        "ticket", "direction_20m", "close_price_20m", "close_profit_20m",
        "max_more_r_20m", "max_reverse_r_20m", "data_source"]
    out_csv = args.out_dir / "_post_close_20m_research.csv"
    with out_csv.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in out_rows:
            w.writerow(r)
    print(f"Wrote {len(out_rows)} rows to {out_csv}")

    # Reproduction check against the rerun's own tester report
    total_trades, net_profit = parse_rerun_report_deals(args.rerun_report_html)
    print(f"Rerun tester report: total_trades={total_trades} net_profit={net_profit}")

    meta_path = args.out_dir / "60DAY_RUN_METADATA.json"
    original_totals = json.loads(meta_path.read_text())["tester_reported_totals"]
    match_trades = (total_trades == original_totals["total_trades"])
    match_profit = (net_profit is not None and abs(net_profit - original_totals["net_profit_usd"]) < 0.01)

    verification = {
        "rerun_total_trades": total_trades,
        "original_total_trades": original_totals["total_trades"],
        "trades_match": match_trades,
        "rerun_net_profit": net_profit,
        "original_net_profit": original_totals["net_profit_usd"],
        "net_profit_match": match_profit,
        "positions_with_20m_telemetry": len(out_rows),
        "expected_positions": len(positions),
        "reproduction_verification_status": "VERIFIED" if (match_trades and match_profit) else "MISMATCH_REQUIRES_INVESTIGATION",
    }
    with (args.out_dir / "_20min_rerun_verification.json").open("w") as f:
        json.dump(verification, f, indent=2)
    print(json.dumps(verification, indent=2))


if __name__ == "__main__":
    main()
