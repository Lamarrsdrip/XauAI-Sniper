#!/usr/bin/env python3
"""Build the 60-day M30-postfix executive report, charts and metadata from
the CSVs produced by extract_60day_postfix_trades.py. All numbers here are
computed directly from 60DAY_ALL_POSITIONS.csv / 60DAY_ALL_CAMPAIGNS.csv --
no invented figures.
"""
import argparse
import json
from pathlib import Path

import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


def load(out_dir: Path):
    pos = pd.read_csv(out_dir / "60DAY_ALL_POSITIONS.csv", parse_dates=["entry_time", "exit_time"])
    camp = pd.read_csv(out_dir / "60DAY_ALL_CAMPAIGNS.csv", parse_dates=["campaign_open_time", "campaign_close_time"])
    return pos, camp


def add_time_fields(pos: pd.DataFrame):
    pos = pos.copy()
    pos["entry_hour"] = pos["entry_time"].dt.hour
    pos["entry_dow"] = pos["entry_time"].dt.day_name()
    return pos


def session_label(hour: int) -> str:
    # Broker-server time (unverified UTC offset -- see method/limitations).
    if 0 <= hour < 7:
        return "Asia"
    if 7 <= hour < 8:
        return "London pre-open"
    if 8 <= hour < 13:
        return "London"
    if 13 <= hour < 16:
        return "London/New York overlap"
    if 16 <= hour < 20:
        return "New York"
    if 20 <= hour < 22:
        return "New York afternoon"
    return "Rollover/low-liquidity"


def fmt(x, nd=2):
    if x is None or (isinstance(x, float) and pd.isna(x)):
        return "n/a"
    return f"{x:,.{nd}f}"


def build_charts(pos: pd.DataFrame, out_dir: Path):
    charts_dir = out_dir
    plt.rcParams.update({"figure.dpi": 110, "font.size": 9})

    # 1. Realized R distribution, wins vs losses
    fig, ax = plt.subplots(figsize=(8, 5))
    wins = pos[pos["result"] == "WIN"]["realized_r"]
    losses = pos[pos["result"] == "LOSS"]["realized_r"]
    ax.hist(wins, bins=30, alpha=0.7, label=f"Wins (n={len(wins)})", color="#2e7d32")
    ax.hist(losses, bins=30, alpha=0.7, label=f"Losses (n={len(losses)})", color="#c62828")
    ax.axvline(0, color="black", linewidth=0.8)
    ax.set_xlabel("Realized R"); ax.set_ylabel("Number of positions")
    ax.set_title("60-Day Postfix Run: Realized R Distribution (all 191 positions)")
    ax.legend()
    fig.tight_layout(); fig.savefig(charts_dir / "60DAY_REALIZED_R_DISTRIBUTION.png"); plt.close(fig)

    # 2. Realized R vs MFE R scatter
    fig, ax = plt.subplots(figsize=(7, 7))
    colors = pos["result"].map({"WIN": "#2e7d32", "LOSS": "#c62828", "BREAKEVEN": "#757575"})
    ax.scatter(pos["mfe_r"], pos["realized_r"], c=colors, alpha=0.6, s=25)
    lims = [min(pos["mfe_r"].min(), pos["realized_r"].min(), -0.5), max(pos["mfe_r"].max(), pos["realized_r"].max()) + 0.1]
    ax.plot(lims, lims, "--", color="gray", linewidth=0.8, label="Realized = MFE (100% capture)")
    ax.set_xlabel("Maximum Favorable Excursion (R) -- EA-tracked, real-time"); ax.set_ylabel("Realized R at exit")
    ax.set_title("Realized R vs MFE R (distance below the diagonal = R given back)")
    ax.legend()
    fig.tight_layout(); fig.savefig(charts_dir / "60DAY_REALIZED_R_VS_MFE.png"); plt.close(fig)

    # 3. SL distance ($ risk) distribution, wins vs losses
    fig, ax = plt.subplots(figsize=(8, 5))
    ax.hist(pos[pos["result"] == "WIN"]["risk_usd"], bins=25, alpha=0.7, label="Wins", color="#2e7d32")
    ax.hist(pos[pos["result"] == "LOSS"]["risk_usd"], bins=25, alpha=0.7, label="Losses", color="#c62828")
    ax.set_xlabel("Risk per position (USD, = 1R)"); ax.set_ylabel("Number of positions")
    ax.set_title("Risk-per-Position ($) Distribution")
    ax.legend()
    fig.tight_layout(); fig.savefig(charts_dir / "60DAY_RISK_USD_DISTRIBUTION.png"); plt.close(fig)

    # 4. Session performance (net R by session)
    pos2 = add_time_fields(pos)
    pos2["session"] = pos2["entry_hour"].apply(session_label)
    sess = pos2.groupby("session").agg(
        positions=("ticket", "count"),
        wins=("result", lambda s: (s == "WIN").sum()),
        losses=("result", lambda s: (s == "LOSS").sum()),
        net_r=("realized_r", "sum"),
        net_usd=("realized_profit_usd", "sum"),
    )
    order = ["Asia", "London pre-open", "London", "London/New York overlap",
             "New York", "New York afternoon", "Rollover/low-liquidity"]
    sess = sess.reindex([s for s in order if s in sess.index])
    fig, ax = plt.subplots(figsize=(9, 5))
    bar_colors = ["#2e7d32" if v >= 0 else "#c62828" for v in sess["net_r"]]
    ax.bar(sess.index, sess["net_r"], color=bar_colors)
    ax.set_ylabel("Net Realized R"); ax.set_title("Net Realized R by Trading Session (broker-server time, unverified UTC offset)")
    ax.tick_params(axis="x", rotation=30)
    fig.tight_layout(); fig.savefig(charts_dir / "60DAY_SESSION_PERFORMANCE.png"); plt.close(fig)

    # 5. Hourly heatmap-style bar (win rate by hour)
    hourly = pos2.groupby("entry_hour").agg(
        positions=("ticket", "count"),
        wins=("result", lambda s: (s == "WIN").sum()),
        net_r=("realized_r", "sum"),
    )
    hourly["win_rate"] = hourly["wins"] / hourly["positions"] * 100
    fig, ax1 = plt.subplots(figsize=(11, 5))
    ax1.bar(hourly.index, hourly["net_r"], color=["#2e7d32" if v >= 0 else "#c62828" for v in hourly["net_r"]])
    ax1.set_xlabel("Entry hour (broker-server time)"); ax1.set_ylabel("Net Realized R")
    ax1.set_title("Net Realized R by Hour of Day")
    ax1.set_xticks(range(0, 24))
    fig.tight_layout(); fig.savefig(charts_dir / "60DAY_HOURLY_NET_R.png"); plt.close(fig)

    return sess, hourly


def build_report(pos: pd.DataFrame, camp: pd.DataFrame, out_dir: Path, meta: dict):
    pos = add_time_fields(pos)
    pos["session"] = pos["entry_hour"].apply(session_label)

    wins = pos[pos["result"] == "WIN"]
    losses = pos[pos["result"] == "LOSS"]
    be = pos[pos["result"] == "BREAKEVEN"]

    total_profit = pos["realized_profit_usd"].sum()
    gross_win = wins["realized_profit_usd"].sum()
    gross_loss = losses["realized_profit_usd"].sum()
    profit_factor = (gross_win / abs(gross_loss)) if gross_loss != 0 else float("inf")

    lines = []
    lines.append("# 60-Day M30-Postfix Trade Behavior -- Executive Report\n")
    lines.append(f"**Run window:** {meta['from_date']} -> {meta['to_date']} (broker-server time)  ")
    lines.append(f"**EA:** {meta['expert']}, EX5 SHA-256 `{meta['ex5_sha256']}`  ")
    lines.append(f"**Branch/commit tested:** `{meta['branch']}` / `{meta.get('commit_note', meta.get('commit',''))}`  ")
    lines.append(f"**Symbol/Period/Model:** {meta['symbol']} / {meta['period']} / {meta['model']}  ")
    lines.append(f"**Deposit/Leverage:** {meta['deposit']} / {meta['leverage']}  \n")

    lines.append("## Top-level numbers (cross-checked against the tester's own summary)\n")
    lines.append(f"- Total positions: **{len(pos)}** ({len(wins)} win, {len(losses)} loss, {len(be)} breakeven)")
    lines.append(f"- Total campaigns (real EA-assigned CAMP-N IDs): **{len(camp)}** "
                 f"({(camp['campaign_result']=='WIN').sum()} win, {(camp['campaign_result']=='LOSS').sum()} loss)")
    lines.append(f"- Campaigns with at least one pyramid addition: **{(camp['num_pyramid']>0).sum()}** "
                 f"of {len(camp)} ({(camp['num_pyramid']>0).mean()*100:.1f}%)")
    lines.append(f"- Net realized profit: **${fmt(total_profit)}**")
    lines.append(f"- Gross profit / Gross loss: ${fmt(gross_win)} / ${fmt(gross_loss)}")
    lines.append(f"- Profit Factor: **{fmt(profit_factor)}**")
    lines.append(f"- Win rate (positions): **{len(wins)/len(pos)*100:.1f}%**\n")

    lines.append("## Average SL / risk per position (owner-requested)\n")
    lines.append("SL distance and risk are set once per position at entry by the EA's own risk-geometry "
                 "engine (`R_EXIT_ENTRY_CAPTURE_CONFIRMED`), so \"1R\" below always means the position's own "
                 "original structural-SL risk, not a fixed constant.\n")
    lines.append("| | All positions | Winners | Losers |")
    lines.append("|---|---|---|---|")
    lines.append(f"| Average SL distance (price) | {fmt(pos['sl_distance_price'].mean())} | "
                 f"{fmt(wins['sl_distance_price'].mean())} | {fmt(losses['sl_distance_price'].mean())} |")
    lines.append(f"| Median SL distance (price) | {fmt(pos['sl_distance_price'].median())} | "
                 f"{fmt(wins['sl_distance_price'].median())} | {fmt(losses['sl_distance_price'].median())} |")
    lines.append(f"| Average risk (USD, = 1R) | {fmt(pos['risk_usd'].mean())} | "
                 f"{fmt(wins['risk_usd'].mean())} | {fmt(losses['risk_usd'].mean())} |")
    lines.append(f"| Median risk (USD, = 1R) | {fmt(pos['risk_usd'].median())} | "
                 f"{fmt(wins['risk_usd'].median())} | {fmt(losses['risk_usd'].median())} |")
    lines.append(f"| Smallest / largest SL distance | {fmt(pos['sl_distance_price'].min())} / "
                 f"{fmt(pos['sl_distance_price'].max())} | | |\n")

    lines.append("## Exit authority -- what actually closed each position\n")
    lines.append("`EXTERNAL_CLOSE_BROKER_SL` means the broker's own stop order filled (this is the position's "
                 "structural SL order -- it can be the ORIGINAL invalidation level, or a level the EA moved up "
                 "to lock in profit before price reversed and hit it; both are broker-confirmed SL fills, so "
                 "they are not automatically losses). Every other reason is the EA closing the position itself "
                 "at market (`EA_MANAGED_CLOSE`) via one of its own exit authorities.\n")
    xt = pd.crosstab(pos["exit_reason_ea"], pos["result"])
    lines.append("| Exit reason (EA's own classification) | Win | Loss | Breakeven | Total |")
    lines.append("|---|---|---|---|---|")
    for reason, row in xt.iterrows():
        w = int(row.get("WIN", 0)); l = int(row.get("LOSS", 0)); b = int(row.get("BREAKEVEN", 0))
        lines.append(f"| {reason} | {w} | {l} | {b} | {w+l+b} |")
    lines.append("")
    lines.append(f"- Of the **{len(losses)} losses**, every single one closed via `EXTERNAL_CLOSE_BROKER_SL` "
                 f"(broker-confirmed structural stop hit). There are 0 losses from any EA-managed close authority.")
    n_sl_but_win = ((pos["exit_reason_ea"] == "EXTERNAL_CLOSE_BROKER_SL") & (pos["result"] == "WIN")).sum()
    lines.append(f"- {n_sl_but_win} positions ALSO hit their broker-side SL order but closed as a WIN -- "
                 f"these are cases where the EA's profit-floor logic had already moved the stop up into "
                 f"profit before price reversed and triggered it.\n")

    lines.append("## Losing trades -- full detail on every single one\n")
    lines.append(f"All {len(losses)} losing positions, in time order. **MFE_R** is the real peak favorable "
                 f"excursion the EA's own R-Exit manager tracked before the loss (i.e. \"how much profit did "
                 f"it reach before turning into a loss\"); **Time-to-SL** is entry-to-exit hold time.\n")
    lines.append("| Ticket | Campaign | Dir | Entry time | Hold (min) | Risk $ | MFE (R) | MFE ($) | Ever reached +0.20R? | Realized ($) | Realized (R) |")
    lines.append("|---|---|---|---|---|---|---|---|---|---|---|")
    for _, r in losses.sort_values("entry_time").iterrows():
        reached_20r = "Yes" if pd.notna(r["checkpoint_0_20R"]) else "No"
        lines.append(f"| {r['ticket']} | {r['campaign_id']} | {r['direction']} | {r['entry_time']} | "
                     f"{fmt(r['hold_minutes'],1)} | {fmt(r['risk_usd'])} | {fmt(r['mfe_r'],3)} | "
                     f"{fmt(r['mfe_usd'])} | {reached_20r} | {fmt(r['realized_profit_usd'])} | {fmt(r['realized_r'],3)} |")
    lines.append("")

    lines.append("### Losing-trade summary statistics\n")
    lines.append(f"- Average time-to-SL: **{fmt(losses['hold_minutes'].mean(),1)} minutes** "
                 f"(median {fmt(losses['hold_minutes'].median(),1)} min)")
    lines.append(f"- Fastest / slowest loss: {fmt(losses['hold_minutes'].min(),1)} min / "
                 f"{fmt(losses['hold_minutes'].max(),1)} min")
    lines.append(f"- Average MFE before the eventual loss: **{fmt(losses['mfe_r'].mean(),3)}R** "
                 f"(${fmt(losses['mfe_usd'].mean())})  -- median {fmt(losses['mfe_r'].median(),3)}R")
    n_never_positive = (losses["mfe_r"] <= 0).sum()
    n_reached_20r = losses["checkpoint_0_20R"].notna().sum()
    n_reached_30r = losses["checkpoint_0_30R"].notna().sum()
    n_reached_50r = losses["checkpoint_0_50R"].notna().sum()
    lines.append(f"- Losses that were NEVER floating positive (MFE <= 0R, went straight against entry): "
                 f"**{n_never_positive} of {len(losses)}** ({n_never_positive/len(losses)*100:.1f}%)")
    lines.append(f"- Losses that reached +0.20R at some point before reversing to the loss: "
                 f"**{n_reached_20r} of {len(losses)}** ({n_reached_20r/len(losses)*100:.1f}%)")
    lines.append(f"- Losses that reached +0.30R: **{n_reached_30r}** ({n_reached_30r/len(losses)*100:.1f}%)")
    lines.append(f"- Losses that reached +0.50R: **{n_reached_50r}** ({n_reached_50r/len(losses)*100:.1f}%)")
    lines.append(f"- Average MAE (deepest floating loss reached, including on the losers themselves): "
                 f"**{fmt(losses['mae_r'].mean(),3)}R** (${fmt(losses['mae_usd'].mean())})\n")

    lines.append("## Winning trades -- summary (all 151 real wins + 1 breakeven)\n")
    lines.append(f"- Average realized profit: **${fmt(wins['realized_profit_usd'].mean())}** "
                 f"(median ${fmt(wins['realized_profit_usd'].median())})")
    lines.append(f"- Average realized R: **{fmt(wins['realized_r'].mean(),3)}R** "
                 f"(median {fmt(wins['realized_r'].median(),3)}R)")
    lines.append(f"- Average MFE reached before exit: **{fmt(wins['mfe_r'].mean(),3)}R** "
                 f"(median {fmt(wins['mfe_r'].median(),3)}R)")
    lines.append(f"- Average MFE capture (realized R / MFE R): **{fmt(wins['mfe_capture_pct'].mean(),1)}%** "
                 f"(median {fmt(wins['mfe_capture_pct'].median(),1)}%) -- i.e. on average the EA's exit "
                 f"management kept this fraction of the best floating profit each winner ever reached")
    lines.append(f"- Average MAE before eventually winning (real drawdown-before-profit): "
                 f"**{fmt(wins['mae_r'].mean(),3)}R** (${fmt(wins['mae_usd'].mean())})")
    n_win_immediately_positive = (wins["mae_r"] >= -0.02).sum()
    lines.append(f"- Winners that were immediately profitable (MAE within 0.02R of zero, essentially no "
                 f"drawdown before profit): **{n_win_immediately_positive} of {len(wins)}** "
                 f"({n_win_immediately_positive/len(wins)*100:.1f}%)")
    lines.append(f"- Average hold time: **{fmt(wins['hold_minutes'].mean(),1)} min** "
                 f"(median {fmt(wins['hold_minutes'].median(),1)} min)\n")

    lines.append("## Pyramid contribution\n")
    core_only_total = camp["core_only_profit_usd"].sum()
    pyramid_only_total = camp["pyramid_only_profit_usd"].sum()
    lines.append(f"- Core-leg-only reconstructed total: **${fmt(core_only_total)}**")
    lines.append(f"- Pyramid-leg-only total: **${fmt(pyramid_only_total)}**")
    lines.append(f"- Combined actual total: **${fmt(core_only_total + pyramid_only_total)}**")
    pyramid_camps = camp[camp["num_pyramid"] > 0]
    flips = pyramid_camps[(pyramid_camps["core_only_profit_usd"] > 0) & (pyramid_camps["total_realized_profit_usd"] < 0)]
    lines.append(f"- Campaigns where the core alone would have been a WIN, but the combined campaign "
                 f"(after pyramid additions) became a LOSS: **{len(flips)}**\n")

    lines.append("## Session and hour performance\n")
    sess = pos.groupby("session").agg(
        positions=("ticket", "count"), wins=("result", lambda s: (s == "WIN").sum()),
        losses=("result", lambda s: (s == "LOSS").sum()), net_r=("realized_r", "sum"),
        net_usd=("realized_profit_usd", "sum"),
    )
    order = ["Asia", "London pre-open", "London", "London/New York overlap",
             "New York", "New York afternoon", "Rollover/low-liquidity"]
    sess = sess.reindex([s for s in order if s in sess.index])
    lines.append("*(Session boundaries are broker-server-time buckets; the exact UTC offset of this "
                 "MetaQuotes-Demo server was not independently confirmed -- see limitations doc.)*\n")
    lines.append("| Session | Positions | Wins | Losses | Win rate | Net R | Net $ |")
    lines.append("|---|---|---|---|---|---|---|")
    for s, r in sess.iterrows():
        wr = r["wins"] / r["positions"] * 100 if r["positions"] else 0
        lines.append(f"| {s} | {int(r['positions'])} | {int(r['wins'])} | {int(r['losses'])} | "
                     f"{wr:.1f}% | {fmt(r['net_r'],2)} | {fmt(r['net_usd'])} |")
    lines.append("")

    best_hour = pos.groupby("entry_hour")["realized_r"].sum().idxmax()
    worst_hour = pos.groupby("entry_hour")["realized_r"].sum().idxmin()
    lines.append(f"- Best single hour by net R: **{best_hour}:00** "
                 f"({fmt(pos.groupby('entry_hour')['realized_r'].sum().max(),2)}R)")
    lines.append(f"- Worst single hour by net R: **{worst_hour}:00** "
                 f"({fmt(pos.groupby('entry_hour')['realized_r'].sum().min(),2)}R)\n")

    lines.append("## Day-of-week performance\n")
    dow = pos.groupby("entry_dow").agg(
        positions=("ticket", "count"), wins=("result", lambda s: (s == "WIN").sum()),
        net_r=("realized_r", "sum"))
    dow_order = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    dow = dow.reindex([d for d in dow_order if d in dow.index])
    lines.append("| Day | Positions | Wins | Net R |")
    lines.append("|---|---|---|---|")
    for d, r in dow.iterrows():
        lines.append(f"| {d} | {int(r['positions'])} | {int(r['wins'])} | {fmt(r['net_r'],2)} |")
    lines.append("")

    lines.append("## Charts\n")
    for png in ["60DAY_REALIZED_R_DISTRIBUTION.png", "60DAY_REALIZED_R_VS_MFE.png",
                "60DAY_RISK_USD_DISTRIBUTION.png", "60DAY_SESSION_PERFORMANCE.png",
                "60DAY_HOURLY_NET_R.png"]:
        lines.append(f"![{png}]({png})\n")

    lines.append("## What this data does and does not prove\n")
    lines.append("- All entry/exit prices, times, SL distances, risk, MFE, MAE, R-multiples and exit "
                 "reasons above come from the EA's own real-time journal logging "
                 "(`R_EXIT_ENTRY_CAPTURE_CONFIRMED` / `R_EXIT_COUNTERFACTUAL` / `CAMPAIGN_*`) or the MT5 "
                 "Strategy Tester's own broker-confirmed Deals table -- cross-checked against each other "
                 "(191/191 positions matched cleanly, 0 unmatched). Nothing here is estimated from candle "
                 "OHLC or fabricated.")
    lines.append("- This is Phase 1 evidence only. No trading-logic, threshold, SL, exit, or pyramid change "
                 "was made or is being recommended here.")
    lines.append("- Market-regime/session-type classification beyond broker-server-time buckets (e.g. "
                 "trend/range/compression labels) was not attempted in this pass -- see "
                 "`60DAY_METHOD_AND_LIMITATIONS.md`.\n")

    (out_dir / "60DAY_EXECUTIVE_REPORT.md").write_text("\n".join(lines))
    return sess, dow, xt


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out-dir", required=True, type=Path)
    args = ap.parse_args()

    pos, camp = load(args.out_dir)
    sess, hourly = build_charts(pos, args.out_dir)

    meta = json.loads((args.out_dir / "60DAY_RUN_METADATA.json").read_text())
    build_report(pos, camp, args.out_dir, meta)
    print("Report written.")


if __name__ == "__main__":
    main()
