"""Performance-period calculation engine.

Reference: audits/performance_reset/01_current_system_audit.md for the
full audit of the system this replaces/extends.

Design decisions made explicit here (see the audit doc for the
reasoning behind each):

- WIN/LOSS/BE is reclassified server-side from net realized result
  (profit + commission + swap) against a configurable break-even
  tolerance -- never trusts the EA-reported `result` field directly,
  since older EA versions didn't reliably fold commission/swap into
  their own classification.
- Win rate = wins / (wins + losses) * 100 -- break-even trades excluded
  from BOTH numerator and denominator (the pre-existing
  /performance/summary endpoint only excluded them from the numerator).
- Profit factor = gross profit from wins / abs(gross loss from losses).
- Drawdown is a PERCENTAGE of real reported account balance
  (peak-to-trough), never a dollar amount -- and is labeled "max balance
  drawdown," never "equity," because no real equity-snapshot series
  exists anywhere in this system (see audit doc).
- Only trades with has_rich_ledger_data=True (ticket > 0, meaning a
  genuine v6.25.3+ EA report with a real opened_at) are eligible --
  "reconstructed trades without reliable timestamps" per the owner's
  spec are never included, full stop, regardless of period.
- Deduplication by ticket: the same real trade can be reported more than
  once (retries, duplicate close events) -- only the first-seen report
  per ticket counts.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

DEFAULT_MINIMUM_SAMPLE = 20
DEFAULT_BREAK_EVEN_TOLERANCE_USD = 1.0


def net_result(trade: dict) -> float:
    """Net realized result after commission, swap and fees -- never the
    raw `profit` field alone."""
    profit = float(trade.get("profit") or 0)
    commission = float(trade.get("commission") or 0)
    swap = float(trade.get("swap") or 0)
    return profit + commission + swap


def classify_trade(trade: dict, be_tolerance_usd: float = DEFAULT_BREAK_EVEN_TOLERANCE_USD) -> str:
    """Returns "WIN", "LOSS", or "BE" from the net realized result,
    never from the EA's own `result` field."""
    net = net_result(trade)
    if net > be_tolerance_usd:
        return "WIN"
    if net < -be_tolerance_usd:
        return "LOSS"
    return "BE"


def is_eligible_trade(trade: dict) -> bool:
    """A trade counts toward ANY performance period only if it has a
    reliable broker-reported open timestamp. Pre-v6.25.3 EA reports
    (has_rich_ledger_data=False, ticket==0) never sent a trustworthy
    opened_at and are excluded unconditionally -- not just from the
    forward period, from every period, including the historical archive,
    since "reconstructed trades without reliable timestamps" are exactly
    what the owner's spec says must never be included."""
    if not trade.get("has_rich_ledger_data"):
        return False
    if not trade.get("ticket"):
        return False
    if not trade.get("opened_at"):
        return False
    return True


def dedupe_by_ticket(trades: list) -> list:
    """The same real trade can be reported more than once (a retried
    /journal/log call, an out-of-order duplicate close event). Only the
    first-seen report for a given ticket counts -- callers must pass
    trades already sorted by whatever tie-break they want to win
    (this module sorts by opened_at ascending before calling this, so
    the earliest-received report for a ticket wins deterministically)."""
    seen = set()
    result = []
    for t in trades:
        ticket = t.get("ticket")
        if ticket in seen:
            continue
        seen.add(ticket)
        result.append(t)
    return result


@dataclass
class PeriodStats:
    total_trades: int = 0
    wins: int = 0
    losses: int = 0
    break_even: int = 0
    win_rate: Optional[float] = None            # None = not computable (0 wins+losses)
    gross_profit: float = 0.0
    gross_loss: float = 0.0
    net_profit: float = 0.0
    profit_factor_value: Optional[float] = None  # None when not a clean ratio
    profit_factor_state: str = "no_data"          # "ok" | "not_established" | "no_data"
    avg_win: float = 0.0
    avg_loss: float = 0.0
    largest_win: float = 0.0
    largest_loss: float = 0.0
    max_balance_drawdown_pct: float = 0.0
    max_balance_drawdown_usd: float = 0.0
    longest_winning_streak: int = 0
    longest_losing_streak: int = 0
    first_trade_at: Optional[str] = None
    last_trade_at: Optional[str] = None
    sufficient_data: bool = False
    minimum_sample: int = DEFAULT_MINIMUM_SAMPLE


def compute_period_stats(
    trades: list,
    be_tolerance_usd: float = DEFAULT_BREAK_EVEN_TOLERANCE_USD,
    minimum_sample: int = DEFAULT_MINIMUM_SAMPLE,
) -> PeriodStats:
    """Pure function: takes an already-scoped, already-eligibility-
    filtered list of trade dicts (see is_eligible_trade/dedupe_by_ticket,
    applied by the caller before this) and computes every headline
    statistic from exactly that one dataset -- the same win rate,
    profit factor, and drawdown all come from the same trades, same
    formulas, every time. No caller may mix a win rate from one query
    with a profit factor from another."""
    stats = PeriodStats(minimum_sample=minimum_sample)
    if not trades:
        return stats

    ordered = sorted(trades, key=lambda t: t.get("opened_at") or 0)

    outcomes = [(classify_trade(t, be_tolerance_usd), net_result(t), t) for t in ordered]
    wins = [(net, t) for outcome, net, t in outcomes if outcome == "WIN"]
    losses = [(net, t) for outcome, net, t in outcomes if outcome == "LOSS"]
    be = [(net, t) for outcome, net, t in outcomes if outcome == "BE"]

    stats.total_trades = len(ordered)
    stats.wins = len(wins)
    stats.losses = len(losses)
    stats.break_even = len(be)

    decisive = stats.wins + stats.losses
    stats.win_rate = round(stats.wins / decisive * 100, 1) if decisive > 0 else None

    stats.gross_profit = round(sum(net for net, _ in wins), 2)
    stats.gross_loss = round(abs(sum(net for net, _ in losses)), 2)
    stats.net_profit = round(stats.gross_profit - stats.gross_loss + sum(net for net, _ in be), 2)

    if stats.gross_loss > 0:
        stats.profit_factor_value = round(stats.gross_profit / stats.gross_loss, 2)
        stats.profit_factor_state = "ok"
    elif stats.gross_profit > 0:
        # Real wins, zero losing trades yet -- a true ratio would be
        # infinite, which is never a meaningful number to publish.
        stats.profit_factor_value = None
        stats.profit_factor_state = "not_established"
    else:
        stats.profit_factor_value = None
        stats.profit_factor_state = "no_data"

    stats.avg_win = round(sum(net for net, _ in wins) / len(wins), 2) if wins else 0.0
    stats.avg_loss = round(sum(net for net, _ in losses) / len(losses), 2) if losses else 0.0
    stats.largest_win = round(max((net for net, _ in wins), default=0.0), 2)
    stats.largest_loss = round(min((net for net, _ in losses), default=0.0), 2)

    # Max BALANCE drawdown, as a percentage of peak real reported
    # balance -- never a synthetic equity curve, never a dollar amount.
    # Trades without a positive reported balance are skipped for this
    # specific calculation (but still count for win/loss/profit-factor
    # above) since a balance of 0/unset means the EA report predates
    # balance reporting or the field was omitted -- better to leave
    # drawdown at its true value from real data points than to
    # interpolate a number that was never actually reported.
    peak_balance = None
    max_dd_pct = 0.0
    max_dd_usd = 0.0
    for t in ordered:
        bal = float(t.get("balance") or 0)
        if bal <= 0:
            continue
        if peak_balance is None or bal > peak_balance:
            peak_balance = bal
        drawdown_usd = peak_balance - bal
        drawdown_pct = (drawdown_usd / peak_balance * 100) if peak_balance > 0 else 0.0
        if drawdown_pct > max_dd_pct:
            max_dd_pct = drawdown_pct
            max_dd_usd = drawdown_usd
    stats.max_balance_drawdown_pct = round(max_dd_pct, 2)
    stats.max_balance_drawdown_usd = round(max_dd_usd, 2)

    win_streak = loss_streak = 0
    for outcome, _net, _t in outcomes:
        if outcome == "WIN":
            win_streak += 1
            loss_streak = 0
        elif outcome == "LOSS":
            loss_streak += 1
            win_streak = 0
        else:
            win_streak = 0
            loss_streak = 0
        stats.longest_winning_streak = max(stats.longest_winning_streak, win_streak)
        stats.longest_losing_streak = max(stats.longest_losing_streak, loss_streak)

    def _iso_from_unix(ts):
        from datetime import datetime, timezone
        try:
            return datetime.fromtimestamp(float(ts), timezone.utc).isoformat()
        except Exception:
            return None

    opened_ats = [t.get("opened_at") for t in ordered if t.get("opened_at")]
    if opened_ats:
        stats.first_trade_at = _iso_from_unix(min(opened_ats))
        stats.last_trade_at = _iso_from_unix(max(opened_ats))

    stats.sufficient_data = stats.total_trades >= minimum_sample
    return stats


def period_stats_to_dict(stats: PeriodStats) -> dict:
    """Serializes PeriodStats into the exact response shape the frontend
    consumes -- profit_factor is represented as a (value, state) pair so
    the frontend never has to guess whether None means zero, infinite,
    or not-yet-computable."""
    return {
        "total_trades": stats.total_trades,
        "wins": stats.wins,
        "losses": stats.losses,
        "break_even": stats.break_even,
        "win_rate": stats.win_rate,
        "gross_profit": stats.gross_profit,
        "gross_loss": stats.gross_loss,
        "net_profit": stats.net_profit,
        "profit_factor": stats.profit_factor_value,
        "profit_factor_state": stats.profit_factor_state,
        "avg_win": stats.avg_win,
        "avg_loss": stats.avg_loss,
        "largest_win": stats.largest_win,
        "largest_loss": stats.largest_loss,
        "max_balance_drawdown_pct": stats.max_balance_drawdown_pct,
        "max_balance_drawdown_usd": stats.max_balance_drawdown_usd,
        "longest_winning_streak": stats.longest_winning_streak,
        "longest_losing_streak": stats.longest_losing_streak,
        "first_trade_at": stats.first_trade_at,
        "last_trade_at": stats.last_trade_at,
        "sufficient_data": stats.sufficient_data,
        "minimum_sample": stats.minimum_sample,
    }
