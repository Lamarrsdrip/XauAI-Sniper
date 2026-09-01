#!/usr/bin/env python3
"""Compare two MT5 Strategy Tester reports for exact trade neutrality."""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
from pathlib import Path


ROW_RE = re.compile(r"<tr[^>]*>(.*?)</tr>", re.I | re.S)
CELL_RE = re.compile(r"<td[^>]*>(.*?)</td>", re.I | re.S)
TAG_RE = re.compile(r"<[^>]+>")


def clean(value: str) -> str:
    return " ".join(html.unescape(TAG_RE.sub("", value)).replace("\xa0", " ").split())


def section(text: str, name: str, next_name: str | None) -> str:
    start = text.find(f">{name}</b>")
    if start < 0:
        raise ValueError(f"{name} section not found")
    end = text.find(f">{next_name}</b>", start) if next_name else len(text)
    return text[start : end if end >= 0 else len(text)]


def rows(block: str) -> list[list[str]]:
    return [[clean(cell) for cell in CELL_RE.findall(row)] for row in ROW_RE.findall(block)]


def parse(path: Path) -> dict:
    raw = path.read_bytes()
    text = raw.decode("utf-16") if raw.startswith((b"\xff\xfe", b"\xfe\xff")) else raw.decode("utf-8")

    entry_orders = []
    for row in rows(section(text, "Orders", "Deals")):
        if len(row) != 11 or not row[1].isdigit() or not row[10].startswith("XAU-SNIPER|"):
            continue
        entry_orders.append({
            "entry_time": row[0], "symbol": row[2], "direction": row[3].upper(),
            "lots": row[4].split("/")[0].strip(), "sl": row[6], "tp": row[7],
            "role": "PYRAMID" if "PYRAMID" in row[10] else "CORE", "comment": row[10],
        })

    deals = []
    final_balance = ""
    for row in rows(section(text, "Deals", None)):
        if len(row) != 13 or not row[1].isdigit():
            continue
        final_balance = row[11]
        if row[3] == "balance":
            continue
        deals.append({
            "time": row[0], "symbol": row[2], "type": row[3], "direction": row[4],
            "lots": row[5], "price": row[6], "commission": row[8], "swap": row[9],
            "profit": row[10], "comment": row[12],
        })

    return {
        "sha256": hashlib.sha256(raw).hexdigest(),
        "entry_orders": entry_orders,
        "deals": deals,
        "entry_count": len(entry_orders),
        "pyramid_count": sum(order["role"] == "PYRAMID" for order in entry_orders),
        "final_balance": final_balance,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("collect", type=Path)
    parser.add_argument("advisor", type=Path)
    parser.add_argument("--json", type=Path, required=True)
    parser.add_argument("--markdown", type=Path, required=True)
    args = parser.parse_args()

    collect = parse(args.collect)
    advisor = parse(args.advisor)
    order_equal = collect["entry_orders"] == advisor["entry_orders"]
    deal_equal = collect["deals"] == advisor["deals"]
    balance_equal = collect["final_balance"] == advisor["final_balance"]
    passed = order_equal and deal_equal and balance_equal
    result = {
        "status": "PASS" if passed else "FAIL",
        "entry_orders_identical": order_equal,
        "deals_and_exits_identical": deal_equal,
        "final_balance_identical": balance_equal,
        "collect": {k: v for k, v in collect.items() if k not in ("entry_orders", "deals")},
        "advisor": {k: v for k, v in advisor.items() if k not in ("entry_orders", "deals")},
        "first_order_difference": next((i for i, pair in enumerate(zip(collect["entry_orders"], advisor["entry_orders"])) if pair[0] != pair[1]), None),
        "first_deal_difference": next((i for i, pair in enumerate(zip(collect["deals"], advisor["deals"])) if pair[0] != pair[1]), None),
    }
    args.json.parent.mkdir(parents=True, exist_ok=True)
    args.json.write_text(json.dumps(result, indent=2) + "\n")
    args.markdown.write_text(
        "# TradeBrain advisor-neutrality comparison\n\n"
        f"Result: **{result['status']}**\n\n"
        f"- Entry orders (time, direction, lots, SL, TP, core/pyramid): {order_equal}\n"
        f"- Deals and exits (time, side, lots, price, commission, swap, P&L): {deal_equal}\n"
        f"- Final balance: {balance_equal}\n"
        f"- Collect entries/pyramids: {collect['entry_count']}/{collect['pyramid_count']}\n"
        f"- Advisor entries/pyramids: {advisor['entry_count']}/{advisor['pyramid_count']}\n"
        f"- Collect report SHA-256: `{collect['sha256']}`\n"
        f"- Advisor report SHA-256: `{advisor['sha256']}`\n"
    )
    print(json.dumps(result, indent=2))
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
