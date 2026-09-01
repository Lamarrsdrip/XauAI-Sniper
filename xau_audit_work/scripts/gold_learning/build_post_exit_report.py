#!/usr/bin/env python3
"""Build the post-exit missed-R report (10/20 minute focus) from:
  - 60DAY_ALL_POSITIONS.csv (entry/exit/SL/realized R/MFE, real)
  - _post_close_checkpoints_5_10_15_30_60m.csv (real EA-computed
    post-close checkpoints from the ORIGINAL unmodified journal)
  - _post_close_20m_research.csv (real, from the isolated telemetry-only
    20-minute rerun -- see 60DAY_POST_EXIT_METHOD_AND_LIMITATIONS.md for
    the reproduction-verification this depends on)

R conversion, exact, no reconstruction:
  Each position's own risk_usd IS 1R in dollars (the EA's own structural
  risk at entry). The EA's post-close tracker already reports maxMore/
  maxReverse as dollar amounts (missedMoney/avoidedMoney) for the SAME
  position, so:
      MISSED_R_Xm            = checkpoint_Xm_missed_money / risk_usd
      MAX_ADVERSE_R_AFTER_Xm = checkpoint_Xm_avoided_money / risk_usd
      POST_EXIT_TOTAL_R_Xm   = EXIT_R + MISSED_R_Xm
  No ATR-to-price-to-R chained conversion is needed; both numerator and
  denominator are already in USD from the EA's own computation.

GIVEBACK_BEFORE_EXIT_R = max(0, PEAK_R_WHILE_OPEN - EXIT_R), using the
existing real mfe_r/realized_r columns already in 60DAY_ALL_POSITIONS.csv.

"Returned to entry" / "original SL crossed" per checkpoint window are
derived from the same real dollar amounts using each level's exact R
distance from the close price (entry is always at R=0, the structural SL
is always at R=-1.0 by definition), NOT from candle OHLC. This is exact
about WHETHER the level was reached within the window, but the EA's
checkpoint tracker stores independent running maxima for the favorable
and adverse directions -- it does not preserve which one happened first.
Sequencing (e.g. "returned to entry BEFORE the post-exit peak") is
therefore reported as UNAVAILABLE_SEQUENCING, not guessed.
"""
import argparse
import csv
from pathlib import Path

import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


CHECKPOINT_MINS = [5, 10, 15, 30, 60]


def load(out_dir: Path):
    pos = pd.read_csv(out_dir / "60DAY_ALL_POSITIONS.csv")
    cp = pd.read_csv(out_dir / "_post_close_checkpoints_5_10_15_30_60m.csv")
    cp["ticket"] = cp["ticket"].astype(str)
    pos["ticket"] = pos["ticket"].astype(str)
    return pos, cp


def load_20m(out_dir: Path):
    p = out_dir / "_post_close_20m_research.csv"
    if not p.exists():
        return None
    df = pd.read_csv(p)
    df["ticket"] = df["ticket"].astype(str)
    return df


def classify(row) -> str:
    """Deterministic classification A-H, documented per the definitions
    given for this analysis. Uses only real fields: missed R at 10m/20m,
    adverse R after exit, and whether entry/SL levels were reached within
    the window (magnitude-only, sequencing unavailable -- see module
    docstring)."""
    missed_10 = row.get("MISSED_R_10M")
    missed_20 = row.get("MISSED_R_20M")
    sl_crossed_10 = row.get("sl_crossed_10m")
    sl_crossed_20 = row.get("sl_crossed_20m")
    returned_entry_10 = row.get("returned_to_entry_10m")
    adverse_10 = row.get("MAX_ADVERSE_R_AFTER_10M")

    missed = missed_20 if pd.notna(missed_20) else missed_10
    if missed is None or pd.isna(missed):
        return "H_UNAVAILABLE"

    if sl_crossed_10 is True or sl_crossed_20 is True:
        return "C_ORIGINAL_SL_WOULD_HAVE_BEEN_HIT"
    if missed < 0.10:
        if adverse_10 is not None and pd.notna(adverse_10) and adverse_10 >= 0.25:
            return "A_CORRECT_EXIT_IMMEDIATE_REVERSAL"
        return "A_CORRECT_EXIT_IMMEDIATE_REVERSAL"
    if returned_entry_10 is True and missed < 0.25:
        return "B_CORRECT_EXIT_RETURNED_TO_ENTRY"
    if 0.10 <= missed < 0.25:
        return "D_SLIGHTLY_EARLY_EXIT"
    if 0.25 <= missed < 0.50:
        if adverse_10 is not None and pd.notna(adverse_10) and adverse_10 >= 0.30:
            return "G_MIXED_VOLATILE_AFTER_EXIT"
        return "E_MEANINGFULLY_EARLY_EXIT"
    if missed >= 0.50:
        if adverse_10 is not None and pd.notna(adverse_10) and adverse_10 >= 0.40:
            return "G_MIXED_VOLATILE_AFTER_EXIT"
        return "F_SEVERELY_EARLY_EXIT"
    return "H_UNAVAILABLE"


def build_merged(pos: pd.DataFrame, cp: pd.DataFrame, m20: pd.DataFrame | None):
    df = pos.merge(cp, on="ticket", how="left", suffixes=("", "_cpwatch"))
    if m20 is not None:
        df = df.merge(m20, on="ticket", how="left", suffixes=("", "_20m"))

    for m in CHECKPOINT_MINS:
        missed_col = f"checkpoint_{m}m_missed_money"
        avoided_col = f"checkpoint_{m}m_avoided_money"
        df[f"MISSED_R_{m}M"] = df[missed_col] / df["risk_usd"]
        df[f"MAX_ADVERSE_R_AFTER_{m}M"] = df[avoided_col] / df["risk_usd"]
        df[f"POST_EXIT_TOTAL_R_{m}M"] = df["realized_r"] + df[f"MISSED_R_{m}M"]
        # entry is R=0, structural SL is R=-1.0 by definition; both
        # measured as an adverse distance FROM the exit's own R level.
        df[f"returned_to_entry_{m}m"] = df[f"MAX_ADVERSE_R_AFTER_{m}M"] >= df["realized_r"]
        df[f"sl_crossed_{m}m"] = df[f"MAX_ADVERSE_R_AFTER_{m}M"] >= (df["realized_r"] + 1.0)

    if m20 is not None and "max_more_r_20m" in df.columns:
        df["MISSED_R_20M"] = df["max_more_r_20m"]
        df["MAX_ADVERSE_R_AFTER_20M"] = df["max_reverse_r_20m"]
        df["POST_EXIT_TOTAL_R_20M"] = df["realized_r"] + df["MISSED_R_20M"]
        df["returned_to_entry_20m"] = df["MAX_ADVERSE_R_AFTER_20M"] >= df["realized_r"]
        df["sl_crossed_20m"] = df["MAX_ADVERSE_R_AFTER_20M"] >= (df["realized_r"] + 1.0)
    else:
        df["MISSED_R_20M"] = None
        df["MAX_ADVERSE_R_AFTER_20M"] = None
        df["POST_EXIT_TOTAL_R_20M"] = None
        df["returned_to_entry_20m"] = None
        df["sl_crossed_20m"] = None

    df["PEAK_R_WHILE_OPEN"] = df["mfe_r"]
    df["GIVEBACK_BEFORE_EXIT_R"] = (df["mfe_r"] - df["realized_r"]).clip(lower=0)

    df["exit_classification"] = df.apply(classify, axis=1)
    return df


def summarize(df: pd.DataFrame, minute_col_prefix: str, label: str) -> dict:
    missed = df[f"MISSED_R_{minute_col_prefix}"].dropna()
    n = len(missed)
    if n == 0:
        return {"label": label, "n": 0}
    return {
        "label": label,
        "n": n,
        "n_with_additional_movement": int((missed > 0).sum()),
        "n_missing_010R": int((missed >= 0.10).sum()),
        "n_missing_025R": int((missed >= 0.25).sum()),
        "n_missing_050R": int((missed >= 0.50).sum()),
        "n_missing_100R": int((missed >= 1.00).sum()),
        "avg_missed_r": round(missed.mean(), 4),
        "median_missed_r": round(missed.median(), 4),
        "p75_missed_r": round(missed.quantile(0.75), 4),
        "p90_missed_r": round(missed.quantile(0.90), 4),
        "max_missed_r": round(missed.max(), 4),
        "total_missed_r": round(missed.sum(), 4),
        "n_returned_to_entry": int(df[f"returned_to_entry_{minute_col_prefix.lower()}"].fillna(False).sum())
        if f"returned_to_entry_{minute_col_prefix.lower()}" in df.columns else None,
        "n_sl_crossed": int(df[f"sl_crossed_{minute_col_prefix.lower()}"].fillna(False).sum())
        if f"sl_crossed_{minute_col_prefix.lower()}" in df.columns else None,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out-dir", required=True, type=Path)
    args = ap.parse_args()

    pos, cp = load(args.out_dir)
    m20 = load_20m(args.out_dir)
    df = build_merged(pos, cp, m20)

    core_win = df[(df["leg_role"] == "CORE") & (df["realized_profit_usd"] > 0)].copy()
    all_win = df[df["realized_profit_usd"] > 0].copy()

    print(f"CORE profitable positions: {len(core_win)} (expected 151 or 152 depending on breakeven handling)")
    print(f"All profitable positions (incl. pyramids): {len(all_win)}")

    core_cols = ["ticket", "campaign_id", "direction", "entry_time", "entry_price",
                 "structural_sl_price", "sl_distance_price", "risk_usd", "exit_time",
                 "exit_price", "exit_reason_ea", "exit_authority", "realized_profit_usd",
                 "realized_r", "PEAK_R_WHILE_OPEN", "GIVEBACK_BEFORE_EXIT_R"]
    for m in [5, 10, 15, 20, 30, 60]:
        core_cols += [f"POST_EXIT_TOTAL_R_{m}M", f"MISSED_R_{m}M"]
    core_cols += ["MAX_ADVERSE_R_AFTER_10M", "MAX_ADVERSE_R_AFTER_20M",
                  "returned_to_entry_10m", "returned_to_entry_20m",
                  "sl_crossed_10m", "sl_crossed_20m", "exit_classification"]
    core_cols = [c for c in core_cols if c in core_win.columns]

    core_win[core_cols].to_csv(args.out_dir / "60DAY_POST_EXIT_10_20_CORE_TRADES.csv", index=False)
    all_win[core_cols].to_csv(args.out_dir / "60DAY_POST_EXIT_10_20_ALL_WINNERS.csv", index=False)

    # classification breakdown
    core_win["exit_classification"].value_counts().rename_axis("classification").reset_index(name="count").to_csv(
        args.out_dir / "60DAY_POST_EXIT_CLASSIFICATION.csv", index=False)

    # by exit authority
    auth_rows = []
    for reason, grp in core_win.groupby("exit_reason_ea"):
        auth_rows.append({
            "exit_reason_ea": reason,
            "profitable_core_trades": len(grp),
            "avg_exit_r": round(grp["realized_r"].mean(), 4),
            "avg_peak_r_while_open": round(grp["PEAK_R_WHILE_OPEN"].mean(), 4),
            "avg_missed_r_10m": round(grp["MISSED_R_10M"].mean(), 4),
            "avg_missed_r_20m": round(grp["MISSED_R_20M"].mean(), 4) if grp["MISSED_R_20M"].notna().any() else None,
            "clean_continuation_count": int((grp["MISSED_R_10M"] >= 0.25).sum()),
            "reversal_count": int((grp["MISSED_R_10M"] < 0.10).sum()),
            "returned_to_entry_count": int(grp["returned_to_entry_10m"].fillna(False).sum()),
        })
    pd.DataFrame(auth_rows).sort_values("profitable_core_trades", ascending=False).to_csv(
        args.out_dir / "60DAY_POST_EXIT_BY_EXIT_AUTHORITY.csv", index=False)

    # by market regime (join to entry-timing/regime file if present)
    timing_path = args.out_dir / "60DAY_ENTRY_TIMING_AND_REGIME.csv"
    if timing_path.exists():
        timing = pd.read_csv(timing_path)
        timing["campaign_id"] = timing["campaign_id"].astype(str)
        core_win2 = core_win.copy()
        core_win2["campaign_id"] = core_win2["campaign_id"].astype(str)
        joined = core_win2.merge(
            timing[["campaign_id", "regime_at_signal", "lifecycle_state_at_entry", "entry_timing_classification"]],
            on="campaign_id", how="left")
        regime_rows = []
        for dim in ["regime_at_signal", "lifecycle_state_at_entry", "entry_timing_classification"]:
            for val, grp in joined.groupby(dim):
                if grp["MISSED_R_10M"].notna().sum() == 0:
                    continue
                regime_rows.append({
                    "dimension": dim,
                    "value": val,
                    "profitable_core_trades": len(grp),
                    "avg_missed_r_10m": round(grp["MISSED_R_10M"].mean(), 4),
                    "avg_missed_r_20m": round(grp["MISSED_R_20M"].mean(), 4) if grp["MISSED_R_20M"].notna().any() else None,
                    "total_missed_r_10m": round(grp["MISSED_R_10M"].sum(), 4),
                })
        pd.DataFrame(regime_rows).to_csv(args.out_dir / "60DAY_POST_EXIT_BY_MARKET_REGIME.csv", index=False)
    else:
        print("WARNING: 60DAY_ENTRY_TIMING_AND_REGIME.csv not found, skipping market-condition breakdown")

    # summaries
    summary_core_10 = summarize(core_win, "10M", "CORE profitable, 10-minute")
    summary_core_20 = summarize(core_win, "20M", "CORE profitable, 20-minute")
    summary_all_10 = summarize(all_win, "10M", "All profitable (incl. pyramids), 10-minute")
    summary_all_20 = summarize(all_win, "20M", "All profitable (incl. pyramids), 20-minute")

    # charts
    plt.rcParams.update({"figure.dpi": 110, "font.size": 9})
    fig, ax = plt.subplots(figsize=(8, 5))
    ax.hist(core_win["MISSED_R_10M"].dropna(), bins=30, color="#c62828", alpha=0.8)
    ax.set_xlabel("Missed R (10 minutes after exit)"); ax.set_ylabel("Number of CORE profitable trades")
    ax.set_title("Post-Exit Missed R -- 10 Minutes (CORE profitable trades)")
    fig.tight_layout(); fig.savefig(args.out_dir / "60DAY_POST_EXIT_10M_MISSED_R.png"); plt.close(fig)

    fig, ax = plt.subplots(figsize=(8, 5))
    if core_win["MISSED_R_20M"].notna().any():
        ax.hist(core_win["MISSED_R_20M"].dropna(), bins=30, color="#ef6c00", alpha=0.8)
    else:
        ax.text(0.5, 0.5, "20-minute data pending rerun verification", ha="center", va="center")
    ax.set_xlabel("Missed R (20 minutes after exit)"); ax.set_ylabel("Number of CORE profitable trades")
    ax.set_title("Post-Exit Missed R -- 20 Minutes (CORE profitable trades)")
    fig.tight_layout(); fig.savefig(args.out_dir / "60DAY_POST_EXIT_20M_MISSED_R.png"); plt.close(fig)

    import json
    with (args.out_dir / "_post_exit_summaries.json").open("w") as f:
        json.dump({
            "core_10m": summary_core_10, "core_20m": summary_core_20,
            "all_10m": summary_all_10, "all_20m": summary_all_20,
        }, f, indent=2, default=str)

    print("Summaries:")
    for s in [summary_core_10, summary_core_20, summary_all_10, summary_all_20]:
        print(s)


if __name__ == "__main__":
    main()
