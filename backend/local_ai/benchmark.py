from __future__ import annotations

import argparse
import json
import statistics
import time
import urllib.request
from pathlib import Path
from typing import Any


def snapshots(model: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    cases = [
        ("BUY", 74.0, 42.0, "TREND_PULLBACK", "A", "GOOD", 79.0, "CONFIRMED"),
        ("SELL", 39.0, 77.0, "BREAKOUT", "A+", "GOOD", -82.0, "CONFIRMED"),
        ("BUY", 58.0, 54.0, "M10_ORIGINATED_CANDIDATE", "B", "RESET_PENDING", 18.0, "DEVELOPING"),
        ("NONE", 48.0, 49.0, "NONE", "SKIP", "OTHER", 1.0, "UNCLEAR"),
        ("SELL", 44.0, 68.0, "ADAPTIVE_REVERSAL_RECLAIM", "A", "LATE", -61.0, "DEVELOPING"),
    ]
    for index in range(20):
        direction, buy, sell, setup, grade, location, momentum, structure = cases[index % len(cases)]
        price = 3330.0 + index
        rows.append({
            "symbol": "XAUUSD", "closed_m10_timestamp": 1785000000 + index * 600,
            "recent_m10_ohlc": [[price - 1, price + 2, price - 3, price + 0.5]],
            "atr": 4.2, "volatility_state": "NORMAL", "ema_state": f"FAST_ABOVE_SLOW slope={momentum}",
            "rsi": 55.0 if direction == "BUY" else 45.0, "momentum_score": momentum,
            "buy_score": buy, "sell_score": sell, "preferred_direction": direction,
            "setup": setup, "grade": grade, "session": "LONDON", "regime": "TRENDING",
            "location": location, "structure_state": structure, "breakout_state": "NO_BREAKOUT",
            "pullback_state": "COMPLETE" if "PULLBACK" in setup else "NONE", "reset_state": "CLEAR",
            "reward_room_r": 2.1, "higher_timeframe_context": "M15=BUY M30=BUY H1=NEUTRAL",
            "open_position_state": "FLAT",
            "allowed_candidate_setups": [
                "TREND_PULLBACK", "RANGE_REVERSAL", "BREAKOUT", "SQUEEZE_RELEASE",
                "RSI_EXTREME", "LONDON_FIX_PIN", "MULTI_EXTREME", "ASIA_BREAKOUT",
                "HTF_TREND_FOLLOW", "ADAPTIVE_REVERSAL_RECLAIM", "M10_ORIGINATED_CANDIDATE",
            ],
            "model_name": model,
        })
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gateway", default="http://127.0.0.1:8765")
    parser.add_argument("--model", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--requests", type=int, default=20)
    args = parser.parse_args()
    results = []
    for snapshot in snapshots(args.model)[: max(1, min(args.requests, 20))]:
        request = urllib.request.Request(
            f"{args.gateway}/api/local-ai/decision",
            data=json.dumps(snapshot, separators=(",", ":")).encode(),
            headers={"Content-Type": "application/json"}, method="POST",
        )
        started = time.perf_counter()
        with urllib.request.urlopen(request, timeout=30) as response:
            result = json.loads(response.read())
        result["wall_ms"] = round((time.perf_counter() - started) * 1000, 2)
        results.append(result)
    latencies = [result["wall_ms"] for result in results]
    validity = sum("decision" in result for result in results)
    report = {
        "model": args.model, "requests": len(results), "valid_decisions": validity,
        "json_validity_percent": round(100 * validity / len(results), 2),
        "average_wall_ms": round(statistics.fmean(latencies), 2),
        "p95_wall_ms": sorted(latencies)[int(0.95 * (len(latencies) - 1))],
        "timeouts": sum(result.get("reason") == "LOCAL_AI_TIMEOUT" for result in results),
        "fallbacks": sum(result.get("fallback") == "DETERMINISTIC" for result in results),
        "results": results,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({key: value for key, value in report.items() if key != "results"}, indent=2))


if __name__ == "__main__":
    main()
