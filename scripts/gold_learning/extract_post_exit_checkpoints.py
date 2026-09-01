#!/usr/bin/env python3
"""Extract the EA's own real post-close exit-brain checkpoint data
(5/10/15/30/60 minutes) from the ORIGINAL, unmodified 60-day postfix
journal -- InpTradeBrainMemory=true and InpTradeBrainMonitorAfterExit=true
were both confirmed active for this exact run (see the tester report's own
input dump), so this data is real EXACT_JOURNAL evidence, not a
reconstruction.

Source lines, printed by XAU_UpdateClosedTradeOutcomes() at each real
checkpoint:

  EXIT-BRAIN CHECK: posId=<N> <VERDICT> checkpoint=<M>m closeProfit=$<X>
  maxMore=<A>ATR($<B>) maxReverse=<C>ATR($<D>) closePrice=<E> current=<F>

closePrice/current use the EA's own bid/ask MIDPOINT convention (not the
strict Bid-for-BUY/Ask-for-SELL executable price this analysis otherwise
uses) -- disclosed explicitly in the method/limitations doc, not silently
substituted.

maxMore/maxReverse are cumulative running maxima since close, already
clamped at >= 0 by construction (MathMax against 0.0 baseline), i.e.
maxMore already equals exactly what this analysis calls MISSED_R (in ATR
units here; converted to R using each position's own real SL distance
from 60DAY_ALL_POSITIONS.csv).
"""
import argparse
import csv
import re
from pathlib import Path

CHECK_RE = re.compile(
    r"EXIT-BRAIN CHECK: posId=(?P<posid>\d+) (?P<verdict>[A-Z_]+) checkpoint=(?P<checkpoint>\d+)m "
    r"closeProfit=\$(?P<closeprofit>-?[\d.]+) maxMore=(?P<maxmore>-?[\d.]+)ATR\(\$(?P<missedmoney>-?[\d.]+)\) "
    r"maxReverse=(?P<maxreverse>-?[\d.]+)ATR\(\$(?P<avoidedmoney>-?[\d.]+)\) "
    r"closePrice=(?P<closeprice>-?[\d.]+) current=(?P<current>-?[\d.]+)"
)
WATCH_RE = re.compile(
    r"EXIT-BRAIN WATCH: posId=(?P<posid>\d+) closePrice=(?P<closeprice>-?[\d.]+) "
    r"closeProfit=\$(?P<closeprofit>-?[\d.]+)"
)


def scan(journal_path: Path):
    checkpoints = {}  # posid -> {checkpoint_min -> row}
    watches = {}       # posid -> closePrice (sanity cross-check)

    with journal_path.open("r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            if "EXIT-BRAIN CHECK" in line:
                m = CHECK_RE.search(line)
                if not m:
                    continue
                posid = m.group("posid")
                cp = int(m.group("checkpoint"))
                checkpoints.setdefault(posid, {})[cp] = {
                    "verdict": m.group("verdict"),
                    "close_profit": float(m.group("closeprofit")),
                    "max_more_atr": float(m.group("maxmore")),
                    "missed_money": float(m.group("missedmoney")),
                    "max_reverse_atr": float(m.group("maxreverse")),
                    "avoided_money": float(m.group("avoidedmoney")),
                    "close_price": float(m.group("closeprice")),
                    "price_at_checkpoint": float(m.group("current")),
                }
            elif "EXIT-BRAIN WATCH" in line:
                m = WATCH_RE.search(line)
                if not m:
                    continue
                watches[m.group("posid")] = float(m.group("closeprice"))

    return checkpoints, watches


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--journal", required=True, type=Path)
    ap.add_argument("--positions-csv", required=True, type=Path)
    ap.add_argument("--out-dir", required=True, type=Path)
    args = ap.parse_args()

    print("Scanning journal for EXIT-BRAIN WATCH/CHECK lines...")
    checkpoints, watches = scan(args.journal)
    print(f"  {len(watches)} positions watched, {len(checkpoints)} positions with >=1 checkpoint")

    with args.positions_csv.open() as f:
        positions = list(csv.DictReader(f))

    rows = []
    checkpoint_mins = [5, 10, 15, 30, 60]
    for pos in positions:
        ticket = pos["ticket"]
        cps = checkpoints.get(ticket)
        row = {
            "ticket": ticket,
            "campaign_id": pos["campaign_id"],
            "leg_role": pos["leg_role"],
            "direction": pos["direction"],
            "result": pos["result"],
            "close_price_watch": watches.get(ticket),
            "watched": ticket in watches,
        }
        for m in checkpoint_mins:
            c = (cps or {}).get(m)
            row[f"checkpoint_{m}m_verdict"] = c["verdict"] if c else None
            row[f"checkpoint_{m}m_max_more_atr"] = c["max_more_atr"] if c else None
            row[f"checkpoint_{m}m_max_reverse_atr"] = c["max_reverse_atr"] if c else None
            row[f"checkpoint_{m}m_missed_money"] = c["missed_money"] if c else None
            row[f"checkpoint_{m}m_avoided_money"] = c["avoided_money"] if c else None
            row[f"checkpoint_{m}m_price_mid"] = c["price_at_checkpoint"] if c else None
        rows.append(row)

    fieldnames = list(rows[0].keys())
    out_csv = args.out_dir / "_post_close_checkpoints_5_10_15_30_60m.csv"
    with out_csv.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            w.writerow(r)

    watched_count = sum(1 for r in rows if r["watched"])
    has_10m = sum(1 for r in rows if r["checkpoint_10m_max_more_atr"] is not None)
    print(f"Wrote {len(rows)} rows to {out_csv}")
    print(f"  watched (EXIT-BRAIN WATCH found): {watched_count} / {len(rows)}")
    print(f"  has 10m checkpoint data: {has_10m} / {len(rows)}")


if __name__ == "__main__":
    main()
