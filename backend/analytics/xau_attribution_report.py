#!/usr/bin/env python3
"""Generate evidence-based XAU EA attribution reports from MT5 brain CSV files.

This is deliberately read-only. It does not tune parameters or add trade rules.
It turns the EA's executed-trade and blocked-trade memory into weekly evidence:
which grades, setups, blocks, exits, and protections helped or hurt expectancy.
"""

from __future__ import annotations

import argparse
import csv
import math
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Iterable


DATE_FORMATS = ("%Y.%m.%d %H:%M:%S", "%Y-%m-%d %H:%M:%S")


def parse_time(value: str) -> datetime | None:
    value = (value or "").strip()
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            pass
    return None


def fnum(value: str | float | int | None, default: float = 0.0) -> float:
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def inum(value: str | int | None, default: int = 0) -> int:
    try:
        if value is None or value == "":
            return default
        return int(float(value))
    except (TypeError, ValueError):
        return default


def pct(numerator: float, denominator: float) -> float:
    return 0.0 if denominator == 0 else numerator / denominator * 100.0


def money(value: float) -> str:
    sign = "-" if value < 0 else ""
    return f"{sign}${abs(value):,.2f}"


def ratio(value: float) -> str:
    if value >= 999:
        return "inf"
    return f"{value:.2f}"


@dataclass
class MetricBucket:
    trades: int = 0
    wins: int = 0
    gross_win: float = 0.0
    gross_loss: float = 0.0
    net: float = 0.0
    worst_dd_sum: float = 0.0
    largest_dd: float = 0.0
    time_negative: int = 0
    recovery_wins: int = 0
    post_early: int = 0
    post_good: int = 0
    post_mixed: int = 0

    def add_close(self, row: dict[str, str]) -> None:
        profit = fnum(row.get("profit"))
        worst = fnum(row.get("worstFloating"))
        self.trades += 1
        self.net += profit
        self.worst_dd_sum += worst
        self.largest_dd = min(self.largest_dd, worst)
        self.time_negative += inum(row.get("secondsNegative"))
        if profit >= 0.01:
            self.wins += 1
            self.gross_win += profit
        elif profit <= -0.01:
            self.gross_loss += abs(profit)
        outcome = row.get("outcome", "")
        if outcome in {"WIN_AFTER_DEEP_DD", "WEAK_RECOVERY_WIN"}:
            self.recovery_wins += 1

    def add_post_close(self, row: dict[str, str]) -> None:
        outcome = row.get("outcome", "")
        if outcome == "EXIT_EARLY_LEFT_PROFIT":
            self.post_early += 1
        elif outcome == "EXIT_GOOD_AVOIDED_REVERSAL":
            self.post_good += 1
        elif outcome == "EXIT_MIXED_VOLATILE_AFTER_CLOSE":
            self.post_mixed += 1

    @property
    def win_rate(self) -> float:
        return pct(self.wins, self.trades)

    @property
    def profit_factor(self) -> float:
        if self.gross_loss > 0:
            return self.gross_win / self.gross_loss
        return 999.0 if self.gross_win > 0 else 0.0

    @property
    def expectancy(self) -> float:
        return 0.0 if self.trades == 0 else self.net / self.trades

    @property
    def avg_dd(self) -> float:
        return 0.0 if self.trades == 0 else self.worst_dd_sum / self.trades


@dataclass
class BlockBucket:
    blocked: int = 0
    checks: int = 0
    fav_5: list[float] = field(default_factory=list)
    fav_15: list[float] = field(default_factory=list)
    fav_30: list[float] = field(default_factory=list)
    fav_60: list[float] = field(default_factory=list)
    adv_30: list[float] = field(default_factory=list)
    adv_60: list[float] = field(default_factory=list)
    would_win: int = 0
    would_loss: int = 0

    def add(self, row: dict[str, str]) -> None:
        event = row.get("event", "")
        if event == "BLOCKED":
            self.blocked += 1
            return
        if event != "CHECK":
            return
        self.checks += 1
        checkpoint = inum(row.get("checkpointMin"))
        fav = fnum(row.get("favATR"))
        adv = fnum(row.get("advATR"))
        if checkpoint == 5:
            self.fav_5.append(fav)
        elif checkpoint == 15:
            self.fav_15.append(fav)
        elif checkpoint == 30:
            self.fav_30.append(fav)
            self.adv_30.append(adv)
        elif checkpoint == 60:
            self.fav_60.append(fav)
            self.adv_60.append(adv)
        if checkpoint >= 30:
            if fav >= 2.0 and adv < 1.2:
                self.would_win += 1
            elif adv >= 1.0 and fav < 1.5:
                self.would_loss += 1

    @staticmethod
    def avg(values: list[float]) -> float:
        return 0.0 if not values else sum(values) / len(values)

    @property
    def avg_missed_5(self) -> float:
        return self.avg(self.fav_5)

    @property
    def avg_missed_15(self) -> float:
        return self.avg(self.fav_15)

    @property
    def avg_missed_30(self) -> float:
        return self.avg(self.fav_30)

    @property
    def avg_missed_60(self) -> float:
        return self.avg(self.fav_60)

    @property
    def avg_saved_60(self) -> float:
        return self.avg(self.adv_60 or self.adv_30)

    @property
    def protection_score(self) -> float:
        return self.avg_saved_60 - self.avg_missed_60


def read_csv(path: Path) -> list[dict[str, str]]:
    if not path or not path.exists():
        return []
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def filter_rows(rows: Iterable[dict[str, str]], days: int) -> list[dict[str, str]]:
    cutoff = datetime.now() - timedelta(days=days)
    out: list[dict[str, str]] = []
    for row in rows:
        ts = parse_time(row.get("time", ""))
        if ts is None or ts >= cutoff:
            out.append(row)
    return out


def max_drawdown_from_closes(close_rows: list[dict[str, str]]) -> float:
    equity = 0.0
    peak = 0.0
    max_dd = 0.0
    ordered = sorted(close_rows, key=lambda r: parse_time(r.get("time", "")) or datetime.min)
    for row in ordered:
        equity += fnum(row.get("profit"))
        peak = max(peak, equity)
        max_dd = min(max_dd, equity - peak)
    return max_dd


def aggregate(rows: list[dict[str, str]], key: str) -> dict[str, MetricBucket]:
    buckets: dict[str, MetricBucket] = defaultdict(MetricBucket)
    for row in rows:
        value = row.get(key) or "UNKNOWN"
        buckets[value].add_close(row)
    return dict(buckets)


def sorted_metric_rows(buckets: dict[str, MetricBucket]) -> list[tuple[str, MetricBucket]]:
    return sorted(buckets.items(), key=lambda kv: (kv[1].net, kv[1].profit_factor), reverse=True)


def metric_table(title: str, buckets: dict[str, MetricBucket], limit: int = 12) -> list[str]:
    lines = [f"## {title}", "", "| Key | Trades | WR | PF | Net | Exp/trade | Avg DD | Largest DD | Recovery wins | Early exits | Good exits |", "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|"]
    for key, b in sorted_metric_rows(buckets)[:limit]:
        lines.append(
            f"| {key} | {b.trades} | {b.win_rate:.1f}% | {ratio(b.profit_factor)} | {money(b.net)} | "
            f"{money(b.expectancy)} | {money(b.avg_dd)} | {money(b.largest_dd)} | "
            f"{b.recovery_wins} | {b.post_early} | {b.post_good} |"
        )
    lines.append("")
    return lines


def block_table(blocks: dict[str, BlockBucket], title: str, limit: int = 15) -> list[str]:
    lines = [f"## {title}", "", "| Block reason | Blocked | Checks | Missed 5m ATR | Missed 15m ATR | Missed 30m ATR | Missed 60m ATR | Saved 60m ATR | Protection score | Would-win | Would-loss |", "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|"]
    ranked = sorted(blocks.items(), key=lambda kv: kv[1].protection_score)
    for reason, b in ranked[:limit]:
        lines.append(
            f"| {reason} | {b.blocked} | {b.checks} | {b.avg_missed_5:.2f} | {b.avg_missed_15:.2f} | "
            f"{b.avg_missed_30:.2f} | {b.avg_missed_60:.2f} | {b.avg_saved_60:.2f} | "
            f"{b.protection_score:.2f} | {b.would_win} | {b.would_loss} |"
        )
    lines.append("")
    return lines


def redundancy_report(block_rows: list[dict[str, str]]) -> list[str]:
    groups: dict[tuple[str, str, str], set[str]] = defaultdict(set)
    for row in block_rows:
        if row.get("event") != "BLOCKED":
            continue
        ts = parse_time(row.get("time", "")) or datetime.min
        bucket_min = math.floor(ts.timestamp() / 600) if ts != datetime.min else 0
        key = (str(bucket_min), row.get("dir", ""), row.get("setup", ""))
        groups[key].add(row.get("reasonKey", "UNKNOWN"))

    overlaps: dict[tuple[str, ...], int] = defaultdict(int)
    for reasons in groups.values():
        if len(reasons) >= 2:
            overlaps[tuple(sorted(reasons))] += 1

    lines = ["## Simplification Audit", ""]
    if not overlaps:
        lines += ["No repeated overlapping block groups detected in the selected window.", ""]
        return lines
    lines += ["| Overlapping protections | Count |", "|---|---:|"]
    for reasons, count in sorted(overlaps.items(), key=lambda kv: kv[1], reverse=True)[:12]:
        lines.append(f"| {' + '.join(reasons)} | {count} |")
    lines.append("")
    lines.append("These are candidates for review only. The report does not remove or disable protections.")
    lines.append("")
    return lines


def recommendations(
    grade_buckets: dict[str, MetricBucket],
    setup_buckets: dict[str, MetricBucket],
    block_buckets: dict[str, BlockBucket],
    exit_buckets: dict[str, MetricBucket],
) -> list[str]:
    lines = ["## Evidence-Based Recommendations", ""]
    recs: list[str] = []

    for grade, b in sorted_metric_rows(grade_buckets):
        if b.trades >= 8 and b.profit_factor < 1.0:
            recs.append(f"Review grade `{grade}`: {b.trades} trades, PF {ratio(b.profit_factor)}, expectancy {money(b.expectancy)}.")
        if b.trades >= 8 and b.recovery_wins / max(b.trades, 1) >= 0.35:
            recs.append(f"Review timing for grade `{grade}`: high recovery-win rate means winners often needed deep drawdown first.")

    for setup, b in sorted_metric_rows(setup_buckets):
        if b.trades >= 8 and b.avg_dd < -abs(b.expectancy) * 2.5:
            recs.append(f"Review setup `{setup}` entry timing: average floating drawdown {money(b.avg_dd)} is large versus expectancy {money(b.expectancy)}.")

    expensive_blocks = sorted(block_buckets.items(), key=lambda kv: kv[1].protection_score)[:3]
    for reason, b in expensive_blocks:
        if b.checks >= 5 and b.protection_score < -0.75:
            recs.append(f"Review block `{reason}`: average missed move exceeds saved adverse move by {abs(b.protection_score):.2f} ATR.")

    for exit_reason, b in sorted_metric_rows(exit_buckets):
        if b.trades >= 5 and b.post_early > b.post_good * 2:
            recs.append(f"Review exit `{exit_reason}`: post-close checks show more early exits than avoided reversals.")

    if not recs:
        recs.append("No parameter review is justified yet from the selected sample. Keep collecting data.")

    lines += [f"- {r}" for r in recs]
    lines.append("")
    return lines


def build_report(executed_path: Path, blocked_path: Path, days: int) -> str:
    executed_all = filter_rows(read_csv(executed_path), days)
    blocked_all = filter_rows(read_csv(blocked_path), days)

    close_rows = [r for r in executed_all if r.get("event") == "CLOSE"]
    post_rows = [r for r in executed_all if r.get("event") == "POST_CLOSE"]
    for post in post_rows:
        # Attach post-close verdict to same exit/setup/grade bucket through the row itself.
        pass

    total = MetricBucket()
    for row in close_rows:
        total.add_close(row)

    grade_buckets = aggregate(close_rows, "grade")
    setup_buckets = aggregate(close_rows, "setup")
    exit_buckets = aggregate(close_rows, "exitReason")
    signature_buckets = aggregate(close_rows, "signature")

    # Count post-close verdicts by setup, grade, and exitReason.
    for row in post_rows:
        for buckets, key in ((grade_buckets, "grade"), (setup_buckets, "setup"), (exit_buckets, "exitReason")):
            value = row.get(key) or "UNKNOWN"
            buckets.setdefault(value, MetricBucket()).add_post_close(row)

    block_buckets: dict[str, BlockBucket] = defaultdict(BlockBucket)
    for row in blocked_all:
        reason = row.get("reasonKey") or "UNKNOWN"
        block_buckets[reason].add(row)

    useful = sorted(block_buckets.items(), key=lambda kv: kv[1].protection_score, reverse=True)[:5]
    expensive = sorted(block_buckets.items(), key=lambda kv: kv[1].protection_score)[:5]

    generated = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    lines = [
        "# XAUAI Weekly Attribution Report",
        "",
        f"Generated: {generated}",
        f"Window: last {days} days",
        f"Executed memory: `{executed_path}`",
        f"Blocked memory: `{blocked_path}`",
        "",
        "## Executive Summary",
        "",
        f"- Closed trades: {total.trades}",
        f"- Net profit: {money(total.net)}",
        f"- Win rate: {total.win_rate:.1f}%",
        f"- Profit factor: {ratio(total.profit_factor)}",
        f"- Expectancy per trade: {money(total.expectancy)}",
        f"- Max realized drawdown from closes: {money(max_drawdown_from_closes(close_rows))}",
        f"- Average floating drawdown: {money(total.avg_dd)}",
        f"- Largest floating loss: {money(total.largest_dd)}",
        f"- Recovery wins: {total.recovery_wins}",
        "",
        "## Protection Rankings",
        "",
        "### Most Useful Protection",
        "",
    ]
    lines += [f"- `{k}`: score {v.protection_score:.2f} ATR, saved {v.avg_saved_60:.2f} ATR, missed {v.avg_missed_60:.2f} ATR" for k, v in useful]
    lines += ["", "### Most Expensive Protection", ""]
    lines += [f"- `{k}`: score {v.protection_score:.2f} ATR, saved {v.avg_saved_60:.2f} ATR, missed {v.avg_missed_60:.2f} ATR" for k, v in expensive]
    lines.append("")

    lines += metric_table("Signal Grade Validation", grade_buckets)
    lines += metric_table("Setup Performance", setup_buckets)
    lines += metric_table("Exit Reason Performance", exit_buckets)
    lines += metric_table("Signature Performance", signature_buckets, limit=10)
    lines += block_table(dict(block_buckets), "Blocked Trade Intelligence")
    lines += redundancy_report(blocked_all)
    lines += recommendations(grade_buckets, setup_buckets, dict(block_buckets), exit_buckets)

    lines += [
        "## Interpretation Rules",
        "",
        "- This report is evidence, not an automatic tuning command.",
        "- A high win rate with weak profit factor is not good enough.",
        "- A green trade with large MAE and small profit is flagged as poor timing.",
        "- A block reason with high missed ATR and low saved ATR should be reviewed.",
        "- A redundant protection pair should be reviewed only after enough repeated overlaps.",
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate XAUAI attribution report from EA memory CSV files.")
    parser.add_argument("--executed", required=True, type=Path, help="Path to XAUAI_ExecutedTradeBrain_<symbol>.csv")
    parser.add_argument("--blocked", required=True, type=Path, help="Path to XAUAI_BlockedTradeMemory_<symbol>.csv")
    parser.add_argument("--days", default=7, type=int, help="Lookback window in days")
    parser.add_argument("--out", type=Path, help="Optional markdown output path")
    args = parser.parse_args()

    report = build_report(args.executed, args.blocked, args.days)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(report, encoding="utf-8")
    else:
        print(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
