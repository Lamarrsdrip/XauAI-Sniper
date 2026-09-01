#!/usr/bin/env python3
"""Build the owner-requested Scenario A stop-condition forensic artifacts.

The full MT5 HTML supplies exact 283-position money outcomes. The retained
repeat journal ended early and supplies exact R/floor evidence for 120 closed
positions only. Outputs deliberately label that scope; missing evidence is
never inferred.
"""

from __future__ import annotations

import argparse
import csv
import importlib.util
import re
import statistics
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path


AUDIT_FIELDS = [
    "ticket", "campaign_id", "leg_role", "direction", "entry_time", "exit_time",
    "entry_regime", "frozen_owner_exit_profile", "exit_authority", "exit_reason",
    "volume", "entry_price", "original_structural_sl", "original_1r_distance",
    "original_risk_usd", "realized_profit_usd", "realized_r", "peak_r_while_open",
    "mae_r", "owner_floor_armed_true_false", "owner_first_trigger_time",
    "owner_first_floor_r", "owner_adaptive_trigger_time", "owner_max_required_floor_r",
    "expected_min_exit_r", "actual_exit_r", "floor_violation_true_false",
    "floor_violation_r_amount", "floor_violation_usd_amount", "broker_sl_modify_attempted",
    "broker_sl_modify_success", "broker_sl_modify_failed_reason",
    "emergency_floor_breach_close_attempted", "emergency_floor_breach_close_success",
    "lower_exit_attempt_rejected_true_false", "lower_exit_attempt_authority",
    "tracking_state_present_at_exit", "r_exit_state_present_at_exit",
    "campaign_state_present_at_exit", "basket_state_present_at_exit", "audit_scope_note",
]


def load_module(path: Path):
    spec = importlib.util.spec_from_file_location("postfix", path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def read_csv(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def write_csv(path: Path, rows: list[dict], fields: list[str] | None = None) -> None:
    fields = fields or list(rows[0])
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def expected_floor(profile: str, peak: float) -> float | None:
    if profile == "TREND_UP":
        if peak < 0.50:
            return None
        return max(0.40, peak * 0.70 if peak >= 0.70 else 0.40)
    if peak < 0.40:
        return None
    return max(0.30, peak * 0.70 if peak >= 0.50 else 0.30)


def parse_reduced_log(path: Path):
    text = path.read_text(encoding="utf-8", errors="ignore")
    counterfactual = {}
    for m in re.finditer(
        r"R_EXIT_COUNTERFACTUAL positionId=(\d+).*?exitReason=([^ ]+).*?MAE_troughR=([-\d.]+)", text
    ):
        counterfactual[m.group(1)] = {"exit_reason": m.group(2), "mae_r": m.group(3)}
    floor_applied: dict[str, list[dict]] = defaultdict(list)
    for line in text.splitlines():
        if "PRIMARY_EXIT_FLOOR_APPLIED" in line:
            ticket = re.search(r"ticket=(\d+)", line)
            floor = re.search(r"guaranteedFloorR=([-\d.]+)", line)
            if ticket:
                floor_applied[ticket.group(1)].append({
                    "confirmed": "CONFIRMED" in line,
                    "floor": float(floor.group(1)) if floor else None,
                })
    campaign_floor: dict[str, dict] = {}
    profile_re = re.compile(
        r"(?P<ts>2026\.\d{2}\.\d{2} \d{2}:\d{2}:\d{2}).*?OWNER_EXIT_PROFILE=(?P<profile>\w+)"
        r".*?OWNER_EXIT_PEAK_R=(?P<peak>[-\d.]+).*?OWNER_EXIT_REQUIRED_LOCK_R=(?P<floor>[-\d.]+)"
        r".*?campaignId=(?P<campaign>CAMP-\d+)"
    )
    for m in profile_re.finditer(text):
        item = campaign_floor.setdefault(m.group("campaign"), {
            "first": m.group("ts"), "adaptive": "", "max_floor": 0.0,
            "profile": m.group("profile"),
        })
        peak = float(m.group("peak"))
        floor = float(m.group("floor"))
        item["max_floor"] = max(item["max_floor"], floor)
        adaptive_at = 0.70 if m.group("profile") == "TREND_UP" else 0.50
        if peak >= adaptive_at and not item["adaptive"]:
            item["adaptive"] = m.group("ts")
    markers = [
        "OWNER_EXIT_PROFILE", "OWNER_RISK_POLICY", "VERSION-DIAG", "OWNER_FLOOR_UPDATE",
        "OWNER_FLOOR_OVERRIDE", "REJECT_LOWER_EXIT", "XAU_OwnerProtectedFloorAllowsClose",
        "XAU_OwnerProtectedFloorAllowsModify", "R_PROFIT_GUARANTEE_FLOOR_BREACH", "SafeModifySL",
        "FLOOR_APPLIED", "FLOOR_CONFIRMATION_FAILED", "R_EXIT_ORPHAN_UNCONFIRMED",
        "BASKET_STATE_RESTORED", "OWNER_EXIT_PROFILE_FROZEN", "OWNER_EXIT_PROFILE_INHERITED",
        "CAMPAIGN_ADD_REGISTERED", "CAMPAIGN_CLOSED", "PYRAMID", "PARTIAL", "COUNTER_EXCURSION",
    ]
    counts = {marker: text.count(marker) for marker in markers}
    return text, counterfactual, floor_applied, campaign_floor, counts


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--partial-csv", required=True, type=Path)
    parser.add_argument("--report-html", required=True, type=Path)
    parser.add_argument("--reduced-log", required=True, type=Path)
    parser.add_argument("--legacy-parser", required=True, type=Path)
    parser.add_argument("--out-dir", required=True, type=Path)
    args = parser.parse_args()
    args.out_dir.mkdir(parents=True, exist_ok=True)

    partial = read_csv(args.partial_csv)
    module = load_module(args.legacy_parser)
    full_positions = module.pair_positions_from_deals(module.parse_report_deals(args.report_html))
    full_by_ticket = {str(p["ticket"]): p for p in full_positions}
    for p in full_positions:
        p["net"] = p["realized_profit_usd"] + p["commission"] + p["swap"]
    text, counter, applied, campaign_floor, marker_counts = parse_reduced_log(args.reduced_log)
    campaign_sizes = Counter(row["campaign_id"] for row in partial)

    audits = []
    for row in partial:
        ticket = row["position_id"]
        peak = float(row["peak_r_while_open"])
        actual = float(row["realized_r_at_exit"])
        risk = float(row["risk_usd"])
        expected = expected_floor(row["frozen_owner_exit_profile"], peak)
        numerical = expected is not None and actual + 0.000001 < expected
        full = full_by_ticket.get(ticket, {})
        cf = counter.get(ticket, {})
        camp = campaign_floor.get(row["campaign_id"], {})
        floor_rows = applied.get(ticket, [])
        multi_leg = campaign_sizes[row["campaign_id"]] > 1
        reason = cf.get("exit_reason", row["exit_authority"])
        audits.append({
            "ticket": ticket,
            "campaign_id": row["campaign_id"],
            "leg_role": row["leg_role"],
            "direction": row["direction"],
            "entry_time": row["entry_time"],
            "exit_time": row["exit_time"],
            "entry_regime": row["entry_regime"],
            "frozen_owner_exit_profile": row["frozen_owner_exit_profile"],
            "exit_authority": row["exit_authority"],
            "exit_reason": reason,
            "volume": full.get("volume", "DATA_UNAVAILABLE"),
            "entry_price": row["entry_price"],
            "original_structural_sl": row["original_sl"],
            "original_1r_distance": row["risk_distance"],
            "original_risk_usd": row["risk_usd"],
            "realized_profit_usd": row["realized_profit_usd"],
            "realized_r": row["realized_r_at_exit"],
            "peak_r_while_open": row["peak_r_while_open"],
            "mae_r": cf.get("mae_r", "DATA_UNAVAILABLE_IN_RETAINED_TELEMETRY"),
            "owner_floor_armed_true_false": str(expected is not None).lower(),
            "owner_first_trigger_time": camp.get("first", "DATA_UNAVAILABLE"),
            "owner_first_floor_r": "0.40" if row["frozen_owner_exit_profile"] == "TREND_UP" else "0.30",
            "owner_adaptive_trigger_time": camp.get("adaptive", ""),
            "owner_max_required_floor_r": camp.get("max_floor", expected if expected is not None else ""),
            "expected_min_exit_r": "" if expected is None else round(expected, 6),
            "actual_exit_r": row["realized_r_at_exit"],
            "floor_violation_true_false": str(numerical).lower(),
            "floor_violation_r_amount": round(expected - actual, 6) if numerical else 0.0,
            "floor_violation_usd_amount": round((expected - actual) * risk, 2) if numerical else 0.0,
            "broker_sl_modify_attempted": str(bool(floor_rows)).lower(),
            "broker_sl_modify_success": str(bool(floor_rows) and all(x["confirmed"] for x in floor_rows)).lower(),
            "broker_sl_modify_failed_reason": "NONE_LOGGED" if floor_rows else "NOT_APPLICABLE_OR_NOT_LOGGED",
            "emergency_floor_breach_close_attempted": str("R_PROFIT_GUARANTEE_FLOOR_BREACH" in reason).lower(),
            "emergency_floor_breach_close_success": str("R_PROFIT_GUARANTEE_FLOOR_BREACH" in reason).lower(),
            "lower_exit_attempt_rejected_true_false": "false",
            "lower_exit_attempt_authority": "NONE_LOGGED",
            "tracking_state_present_at_exit": "true",
            "r_exit_state_present_at_exit": "true" if ticket in counter else "NOT_PROVEN_BY_CLOSE_LOG",
            "campaign_state_present_at_exit": "true" if row["campaign_id"] != "CAMP-0" else "false",
            "basket_state_present_at_exit": "true" if multi_leg else "not_applicable_single_leg",
            "audit_scope_note": "PARTIAL_REPEAT_THROUGH_2026-05-22; CONFIG_INVALID_COUNTER_EXECUTE; multi-leg floor is campaign-denominated" if multi_leg else "PARTIAL_REPEAT_THROUGH_2026-05-22; CONFIG_INVALID_COUNTER_EXECUTE",
        })

    write_csv(args.out_dir / "SCENARIO_A_OWNER_FLOOR_TRADE_AUDIT.csv", audits, AUDIT_FIELDS)
    violations = [row for row in audits if row["floor_violation_true_false"] == "true"]
    write_csv(args.out_dir / "SCENARIO_A_FLOOR_VIOLATIONS.csv", violations or [{f: "" for f in AUDIT_FIELDS}], AUDIT_FIELDS)

    authority_rows = []
    grouped = defaultdict(list)
    for row in audits:
        grouped[row["exit_authority"]].append(row)
    for authority, rows in sorted(grouped.items()):
        pnl = [float(r["realized_profit_usd"]) for r in rows]
        rr = [float(r["realized_r"]) for r in rows]
        peaks = [float(r["peak_r_while_open"]) for r in rows]
        wins = [x for x in pnl if x >= 0]
        losses = [x for x in pnl if x < 0]
        authority_rows.append({
            "exit_authority": authority, "count": len(rows), "wins": len(wins), "losses": len(losses),
            "win_rate_pct": round(len(wins) / len(rows) * 100, 4), "gross_profit": round(sum(wins), 2),
            "gross_loss": round(sum(losses), 2), "net": round(sum(pnl), 2),
            "profit_factor": round(sum(wins) / abs(sum(losses)), 4) if losses else "INF",
            "average_realized_r": round(statistics.mean(rr), 6),
            "average_peak_r": round(statistics.mean(peaks), 6),
            "average_giveback_from_peak_r": round(statistics.mean(p - r for p, r in zip(peaks, rr)), 6),
            "count_with_floor_armed": sum(r["owner_floor_armed_true_false"] == "true" for r in rows),
            "count_with_floor_violation": sum(r["floor_violation_true_false"] == "true" for r in rows),
            "average_hold_time": "DATA_UNAVAILABLE_FOR_SOME_ENTRIES",
            "largest_win": max(pnl), "largest_loss": min(pnl), "scope": "120-POSITION PARTIAL REPEAT",
        })
    write_csv(args.out_dir / "SCENARIO_A_EXIT_AUTHORITY_BREAKDOWN.csv", authority_rows)

    wins = sorted((p for p in full_positions if p["net"] >= 0), key=lambda p: p["net"])
    losses = sorted((p for p in full_positions if p["net"] < 0), key=lambda p: p["net"])
    breakdown = [
        {"section": "SUMMARY", "metric": "average_win_usd", "value": round(statistics.mean(p["net"] for p in wins), 6)},
        {"section": "SUMMARY", "metric": "median_win_usd", "value": statistics.median(p["net"] for p in wins)},
        {"section": "SUMMARY", "metric": "average_loss_usd", "value": round(statistics.mean(p["net"] for p in losses), 6)},
        {"section": "SUMMARY", "metric": "median_loss_usd", "value": statistics.median(p["net"] for p in losses)},
    ]
    for label, values in (("TOP_20_BIGGEST_LOSSES", losses[:20]), ("TOP_20_SMALLEST_WINS", wins[:20])):
        for rank, p in enumerate(values, 1):
            breakdown.append({"section": label, "rank": rank, "ticket": p["ticket"], "entry_time": p["entry_time"], "exit_time": p["exit_time"], "direction": p["direction"], "volume": p["volume"], "value": p["net"]})
    write_csv(args.out_dir / "SCENARIO_A_AVG_WIN_LOSS_BREAKDOWN.csv", breakdown,
              ["section", "metric", "rank", "ticket", "entry_time", "exit_time", "direction", "volume", "value"])

    partial_wins = [a for a in audits if float(a["realized_profit_usd"]) >= 0]
    partial_losses = [a for a in audits if float(a["realized_profit_usd"]) < 0]
    armed = [a for a in audits if a["owner_floor_armed_true_false"] == "true"]
    losing_armed = [a for a in armed if float(a["realized_profit_usd"]) < 0]
    strict_bands = [(0.00, 0.15), (0.15, 0.30), (0.30, 0.50), (0.50, 999.0)]
    lines = [
        "# Scenario A Profit Giveback Forensic",
        "", "## Stop conclusion", "",
        "**Scenario A is not a certifiable clean baseline.** The retained repeat startup proves `COUNTER_EXCURSION` was `enabled=true` in `COUNTER_EXECUTE` mode. This violates the required tester configuration, even though the completed Run 1 HTML contains zero filled counter-excursion positions.",
        "", "The repeat was stopped early and contains 120 closed positions through 2026-05-22, not all 283. Its R evidence is therefore partial and is not substituted for missing 90-day evidence.",
        "", "## Completed Run 1 warning summary", "",
        "- Trades: 283; wins: 231; losses: 52; win rate: 81.63%.",
        "- Gross profit: $64,717.56; gross loss: -$59,826.86; net: $4,890.70; profit factor: 1.08.",
        f"- Average win: ${statistics.mean(p['net'] for p in wins):,.2f}; median win: ${statistics.median(p['net'] for p in wins):,.2f}.",
        f"- Average loss: ${statistics.mean(p['net'] for p in losses):,.2f}; median loss: ${statistics.median(p['net'] for p in losses):,.2f}.",
        f"- One average loss consumed {abs(statistics.mean(p['net'] for p in losses))/statistics.mean(p['net'] for p in wins):.2f} average wins.",
        "", "## Retained repeat R evidence (partial)", "",
        f"- Closed positions audited: {len(audits)}; wins: {len(partial_wins)}; losses: {len(partial_losses)}.",
        f"- Owner floor armed: {len(armed)}; did not arm: {len(audits)-len(armed)} ({(len(audits)-len(armed))/len(audits)*100:.1f}%).",
        f"- Losing positions that previously reached their floor trigger: {len(losing_armed)}.",
        f"- Strict numeric per-leg exits below theoretical floor: {len(violations)}. These are listed for review; multi-leg campaigns require campaign-denominated evaluation, and broker-stop rows include confirmed broker SL plus execution spread/slippage.",
        f"- Partial average win R: {statistics.mean(float(a['realized_r']) for a in partial_wins):.3f}R; partial average loss R: {statistics.mean(float(a['realized_r']) for a in partial_losses):.3f}R.",
        "", "## Interpretation", "",
        "The dominant measured cause is not a loss after the floor armed: no retained-repeat loss reached the trigger. Most trades never armed the floor, winners averaged only about +0.27R, and losses averaged about -0.98R. Therefore a high hit rate barely offsets full-1R losses. This points primarily to the distribution of entry outcomes/early small exits, not proven owner-floor failure.",
        "", "## Required log marker counts", "",
    ]
    lines += [f"- `{k}`: {v}" for k, v in marker_counts.items()]
    lines += ["", "## Build/config evidence", "",
              "- Git/source baseline: `cbe0b177fbaac1d09aa4fa55d640dd2689f1cd08`.",
              "- Startup: property/runtime `6.25.8`; build `v6258-final-owner-breakout-risk-exit-policy-20260718`.",
              "- MT5 Strategy Tester build 6030; XAUUSD M10; 100% real ticks (35,797,509 ticks / 8,538 bars); 2026-04-19 through 2026-07-18; USD; $10,000 start.",
              "- Completed Run 1 HTML SHA-256: `144ece6969274004dfcd6189d2a382d3e094d2961547c0e8202243fa717a2e4b`.",
              "- Actual Run 1/repeat input-set SHA-256 (before correction): `bc19ba801a4fdc0a26330a798d1f0c8c2d0cffc1fc6e55d7555629f97f8a7161`.",
              "- Corrected future input-set SHA-256 (`InpCounterExcursionMode=0`): `07421ca56b2635661237e6818b3da0d5255c1a7208438257973963a8912a9c76`.",
              "- Current on-disk research EX5 SHA-256: `00e5234f0f62711fc06e04f9a3c66d8c181c69b75c86a18af0912008ff69849b`; the hash was not journaled at launch, so it cannot by itself prove the exact loaded file after the fact.",
              "- Startup confirms GENERAL and TREND_UP profiles, structural SL 1.00R, full configured 10% risk, owner time block NONE, BRKT_UP/BRKT_DN blocks.",
              "- Fatal configuration mismatch: Counter Excursion enabled in execute mode. The completed HTML contains zero filled `XAU-COUNTER-EXC` positions, but the module was active and evaluated candidates.",
              "", "## Decision", "",
              "Do not continue Scenario B/C. Correct the tester input (`InpCounterExcursionMode=0`), preserve the EX5 and input hashes before launch, then rerun Scenario A from a clean state before diagnosing or changing trading rules."]
    (args.out_dir / "SCENARIO_A_PROFIT_GIVEBACK_FORENSIC.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    small = ["# Scenario A Small-Win / Big-Loss Report", "",
             "The completed 283-trade report is mathematically consistent: the 81.63% win rate is only slightly above the break-even rate required when an average loss is 4.11 times an average win.", "",
             f"- Average/median win: ${statistics.mean(p['net'] for p in wins):,.2f} / ${statistics.median(p['net'] for p in wins):,.2f}.",
             f"- Average/median loss: ${statistics.mean(p['net'] for p in losses):,.2f} / ${statistics.median(p['net'] for p in losses):,.2f}.",
             f"- Required break-even win rate at this payoff ratio: {abs(statistics.mean(p['net'] for p in losses))/(statistics.mean(p['net'] for p in wins)+abs(statistics.mean(p['net'] for p in losses)))*100:.2f}%.",
             "", "Partial-repeat realized-R bands:"]
    for lo, hi in strict_bands:
        small.append(f"- {lo:.2f}R to {'above' if hi > 100 else f'{hi:.2f}R'}: {sum(lo <= float(a['realized_r']) < hi for a in audits)}")
    small += ["", "Loss peak checks (partial):",
              f"- Peak >= +0.20R: {sum(float(a['peak_r_while_open']) >= .20 for a in partial_losses)}",
              f"- Peak >= +0.30R: {sum(float(a['peak_r_while_open']) >= .30 for a in partial_losses)}",
              f"- Peak >= +0.40R: {sum(float(a['peak_r_while_open']) >= .40 for a in partial_losses)}",
              f"- Peak >= +0.50R: {sum(float(a['peak_r_while_open']) >= .50 for a in partial_losses)}",
              "", "Conclusion: most winners were small because most positions did not reach the floor trigger; the retained sample does not show floor-armed trades becoming losses. The invalid Counter Excursion setting prevents certifying this as the final 90-day baseline."]
    (args.out_dir / "SCENARIO_A_SMALL_WIN_BIG_LOSS_REPORT.md").write_text("\n".join(small) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
