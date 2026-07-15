#!/usr/bin/env python3
"""Reusable Mac/VPS telemetry export — parses the EA's own terminal journal
log into a structured, machine-labeled export, closing the gap identified
in audits/v6243_reentry_snapshot_forensic_20260715.md's "Remaining evidence
gap": *"For a future true side-by-side VPS comparison, retain on both
machines the same M5/M1/tick export plus DECISION_SNAPSHOT, candidate id,
decision bar, spread, symbol properties, input hash, EA build hash, and
broker deal history."*

This does NOT invent a new telemetry-capture mechanism. Every field it
extracts is already emitted by the EA's own PrintFormat lines (DECISION_
SNAPSHOT, MARKET_THESIS, STRUCTURAL_SL_TRACE, RISK_MARGIN_TRACE, the
CAMPAIGN_* family, PYRAMID_BLOCKED_CAMPAIGN_EXHAUSTION) into the standard
MT5 terminal journal at MQL5/Logs/YYYYMMDD.log -- this script only parses
and structures what the EA is already writing, on whichever machine you
run it.

Usage (run on each machine separately, journal files stay local):
    python3 export_telemetry.py \\
        --log "/path/to/MQL5/Logs/20260715.log" \\
        --machine-label MAC \\
        --out mac_telemetry_20260715.json

    python3 export_telemetry.py \\
        --log "/path/to/MQL5/Logs/20260715.log" \\
        --machine-label VPS \\
        --out vps_telemetry_20260715.json

Then diff/compare the two JSON exports (e.g. by decision generation number
or by closed_m5_bar_time) for the actual side-by-side comparison the audit
called for.

Privacy: this script does NOT read account login numbers, broker server
names, or any credential -- only the decision/trace lines listed above.
Export files are not committed to this repo (same convention as
scripts/audit_v6232_active_intelligence.py and campaign_forensic_audit.py).
"""

import argparse
import json
import re
from datetime import datetime
from pathlib import Path


# One regex per log-line family this script understands, matching the
# EXACT PrintFormat text in backend/ea_code/XAUUSD_AI_Sniper_EA.mq5.
# Keeping these as named groups makes each parsed record self-describing.
PATTERNS = {
    "decision_snapshot": re.compile(
        r"DECISION_SNAPSHOT \| symbol=(?P<symbol>\S+) generation=(?P<generation>\d+) "
        r"bar=(?P<bar>[\d.: ]+) signal=(?P<signal>\S+) bias=(?P<bias>\S+) "
        r"structure=(?P<structure>[^|]+?) setup=(?P<setup>\S+) setupScore=(?P<setup_score>[-\d.]+) "
        r"score=(?P<score>[-\d.]+) grade=(?P<grade>\S+) aiStatus=(?P<ai_status>\S+) horizon=(?P<horizon>\S+)"
    ),
    "market_thesis": re.compile(
        r"MARKET_THESIS \| direction=(?P<direction>\S+) location=(?P<location>\S+) "
        r"exhaustion=(?P<exhaustion>\S+) timing=(?P<timing>\S+) HTF=(?P<htf>\S+) "
        r"structure=(?P<structure>\S+) action=(?P<action>\S+) reason=(?P<reason>.*)"
    ),
    "structural_sl_trace": re.compile(
        r"STRUCTURAL_SL_TRACE \| signal=(?P<signal>\S+) horizon=(?P<horizon>\S+) "
        r"slSource=(?P<sl_source>\S+) rawLevel=(?P<raw_level>[-\d.]+) buffer=(?P<buffer>[-\d.]+) "
        r"finalSL=(?P<final_sl>[-\d.]+) slDist=(?P<sl_dist>[-\d.]+) applied=(?P<applied>\S+)"
    ),
    "risk_margin_trace": re.compile(
        r"RISK_MARGIN_TRACE \| horizon=(?P<horizon>\S+) slSource=(?P<sl_source>\S+) "
        r"balance=\$(?P<balance>[-\d.]+) equity=\$(?P<equity>[-\d.]+) riskPct=(?P<risk_pct>[-\d.]+)% "
        r"riskUSD=\$(?P<risk_usd>[-\d.]+) slDist=(?P<sl_dist>[-\d.]+) "
        r"moneyLossPerLotAtSL=\$(?P<money_per_lot>[-\d.]+) rawLot=(?P<raw_lot>[-\d.]+) "
        r"normalizedLot=(?P<normalized_lot>[-\d.]+) requiredMargin=\$(?P<required_margin>[-\d.]+) "
        r"freeMargin=\$(?P<free_margin>[-\d.]+) marginReserve=\$(?P<margin_reserve>[-\d.]+)"
        r"\((?P<margin_reserve_pct>[-\d.]+)%\) finalLot=(?P<final_lot>[-\d.]+) "
        r"actualRiskPct=(?P<actual_risk_pct>[-\d.]+)% decision=(?P<decision>\S+)"
    ),
    "campaign_opened": re.compile(
        r"CAMPAIGN_OPENED \| (?P<campaign_id>\S+) dir=(?P<direction>\S+) setup=(?P<setup>\S+) "
        r"horizon=(?P<horizon>\S+) invalidation=(?P<invalidation>[-\d.]+) dest1=(?P<dest1>[-\d.]+) "
        r"destPrimary=(?P<dest_primary>[-\d.]+) destRunner=(?P<dest_runner>[-\d.]+)"
    ),
    "campaign_add_registered": re.compile(
        r"CAMPAIGN_ADD_REGISTERED \| (?P<campaign_id>\S+) dir=(?P<direction>\S+) "
        r"additionCount=(?P<addition_count>\d+) activePositions=(?P<active_positions>\d+)"
    ),
    "campaign_closed": re.compile(
        r"CAMPAIGN_CLOSED \| (?P<campaign_id>\S+) dir=(?P<direction>\S+) "
        r"finalRealizedPL=(?P<final_realized_pl>[-\d.]+) additions=(?P<additions>\d+) "
        r"peakFloating=(?P<peak_floating>[-\d.]+) MFE=(?P<mfe>[-\d.]+) MAE=(?P<mae>[-\d.]+) "
        r"givenBack=(?P<given_back>[-\d.]+)"
    ),
    "campaign_invalidated": re.compile(
        r"CAMPAIGN_INVALIDATED \| (?P<campaign_id>\S+) dir=(?P<direction>\S+) reason=(?P<reason>.*)"
    ),
    "pyramid_blocked_exhaustion": re.compile(
        r"PYRAMID_BLOCKED_CAMPAIGN_EXHAUSTION: dir=(?P<direction>\S+) lifecycle=(?P<lifecycle>\S+) "
        r"action=(?P<action>\S+) exhaustion=(?P<exhaustion>[-\d.]+)% "
        r"remainingRewardR=(?P<remaining_reward_r>[-\d.]+) oppositeRemainingRewardR=(?P<opposite_remaining_reward_r>[-\d.]+)"
    ),
    "reentry_blocked_after_sl": re.compile(r"REENTRY_BLOCKED_AFTER_SL(?P<rest>.*)"),
    "news_cooldown_complete": re.compile(r"NEWS_COOLDOWN_COMPLETE(?P<rest>.*)"),
}

# Only the leading MT5 timestamp is extracted here (e.g.
# "2026.07.15 18:25:17.449"). Everything between the timestamp and the
# actual PrintFormat message (an EA-name/symbol/period source tag in real
# MT5 journals) varies and isn't needed -- each PATTERNS entry anchors on
# its own distinctive marker text (e.g. "DECISION_SNAPSHOT |") and is
# searched against the FULL remaining line, not a hand-stripped "message",
# so nothing about that variable middle section can eat real content.
LOG_LINE_TIMESTAMP = re.compile(r"^(?P<ts>\d{4}\.\d{2}\.\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3})")


def parse_journal(log_path: Path) -> list:
    records = []
    with log_path.open("r", encoding="utf-16", errors="replace") as handle:
        raw_lines = handle.readlines()
    if len(raw_lines) <= 1:
        # not actually UTF-16 (or empty) -- retry as UTF-8/latin-1
        with log_path.open("r", encoding="utf-8", errors="replace") as handle:
            raw_lines = handle.readlines()

    for line in raw_lines:
        line = line.rstrip("\n").rstrip("\r").strip("\x00")
        if not line:
            continue
        ts_match = LOG_LINE_TIMESTAMP.match(line)
        ts_text = ts_match.group("ts") if ts_match else None

        for record_type, pattern in PATTERNS.items():
            m = pattern.search(line)
            if m:
                record = {"record_type": record_type, "local_terminal_time": ts_text}
                record.update(m.groupdict())
                records.append(record)
                break  # one record type per line

    return records


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--log", type=Path, required=True, help="MT5 terminal journal .log file")
    parser.add_argument("--machine-label", required=True, choices=["MAC", "VPS"],
                        help="which machine this journal came from, for the side-by-side comparison")
    parser.add_argument("--out", type=Path, required=True, help="output JSON export path")
    args = parser.parse_args()

    if not args.log.exists():
        raise SystemExit(f"log file not found: {args.log}")

    records = parse_journal(args.log)
    by_type = {}
    for r in records:
        by_type.setdefault(r["record_type"], []).append(r)

    export = {
        "machine_label": args.machine_label,
        "source_log": str(args.log),
        "exported_at": datetime.utcnow().isoformat() + "Z",
        "record_counts": {k: len(v) for k, v in by_type.items()},
        "records_by_type": by_type,
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(export, indent=2), encoding="utf-8")
    total = sum(len(v) for v in by_type.values())
    print(f"[{args.machine_label}] parsed {total} telemetry records "
          f"({', '.join(f'{k}={len(v)}' for k, v in sorted(by_type.items()))}) -> {args.out}")


if __name__ == "__main__":
    main()
