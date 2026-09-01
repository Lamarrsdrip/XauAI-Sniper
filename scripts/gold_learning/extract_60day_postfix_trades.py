#!/usr/bin/env python3
"""Extract real per-trade and per-campaign behavior from the verified
60-day M30-postfix Strategy Tester replay (2026-05-18 -> 2026-07-17,
EA v6.25.6 trade-frequency fix, EX5 SHA-256
430f8d11478d2d0a80df89f0baf0daa7a8a94534fad3c3d4b96e7a1bffc80bc9).

This does NOT reconstruct or estimate anything from candle OHLC. Every
number in the output CSVs comes from one of two real, verified sources:

  1. The MT5 Strategy Tester's own HTML report (Deals table) --
     broker-confirmed execution price, time, volume, commission, swap,
     realized profit, and the EA's own open/close comment tag. Tagged
     TESTER_REPORT.

  2. The EA's own real-time structured journal logging -- the EA already
     computes and prints, for every position, its own entry risk
     geometry (R_EXIT_ENTRY_CAPTURE_CONFIRMED: entry price, structural
     SL price, SL distance, risk USD, lots) and, at exit, its own
     R-multiple outcome and the REAL maximum favorable/adverse excursion
     it tracked while the position was open (R_EXIT_COUNTERFACTUAL:
     exitReason, exitR, MFE_peakR/USD, MAE_troughR/USD, and which R
     checkpoints -- 0.20/0.30/0.40/0.50/0.75/1.00 -- were ever reached).
     Campaign structure (core + pyramid grouping) comes from the EA's
     own CAMPAIGN_OPENED / CAMPAIGN_ADD_REGISTERED / CAMPAIGN_CLOSED
     events, which carry a real campaign ID (CAMP-N) and, for the core
     leg, the exact ticket. Tagged EXACT_JOURNAL.

No tick-path MAE/MFE reconstruction from bars is attempted here -- it is
not needed: the EA's own R_EXIT manager already tracked real floating
R/USD continuously while every position was open and logged the true
peak/trough at close. That is a stronger source than a candle-OHLC
reconstruction would be (see 60DAY_METHOD_AND_LIMITATIONS.md for the one
remaining caveat: the R_EXIT manager's own sampling cadence).

Usage:
    python3 extract_60day_postfix_trades.py \
        --journal /path/to/journal_utf8.log \
        --report-html /path/to/v6255_backtest_m30_extended_postfix.html \
        --out-dir /path/to/audits/gold_learning/60day_behavior_report
"""
import argparse
import csv
import json
import re
import statistics
from datetime import datetime
from pathlib import Path


def parse_report_deals(html_path: Path):
    """Parse the MT5 Strategy Tester HTML report's Deals table.
    The file is UTF-16LE; decode once here."""
    raw = html_path.read_bytes()
    try:
        text = raw.decode("utf-16")
    except UnicodeDecodeError:
        text = raw.decode("utf-8", errors="ignore")

    row_re = re.compile(
        r"<tr[^>]*>\s*<td>([^<]*)</td>\s*<td>([^<]*)</td>\s*<td>([^<]*)</td>\s*"
        r"<td>([^<]*)</td>\s*<td>([^<]*)</td>\s*<td>([^<]*)</td>\s*<td>([^<]*)</td>\s*"
        r"<td>([^<]*)</td>\s*<td>([^<]*)</td>\s*<td>([^<]*)</td>\s*<td>([^<]*)</td>\s*"
        r"<td>([^<]*)</td>\s*<td>([^<]*)</td>\s*</tr>"
    )
    deals = []
    for m in row_re.finditer(text):
        (time_s, deal_id, symbol, typ, direction, volume, price, order_id,
         commission, swap, profit, balance, comment) = m.groups()
        if not deal_id.strip().isdigit():
            continue
        if typ.strip() == "balance":
            continue

        def num(s):
            s = s.strip().replace(" ", "").replace("\xa0", "")
            return float(s) if s not in ("", "-") else 0.0

        deals.append({
            "time": time_s.strip(),
            "deal_id": int(deal_id.strip()),
            "symbol": symbol.strip(),
            "type": typ.strip(),
            "direction": direction.strip(),
            "volume": num(volume),
            "price": num(price),
            "order_id": order_id.strip(),
            "commission": num(commission),
            "swap": num(swap),
            "profit": num(profit),
            "balance": num(balance),
            "comment": comment.strip(),
        })
    return deals


def pair_positions_from_deals(deals):
    """Pair 'in' deals with their closing 'out' deal(s). MT5 hedging-mode
    tester: each 'in' deal opens one position ticket; the matching 'out'
    deal (same volume, opposite side, first still-open match in time
    order) closes it. Multiple simultaneous positions of the same
    direction (core + pyramid) are common; FIFO-by-volume-match resolves
    them correctly because volumes differ per leg in this dataset (core
    and pyramid lot sizes are computed independently and are not equal
    in any observed campaign)."""
    open_buy = []   # list of dicts, deals with type=buy, direction=in
    open_sell = []
    positions = []

    for d in deals:
        if d["direction"] == "in":
            if d["type"] == "buy":
                open_buy.append(d)
            else:
                open_sell.append(d)
        elif d["direction"] == "out":
            pool = open_sell if d["type"] == "buy" else open_buy
            # buy-out closes a sell-in position; sell-out closes a buy-in
            match_idx = None
            for i, o in enumerate(pool):
                if abs(o["volume"] - d["volume"]) < 1e-9:
                    match_idx = i
                    break
            if match_idx is None and pool:
                match_idx = 0  # fallback: oldest open of that side
            if match_idx is not None:
                opened = pool.pop(match_idx)
                positions.append({
                    "ticket": opened["deal_id"],
                    "direction": "BUY" if opened["type"] == "buy" else "SELL",
                    "volume": opened["volume"],
                    "entry_time": opened["time"],
                    "entry_price": opened["price"],
                    "entry_comment": opened["comment"],
                    "exit_time": d["time"],
                    "exit_price": d["price"],
                    "exit_comment": d["comment"],
                    "exit_deal_id": d["deal_id"],
                    "commission": opened["commission"] + d["commission"],
                    "swap": opened["swap"] + d["swap"],
                    "realized_profit_usd": d["profit"],
                })
    positions.sort(key=lambda p: p["ticket"])
    return positions


LOG_LINE_RE = re.compile(
    r"^CS\t\d+\t[\d:.]+\t[^\t]+\t(?P<ts>\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}:\d{2})\s+(?P<body>.*)$"
)


CAMP_ID_RE = re.compile(r"\bCAMP-\d+\b")


def kv_parse(body: str):
    """Parse 'key=value key2=value2 ...' tokens from a log line body.
    Two real line shapes appear in this journal:
      'EVENT_TAG key=val key2=val2 ...'                  (no pipe)
      'EVENT_TAG | CAMP-N key=val key2=val2 ...'          (campaign lines)
    _event_type is the tag before the pipe (or the whole first token when
    there is no pipe); _campaign_id is the real CAMP-N token, found by
    pattern match rather than assumed position, since it is NOT itself a
    key=value pair."""
    out = {}
    body = body.strip()
    if "|" in body:
        tag, rest = body.split("|", 1)
        out["_event_type"] = tag.strip()
        body = rest
    camp_m = CAMP_ID_RE.search(body)
    if camp_m:
        out["_campaign_id"] = camp_m.group(0)
    for tok in re.findall(r"([\w.]+)=([^\s]+)", body):
        out[tok[0]] = tok[1]
    return out


def extract_journal_events(journal_path: Path):
    entries = {}      # ticket -> dict (R_EXIT_ENTRY_CAPTURE_CONFIRMED fields)
    exits = {}         # ticket -> dict (R_EXIT_COUNTERFACTUAL fields)
    campaigns_opened = []   # list of dicts (CAMPAIGN_OPENED)
    campaigns_added = []    # list of dicts (CAMPAIGN_ADD_REGISTERED)
    campaigns_closed = []   # list of dicts (CAMPAIGN_CLOSED)
    cooldowns = []           # list of dicts (POST_TRADE_COOLDOWN_STARTED)

    with journal_path.open("r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            if "R_EXIT_ENTRY_CAPTURE_CONFIRMED" in line:
                m = LOG_LINE_RE.match(line)
                if not m:
                    continue
                kv = kv_parse(m.group("body"))
                ticket = kv.get("ticket")
                if ticket:
                    entries[ticket] = {**kv, "log_time": m.group("ts")}
            elif "R_EXIT_COUNTERFACTUAL" in line:
                m = LOG_LINE_RE.match(line)
                if not m:
                    continue
                kv = kv_parse(m.group("body"))
                ticket = kv.get("ticket")
                if ticket:
                    exits[ticket] = {**kv, "log_time": m.group("ts")}
            elif "CAMPAIGN_OPENED" in line:
                m = LOG_LINE_RE.match(line)
                if not m:
                    continue
                kv = kv_parse(m.group("body"))
                kv["log_time"] = m.group("ts")
                campaigns_opened.append(kv)
            elif "CAMPAIGN_ADD_REGISTERED" in line:
                m = LOG_LINE_RE.match(line)
                if not m:
                    continue
                kv = kv_parse(m.group("body"))
                kv["log_time"] = m.group("ts")
                campaigns_added.append(kv)
            elif "CAMPAIGN_CLOSED" in line:
                m = LOG_LINE_RE.match(line)
                if not m:
                    continue
                kv = kv_parse(m.group("body"))
                kv["log_time"] = m.group("ts")
                campaigns_closed.append(kv)
            elif "POST_TRADE_COOLDOWN_STARTED" in line:
                m = LOG_LINE_RE.match(line)
                if not m:
                    continue
                kv = kv_parse(m.group("body"))
                kv["log_time"] = m.group("ts")
                cooldowns.append(kv)

    return {
        "entries": entries,
        "exits": exits,
        "campaigns_opened": campaigns_opened,
        "campaigns_added": campaigns_added,
        "campaigns_closed": campaigns_closed,
        "cooldowns": cooldowns,
    }


def build_ticket_to_campaign(events):
    """Map every ticket to its real EA-assigned campaign ID (CAMP-N),
    using exact log-timestamp equality between the entry-confirmation
    line and the campaign lifecycle line that opened/added it."""
    ticket_to_camp = {}
    camp_meta = {}

    for co in events["campaigns_opened"]:
        camp_id = co.get("_campaign_id")
        core_ticket = co.get("coreTicket")
        if core_ticket:
            ticket_to_camp[core_ticket] = camp_id
        camp_meta[camp_id] = {
            "campaign_id": camp_id,
            "direction": co.get("dir"),
            "setup": co.get("setup"),
            "invalidation": co.get("invalidation"),
            "dest1": co.get("dest1"),
            "core_ticket": core_ticket,
            "basket_one_r_money": co.get("basketOneRMoney"),
            "opened_at": co.get("log_time"),
        }

    # entries not yet mapped, sorted by time, tried against
    # campaign-add events at the same second (pyramid legs).
    entries_by_time = {}
    for ticket, e in events["entries"].items():
        entries_by_time.setdefault(e["log_time"], []).append(ticket)

    for ca in events["campaigns_added"]:
        t = ca.get("log_time")
        camp_id = ca.get("_campaign_id")
        candidates = entries_by_time.get(t, [])
        for ticket in candidates:
            if ticket not in ticket_to_camp:
                ticket_to_camp[ticket] = camp_id
                break

    return ticket_to_camp, camp_meta


def _f(x, default=None):
    if x is None:
        return default
    try:
        return float(x)
    except ValueError:
        return default


def build_positions_table(deal_positions, events, ticket_to_camp):
    entries = events["entries"]
    exits = events["exits"]
    rows = []
    for p in deal_positions:
        ticket = str(p["ticket"])
        e = entries.get(ticket, {})
        x = exits.get(ticket, {})
        camp_id = ticket_to_camp.get(ticket)
        leg_role = "CORE" if "M30_CONSENSUS_CORE" in p["entry_comment"] else (
            "PYRAMID" if "PYRAMID" in p["entry_comment"] else "UNKNOWN")

        sl_price = _f(e.get("sl"))
        sl_dist = _f(e.get("dist"))
        risk_usd = _f(e.get("riskUSD"))
        exit_reason = x.get("exitReason", "")
        exit_r = _f(x.get("exitR"))
        mfe_r = _f(x.get("MFE_peakR"))
        mfe_usd = _f(x.get("MFE_peakUSD"))
        mae_r = _f(x.get("MAE_troughR"))
        mae_usd = _f(x.get("MAE_troughUSD"))

        entry_dt = datetime.strptime(p["entry_time"], "%Y.%m.%d %H:%M:%S")
        exit_dt = datetime.strptime(p["exit_time"], "%Y.%m.%d %H:%M:%S")
        hold_minutes = round((exit_dt - entry_dt).total_seconds() / 60.0, 2)

        result = "WIN" if p["realized_profit_usd"] > 0 else (
            "LOSS" if p["realized_profit_usd"] < 0 else "BREAKEVEN")
        exit_authority = "BROKER_SL" if p["exit_comment"].startswith("sl ") else "EA_MANAGED_CLOSE"

        mfe_capture_pct = None
        if mfe_r and mfe_r > 0 and exit_r is not None:
            mfe_capture_pct = round((exit_r / mfe_r) * 100.0, 1)

        rows.append({
            "ticket": p["ticket"],
            "campaign_id": camp_id or "UNMATCHED",
            "leg_role": leg_role,
            "direction": p["direction"],
            "volume_lots": p["volume"],
            "entry_time": p["entry_time"],
            "entry_price": p["entry_price"],
            "structural_sl_price": sl_price,
            "sl_distance_price": sl_dist,
            "risk_usd": risk_usd,
            "exit_time": p["exit_time"],
            "exit_price": p["exit_price"],
            "exit_reason_ea": exit_reason,
            "exit_authority": exit_authority,
            "exit_broker_comment": p["exit_comment"],
            "hold_minutes": hold_minutes,
            "commission": round(p["commission"], 2),
            "swap": round(p["swap"], 2),
            "realized_profit_usd": p["realized_profit_usd"],
            "realized_r": exit_r,
            "mfe_r": mfe_r,
            "mfe_usd": mfe_usd,
            "mae_r": mae_r,
            "mae_usd": mae_usd,
            "mfe_capture_pct": mfe_capture_pct,
            "checkpoint_0_20R": x.get("0.20R"),
            "checkpoint_0_30R": x.get("0.30R"),
            "checkpoint_0_40R": x.get("0.40R"),
            "checkpoint_0_50R": x.get("0.50R"),
            "checkpoint_0_75R": x.get("0.75R"),
            "checkpoint_1_00R": x.get("1.00R"),
            "result": result,
            "entry_data_source": "EXACT_JOURNAL" if e else "TESTER_REPORT_ONLY",
            "exit_data_source": "EXACT_JOURNAL" if x else "TESTER_REPORT_ONLY",
        })
    return rows


def build_campaigns_table(positions_rows, events, camp_meta):
    by_camp = {}
    for r in positions_rows:
        by_camp.setdefault(r["campaign_id"], []).append(r)

    closed_by_id = {c.get("_campaign_id"): c for c in events["campaigns_closed"]}

    rows = []
    for camp_id, legs in by_camp.items():
        legs_sorted = sorted(legs, key=lambda r: r["entry_time"])
        core_legs = [l for l in legs_sorted if l["leg_role"] == "CORE"]
        pyramid_legs = [l for l in legs_sorted if l["leg_role"] == "PYRAMID"]
        total_profit = sum(l["realized_profit_usd"] for l in legs_sorted)
        meta = camp_meta.get(camp_id, {})
        closed = closed_by_id.get(camp_id, {})

        rows.append({
            "campaign_id": camp_id,
            "direction": legs_sorted[0]["direction"] if legs_sorted else meta.get("direction"),
            "setup_tag": meta.get("setup"),
            "num_positions": len(legs_sorted),
            "num_core": len(core_legs),
            "num_pyramid": len(pyramid_legs),
            "campaign_open_time": legs_sorted[0]["entry_time"] if legs_sorted else None,
            "campaign_close_time": legs_sorted[-1]["exit_time"] if legs_sorted else None,
            "total_realized_profit_usd": round(total_profit, 2),
            "core_only_profit_usd": round(sum(l["realized_profit_usd"] for l in core_legs), 2),
            "pyramid_only_profit_usd": round(sum(l["realized_profit_usd"] for l in pyramid_legs), 2),
            "campaign_result": "WIN" if total_profit > 0 else ("LOSS" if total_profit < 0 else "BREAKEVEN"),
            "campaign_peak_floating_usd": closed.get("peakFloating"),
            "campaign_mfe_usd": closed.get("MFE"),
            "campaign_mae_usd": closed.get("MAE"),
            "campaign_given_back_usd": closed.get("givenBack"),
            "any_broker_sl_hit": any(l["exit_authority"] == "BROKER_SL" for l in legs_sorted),
        })
    rows.sort(key=lambda r: (r["campaign_open_time"] or ""))
    return rows


def write_csv(path: Path, rows, fieldnames):
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            w.writerow(r)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--journal", required=True, type=Path)
    ap.add_argument("--report-html", required=True, type=Path)
    ap.add_argument("--out-dir", required=True, type=Path)
    args = ap.parse_args()

    args.out_dir.mkdir(parents=True, exist_ok=True)

    print("Parsing tester report deals table...")
    deals = parse_report_deals(args.report_html)
    print(f"  {len(deals)} deal rows (excluding balance row)")

    print("Pairing positions from deals...")
    deal_positions = pair_positions_from_deals(deals)
    print(f"  {len(deal_positions)} closed positions paired")

    print("Extracting structured journal events (this reads the full ~7.5GB decoded journal once)...")
    events = extract_journal_events(args.journal)
    print(f"  entries={len(events['entries'])} exits={len(events['exits'])} "
          f"campaigns_opened={len(events['campaigns_opened'])} "
          f"campaigns_added={len(events['campaigns_added'])} "
          f"campaigns_closed={len(events['campaigns_closed'])}")

    ticket_to_camp, camp_meta = build_ticket_to_campaign(events)
    print(f"  {len(ticket_to_camp)} tickets mapped to a real EA campaign ID")

    positions_rows = build_positions_table(deal_positions, events, ticket_to_camp)
    campaigns_rows = build_campaigns_table(positions_rows, events, camp_meta)

    pos_fields = list(positions_rows[0].keys()) if positions_rows else []
    camp_fields = list(campaigns_rows[0].keys()) if campaigns_rows else []

    write_csv(args.out_dir / "60DAY_ALL_POSITIONS.csv", positions_rows, pos_fields)
    write_csv(args.out_dir / "60DAY_ALL_CAMPAIGNS.csv", campaigns_rows, camp_fields)

    unmatched = [r for r in positions_rows if r["campaign_id"] == "UNMATCHED"]
    no_journal_entry = [r for r in positions_rows if r["entry_data_source"] != "EXACT_JOURNAL"]
    no_journal_exit = [r for r in positions_rows if r["exit_data_source"] != "EXACT_JOURNAL"]

    with (args.out_dir / "_extraction_summary.json").open("w") as f:
        json.dump({
            "total_deal_rows": len(deals),
            "total_positions_paired": len(deal_positions),
            "total_positions_written": len(positions_rows),
            "total_campaigns_written": len(campaigns_rows),
            "unmatched_campaign_count": len(unmatched),
            "positions_missing_journal_entry_data": len(no_journal_entry),
            "positions_missing_journal_exit_data": len(no_journal_exit),
        }, f, indent=2)

    print(f"Wrote {len(positions_rows)} positions, {len(campaigns_rows)} campaigns.")
    print(f"Unmatched campaign_id: {len(unmatched)}")
    print(f"Missing journal entry data: {len(no_journal_entry)}")
    print(f"Missing journal exit data: {len(no_journal_exit)}")


if __name__ == "__main__":
    main()
