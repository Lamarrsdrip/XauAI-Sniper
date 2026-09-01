#!/usr/bin/env python3
"""Build the public 30-day replay snapshot from an MT5 HTML report.

Only the Strategy Tester's summary table and broker-confirmed Deals table are
used.  No trade card or aggregate is copied from a prior website snapshot.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.gold_learning.extract_60day_postfix_trades import (
    pair_positions_from_deals,
    parse_report_deals,
)


class _Rows(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.rows: list[list[str]] = []
        self._row: list[str] | None = None
        self._cell: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() == "tr":
            self._row = []
        elif tag.lower() in {"td", "th"} and self._row is not None:
            self._cell = []

    def handle_data(self, data: str) -> None:
        if self._cell is not None:
            self._cell.append(data)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in {"td", "th"} and self._cell is not None and self._row is not None:
            self._row.append(" ".join("".join(self._cell).split()))
            self._cell = None
        elif tag == "tr" and self._row is not None:
            self.rows.append(self._row)
            self._row = None


def _report_rows(report: Path) -> list[list[str]]:
    raw = report.read_bytes()
    try:
        text = raw.decode("utf-16")
    except UnicodeError:
        text = raw.decode("utf-8", errors="replace")
    parser = _Rows()
    parser.feed(text)
    return parser.rows


def _value(rows: list[list[str]], label: str) -> str:
    for row in rows:
        for index, cell in enumerate(row[:-1]):
            if cell.rstrip(":") == label.rstrip(":"):
                return row[index + 1]
    raise ValueError(f"MT5 report field not found: {label}")


def _number(value: str) -> float:
    match = re.search(r"[-+]?\d[\d\s]*(?:\.\d+)?", value.replace("\xa0", " "))
    if not match:
        raise ValueError(f"No number in MT5 value: {value!r}")
    return float(match.group(0).replace(" ", ""))


def _count_and_pct(value: str) -> tuple[int, float]:
    match = re.fullmatch(r"\s*(\d+)\s*\(([\d.]+)%\)\s*", value)
    if not match:
        raise ValueError(f"Expected MT5 count/percentage pair: {value!r}")
    return int(match.group(1)), float(match.group(2))


def _iso(value: str) -> str:
    return datetime.strptime(value, "%Y.%m.%d %H:%M:%S").replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")


def build_snapshot(report: Path, evidence_path: str) -> dict[str, object]:
    rows = _report_rows(report)
    deals = parse_report_deals(report)
    positions = pair_positions_from_deals(deals)

    period_match = re.fullmatch(r"M10 \((\d{4}\.\d{2}\.\d{2}) - (\d{4}\.\d{2}\.\d{2})\)", _value(rows, "Period"))
    if not period_match:
        raise ValueError("Expected the verified M10 report period")

    total_trades = int(_number(_value(rows, "Total Trades")))
    wins, win_rate = _count_and_pct(_value(rows, "Profit Trades (% of total)"))
    losses, _ = _count_and_pct(_value(rows, "Loss Trades (% of total)"))
    shorts, short_win_rate = _count_and_pct(_value(rows, "Short Trades (won %)"))
    longs, long_win_rate = _count_and_pct(_value(rows, "Long Trades (won %)"))
    equity_relative_dd = _number(_value(rows, "Equity Drawdown Relative"))
    balance_max_text = _value(rows, "Balance Drawdown Maximal")
    balance_max_match = re.fullmatch(r"([\d\s.]+) \(([\d.]+)%\)", balance_max_text)
    if not balance_max_match:
        raise ValueError(f"Expected balance maximal drawdown pair: {balance_max_text!r}")

    trades = []
    for position in positions:
        direction_factor = 1 if position["direction"] == "BUY" else -1
        gold_moves = (position["exit_price"] - position["entry_price"]) * direction_factor
        profit = position["realized_profit_usd"] + position["commission"] + position["swap"]
        trades.append({
            "open_time": _iso(position["entry_time"]),
            "close_time": _iso(position["exit_time"]),
            "direction": position["direction"],
            "entry_price": position["entry_price"],
            "exit_price": position["exit_price"],
            "volume": position["volume"],
            "profit_usd": round(profit, 2),
            "gold_moves": round(gold_moves, 2),
            "pips": round(gold_moves * 10, 1),
            "result": "WIN" if profit > 0 else "LOSS" if profit < 0 else "BE",
        })

    if len(trades) != total_trades or wins + losses != total_trades:
        raise ValueError("Deals table does not reconcile with the MT5 summary trade counts")

    net_profit = round(sum(t["profit_usd"] for t in trades), 2)
    report_net_profit = _number(_value(rows, "Total Net Profit"))
    if abs(net_profit - report_net_profit) > 0.01:
        raise ValueError(f"Deals net {net_profit} does not reconcile with report net {report_net_profit}")

    total_gold_moves = round(sum(t["gold_moves"] for t in trades), 2)
    total_pips = round(sum(t["pips"] for t in trades), 1)
    period_start = period_match.group(1).replace(".", "-")
    period_end = period_match.group(2).replace(".", "-")
    return {
        "meta": {
            "title": "30-Day Real Gold Replay",
            "source": "MetaTrader 5 Strategy Tester, 100% real historical ticks",
            "ea_binary": "XauCloud.io.ex5",
            "ea_version_string": "XauCloud-m10_v6.26.3_PATTERN_ENGINE_BREAKOUT_B_V4_AUDITED",
            "tested_expert": _value(rows, "Expert"),
            "symbol": _value(rows, "Symbol").split()[0],
            "timeframe": "M10",
            "period_start": period_start,
            "period_end": period_end,
            "history_quality": _value(rows, "History Quality"),
            "bars": int(_number(_value(rows, "Bars"))),
            "ticks": int(_number(_value(rows, "Ticks"))),
            "initial_deposit_usd": _number(_value(rows, "Initial Deposit")),
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
            "report_evidence_file": evidence_path,
            "update_cadence": "Replay evidence for the current XauCloud.io production build.",
            "disclaimer": "Backtest replay against real historical tick data, not independently verified, and not a guarantee of future performance. Trading involves risk.",
        },
        "summary": {
            "total_trades": total_trades,
            "wins": wins,
            "losses": losses,
            "win_rate_pct": win_rate,
            "short_trades": shorts,
            "short_win_rate_pct": short_win_rate,
            "long_trades": longs,
            "long_win_rate_pct": long_win_rate,
            "net_profit_usd": report_net_profit,
            "gross_profit_usd": _number(_value(rows, "Gross Profit")),
            "gross_loss_usd": _number(_value(rows, "Gross Loss")),
            "profit_factor": _number(_value(rows, "Profit Factor")),
            "max_balance_drawdown_usd": _number(balance_max_match.group(1)),
            "max_balance_drawdown_pct": float(balance_max_match.group(2)),
            "equity_relative_drawdown_pct": equity_relative_dd,
            "total_pips": total_pips,
            "total_gold_moves": total_gold_moves,
            "largest_winning_trade_usd": _number(_value(rows, "Largest profit trade")),
            "largest_losing_trade_usd": _number(_value(rows, "Largest loss trade")),
        },
        "trades": trades,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("report", type=Path)
    parser.add_argument("--output", type=Path, action="append", required=True)
    parser.add_argument("--evidence-path", required=True)
    args = parser.parse_args()
    snapshot = build_snapshot(args.report, args.evidence_path)
    rendered = json.dumps(snapshot, indent=2) + "\n"
    for output in args.output:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(rendered, encoding="utf-8")


if __name__ == "__main__":
    main()
