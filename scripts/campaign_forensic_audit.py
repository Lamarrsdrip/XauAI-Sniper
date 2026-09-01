#!/usr/bin/env python3
"""Reusable campaign forensic tooling — groups historical closed trades into
campaigns (the same concept as the live EA's v6.24.9 XAU_CampaignState:
one core position plus its additions, same direction, same market move)
and computes per-campaign metrics.

Works on ANY historical window, not just July 15 — pass any exported deal
history. Uses closed-trade data only for auditing/learning; it never feeds
these grouped results back into the live decision path (that would be
exactly the "hindsight variable in live decision logic" the audits this
tool follows explicitly warn against — see
audits/v6243_mac_vps_trade_learning_20260715.md's "no-hindsight rule").

Input: an MT5-exported deal-history CSV. MT5's own "Report as CSV" and the
HistoryDeal*-based exports used elsewhere in this repo (see
scripts/audit_v6232_active_intelligence.py) both commonly use UTF-16
encoding — this script tries UTF-16 first, falls back to UTF-8. Column
names vary by export method and broker, so headers are matched
case-insensitively against a set of known aliases (see COLUMN_ALIASES)
rather than hardcoded to one exact schema.

Grouping heuristic (documented, not hidden): consecutive deals in the same
direction are the same campaign if the gap between one close and the next
open is <= --max-gap-minutes (default 240 = 4 hours, roughly a session).
A direction change always starts a new campaign. This is a reasonable
retroactive proxy for "same market move" from closed-trade records alone;
it is coarser than the live EA's real-time campaign object (which has
direct knowledge of the actual PRIMARY/RE_ENTRY/PYRAMID relationship via
CheckPyramidOpportunity's own lastPyramidPx spacing check) and should be
read as an audit approximation, not ground truth.

Known limitation, stated plainly: peak floating profit, campaign MFE/MAE,
and "movement captured vs missed" require intraday price data (M1/M5 bars
or tick history) between each position's open and close, not just the
closed-deal record. This script computes what IS derivable from
closed-trade data alone (realized P/L, timing, lot sizing, addition
counts, direction flips) and leaves those bar-dependent fields as null
with an explicit reason, rather than fabricating them. For those metrics,
pair this script's campaign grouping with the existing chart-replay
process documented in audits/v6243_mac_vps_trade_learning_20260715.md
(which already computes real MAE/MFE from M5 bars per position) by
passing --mfe-mae-csv (see below).

Usage:
    python3 campaign_forensic_audit.py --deals /path/to/deal_history.csv --out /path/to/report.json
    python3 campaign_forensic_audit.py --deals deals.csv --mfe-mae-csv mfe_mae.csv --out report.json

Raw account-identifying export files are NOT committed to this repo (same
convention as scripts/audit_v6232_active_intelligence.py) -- point --deals
at a file outside the repo.
"""

import argparse
import csv
import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional


COLUMN_ALIASES = {
    "open_time": ["time", "open time", "opentime", "time_open", "position_time"],
    "close_time": ["close time", "closetime", "time_close", "time_1", "time.1"],
    "direction": ["type", "direction", "position_type"],
    "volume": ["volume", "lots", "size"],
    "open_price": ["price", "open price", "openprice", "price_open"],
    "close_price": ["price_1", "close price", "closeprice", "price.1", "price_close"],
    "profit": ["profit", "p/l", "pnl", "net_profit"],
    "symbol": ["symbol"],
    "comment": ["comment", "setup", "reason"],
    "ticket": ["ticket", "position", "deal", "order"],
}


def read_deal_csv(path: Path):
    for encoding in ("utf-16", "utf-8-sig", "utf-8"):
        try:
            with path.open("r", encoding=encoding, newline="") as handle:
                rows = list(csv.DictReader(handle))
            if rows:
                return rows
        except (UnicodeError, UnicodeDecodeError):
            continue
    raise ValueError(f"could not read {path} as utf-16, utf-8-sig, or utf-8 CSV")


def resolve_columns(fieldnames) -> dict:
    lower_map = {fn.strip().lower(): fn for fn in fieldnames}
    resolved = {}
    for canonical, aliases in COLUMN_ALIASES.items():
        for alias in aliases:
            if alias in lower_map:
                resolved[canonical] = lower_map[alias]
                break
    missing = [c for c in ("open_time", "direction", "profit") if c not in resolved]
    if missing:
        raise ValueError(
            f"required columns not found (tried aliases {missing}); "
            f"available columns: {sorted(fieldnames)}"
        )
    return resolved


def parse_mt5_time(value: str) -> datetime:
    value = value.strip()
    for fmt in ("%Y.%m.%d %H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y.%m.%d %H:%M", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    raise ValueError(f"unrecognized MT5 timestamp format: {value!r}")


def parse_direction(value: str) -> int:
    v = value.strip().lower()
    if v in ("buy", "0", "long", "position_type_buy"):
        return 1
    if v in ("sell", "1", "short", "position_type_sell"):
        return -1
    raise ValueError(f"unrecognized direction value: {value!r}")


@dataclass
class ClosedTrade:
    open_time: datetime
    close_time: Optional[datetime]
    direction: int
    volume: float
    open_price: float
    close_price: Optional[float]
    profit: float
    ticket: str
    comment: str


@dataclass
class Campaign:
    campaign_id: int
    direction: int
    trades: list = field(default_factory=list)

    @property
    def start(self):
        return min(t.open_time for t in self.trades)

    @property
    def end(self):
        closes = [t.close_time for t in self.trades if t.close_time]
        return max(closes) if closes else None

    @property
    def core_trade(self):
        return min(self.trades, key=lambda t: t.open_time)

    @property
    def additions(self):
        core = self.core_trade
        return [t for t in self.trades if t is not core]

    @property
    def gross_profit(self):
        return sum(t.profit for t in self.trades if t.profit > 0)

    @property
    def gross_loss(self):
        return sum(t.profit for t in self.trades if t.profit < 0)

    @property
    def net_pl(self):
        return sum(t.profit for t in self.trades)

    def to_dict(self):
        return {
            "campaign_id": self.campaign_id,
            "direction": "BUY" if self.direction == 1 else "SELL",
            "start": self.start.isoformat(),
            "end": self.end.isoformat() if self.end else None,
            "core_trade_ticket": self.core_trade.ticket,
            "core_trade_open_price": self.core_trade.open_price,
            "addition_count": len(self.additions),
            "addition_tickets": [t.ticket for t in self.additions],
            "trade_count": len(self.trades),
            "gross_profit": round(self.gross_profit, 2),
            "gross_loss": round(self.gross_loss, 2),
            "net_pl": round(self.net_pl, 2),
            "peak_floating_profit": None,
            "campaign_mfe": None,
            "campaign_mae": None,
            "movement_captured_pct": None,
            "movement_missed_pct": None,
            "_bar_dependent_fields_reason": (
                "requires intraday M1/M5 bars between open/close per trade; "
                "not derivable from closed-deal records alone -- pass "
                "--mfe-mae-csv from the chart-replay process (see "
                "audits/v6243_mac_vps_trade_learning_20260715.md) to fill these"
            ),
        }


def group_into_campaigns(trades: list, max_gap: timedelta) -> list:
    trades_sorted = sorted(trades, key=lambda t: t.open_time)
    campaigns = []
    current: Optional[Campaign] = None
    next_id = 1
    last_close_by_dir = {1: None, -1: None}

    for t in trades_sorted:
        same_direction_recent = (
            current is not None
            and current.direction == t.direction
            and last_close_by_dir[t.direction] is not None
            and (t.open_time - last_close_by_dir[t.direction]) <= max_gap
        )
        if not same_direction_recent:
            current = Campaign(campaign_id=next_id, direction=t.direction)
            next_id += 1
            campaigns.append(current)
        current.trades.append(t)
        if t.close_time:
            last_close_by_dir[t.direction] = t.close_time

    return campaigns


def compute_direction_flips(campaigns: list) -> int:
    flips = 0
    prev_dir = None
    for c in sorted(campaigns, key=lambda c: c.start):
        if prev_dir is not None and c.direction != prev_dir:
            flips += 1
        prev_dir = c.direction
    return flips


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--deals", type=Path, required=True, help="MT5 deal-history export CSV (outside the repo)")
    parser.add_argument("--out", type=Path, required=True, help="output JSON report path")
    parser.add_argument("--max-gap-minutes", type=int, default=240,
                        help="max minutes between close and next same-direction open to stay one campaign (default 240)")
    parser.add_argument("--mfe-mae-csv", type=Path, default=None,
                        help="optional: chart-replay output with per-ticket MAE/MFE (ticket,mae,mfe columns) to fill the bar-dependent fields")
    args = parser.parse_args()

    rows = read_deal_csv(args.deals)
    cols = resolve_columns(rows[0].keys())

    trades = []
    for row in rows:
        try:
            direction = parse_direction(row[cols["direction"]])
        except ValueError:
            continue  # skip non-trade deal rows (balance/credit/etc.)
        open_time = parse_mt5_time(row[cols["open_time"]])
        close_time = None
        if "close_time" in cols and row.get(cols["close_time"]):
            try:
                close_time = parse_mt5_time(row[cols["close_time"]])
            except ValueError:
                close_time = None
        trades.append(ClosedTrade(
            open_time=open_time,
            close_time=close_time,
            direction=direction,
            volume=float(row.get(cols.get("volume", ""), 0) or 0),
            open_price=float(row.get(cols.get("open_price", ""), 0) or 0),
            close_price=float(row.get(cols.get("close_price", ""), 0) or 0) if cols.get("close_price") else None,
            profit=float(row[cols["profit"]] or 0),
            ticket=str(row.get(cols.get("ticket", ""), "")),
            comment=str(row.get(cols.get("comment", ""), "")),
        ))

    if not trades:
        raise SystemExit("no parseable trade rows found in the deal-history CSV")

    campaigns = group_into_campaigns(trades, timedelta(minutes=args.max_gap_minutes))

    mfe_mae_by_ticket = {}
    if args.mfe_mae_csv and args.mfe_mae_csv.exists():
        for row in read_deal_csv(args.mfe_mae_csv):
            tk = str(row.get("ticket", ""))
            if tk:
                mfe_mae_by_ticket[tk] = {
                    "mae": float(row.get("mae", 0) or 0),
                    "mfe": float(row.get("mfe", 0) or 0),
                }

    campaign_dicts = []
    for c in campaigns:
        d = c.to_dict()
        trade_mfe_mae = [mfe_mae_by_ticket[t.ticket] for t in c.trades if t.ticket in mfe_mae_by_ticket]
        if trade_mfe_mae:
            # Both MFE and MAE are recorded as positive magnitudes (see the
            # Mac chart-replay convention this pairs with in
            # audits/v6243_mac_vps_trade_learning_20260715.md, e.g. "MAE
            # 3.09 ATR"). The campaign's worst moment is the deepest
            # (largest) adverse excursion across its trades, not the
            # smallest -- max() for both, not min() for MAE.
            d["campaign_mfe"] = round(max(m["mfe"] for m in trade_mfe_mae), 3)
            d["campaign_mae"] = round(max(m["mae"] for m in trade_mfe_mae), 3)
            d["_bar_dependent_fields_reason"] = "filled from --mfe-mae-csv for trades with a matching ticket"
        campaign_dicts.append(d)

    report = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "source_file": str(args.deals),
        "max_gap_minutes": args.max_gap_minutes,
        "total_trades_parsed": len(trades),
        "total_campaigns": len(campaigns),
        "direction_flips": compute_direction_flips(campaigns),
        "total_net_pl": round(sum(c.net_pl for c in campaigns), 2),
        "campaigns": campaign_dicts,
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"Wrote {len(campaigns)} campaigns ({len(trades)} trades) to {args.out}")


if __name__ == "__main__":
    main()
