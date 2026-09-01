"""Export closed XAUUSDm bars from the active local MetaTrader 5 terminal.

This script is read-only: it uses the official MetaTrader5 Python bridge and
only calls account/symbol/rates read APIs. It never places, modifies, or closes
an order.
"""

from __future__ import annotations

import csv
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import MetaTrader5 as mt5


SYMBOL = "XAUUSDm"
EXPORTS = (
    ("H1", mt5.TIMEFRAME_H1, 900),
    ("H4", mt5.TIMEFRAME_H4, 250),
    ("D1", mt5.TIMEFRAME_D1, 90),
)


def main(output_root: Path) -> int:
    if not mt5.initialize(timeout=15_000):
        print(f"MT5 initialize failed: {mt5.last_error()}", file=sys.stderr)
        return 1

    try:
        account = mt5.account_info()
        symbol = mt5.symbol_info(SYMBOL)
        if account is None or symbol is None:
            print(f"MT5 data unavailable: {mt5.last_error()}", file=sys.stderr)
            return 1

        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        destination = output_root / stamp
        destination.mkdir(parents=True, exist_ok=False)
        result = {
            "exported_at_utc": datetime.now(timezone.utc).isoformat(),
            "server": account.server,
            "symbol": SYMBOL,
            "digits": symbol.digits,
            "timeframes": {},
        }

        for name, timeframe, requested in EXPORTS:
            # Position 1 skips the in-progress bar, making replay inputs closed-only.
            rates = mt5.copy_rates_from_pos(SYMBOL, timeframe, 1, requested)
            if rates is None or len(rates) < requested:
                print(
                    f"{name}: requested {requested} closed bars, got {0 if rates is None else len(rates)}; {mt5.last_error()}",
                    file=sys.stderr,
                )
                return 1

            path = destination / f"{SYMBOL}_{name}.csv"
            with path.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.writer(handle)
                writer.writerow(("time_utc", "open", "high", "low", "close", "tick_volume", "spread", "real_volume"))
                for row in rates:
                    writer.writerow(
                        (
                            datetime.fromtimestamp(int(row["time"]), timezone.utc).isoformat(),
                            row["open"],
                            row["high"],
                            row["low"],
                            row["close"],
                            int(row["tick_volume"]),
                            int(row["spread"]),
                            int(row["real_volume"]),
                        )
                    )
            result["timeframes"][name] = {"requested": requested, "exported": len(rates), "file": path.name}

        (destination / "provenance.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        print(destination)
        return 0
    finally:
        mt5.shutdown()


if __name__ == "__main__":
    root = Path(sys.argv[1]) if len(sys.argv) == 2 else Path("mt5_broker_exports")
    raise SystemExit(main(root))
