"""R-to-pips/Gold-moves migration (owner directive, 2026-08-05) -- ADD
result_pips/result_gold_moves/mfe_pips/mae_pips fields to trade_journal and
cloud_market_outlooks documents, non-destructively.

Every existing R-denominated record (final_r/mae_r/mfe_r on trade_journal,
analytics_r/mfe_r/mae_r on cloud_market_outlooks) keeps its R fields exactly
as they are -- this migration only ADDS the pips/Gold-move equivalents
alongside them, using the same real-price-based
market_outlook.build_result_conversion() every other part of the codebase
already uses (never a blind x100 multiply against a fixed unit -- risk
distance is derived per-document from that document's own real prices/R,
exactly as the live EA/backend code does at read time).

trade_journal: risk_distance is derived per-record as
  abs(entry_price - price) / final_r   (solved from final_r = price_move/risk_distance)
using that record's own real entry_price/price (close) and final_r --
never a fixed/assumed distance. Records missing entry_price, price, or a
non-zero final_r (pre-v6.25.3 EA installs, which never sent this rich
ledger data at all) are left untouched -- there is no real price data to
derive a genuine risk_distance from, and inventing one would mean
fabricating numbers, which this migration (and the rest of this codebase)
deliberately refuses to do.

cloud_market_outlooks: risk_distance is already a stored field on these
documents (see market_outlook.py) -- backfill reuses it directly.

SAFETY MODEL (same as 0001_delete_copy_trading.py / 0002_add_payment_provider_field.py):
  - DRY RUN BY DEFAULT. Nothing is written unless you pass --confirm.
  - Backs up affected documents before writing, in the same run, verified
    written to disk before any update call executes.
  - Idempotent: only touches documents missing result_pips (trade_journal)
    or mfe_pips (cloud_market_outlooks) -- safe to re-run any number of
    times.
  - Purely additive: never deletes, renames, or overwrites any existing
    R field. No historical R data changes meaning.
  - Targets whatever MONGO_URL/DB_NAME are in the environment when run --
    never guesses or defaults to a "safe-looking" database name.

USAGE:
  # 1. Dry run (always do this first) -- reports exactly what WOULD change:
  MONGO_URL="mongodb://..." DB_NAME="..." python3 backend/migrations/0003_backfill_pips_gold_moves.py

  # 2. Real run, after reviewing the dry-run output:
  MONGO_URL="mongodb://..." DB_NAME="..." python3 backend/migrations/0003_backfill_pips_gold_moves.py --confirm

Backup is written to
backend/migrations/backups/pips_gold_moves_backfill_<UTC timestamp>.json
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId

MIGRATION_DIR = Path(__file__).resolve().parent
BACKEND_DIR = MIGRATION_DIR.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
BACKUP_DIR = MIGRATION_DIR / "backups"

from market_outlook import build_result_conversion  # noqa: E402


class _JSONEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, ObjectId):
            return str(o)
        if isinstance(o, datetime):
            return o.isoformat()
        return super().default(o)


def _trade_journal_conversion(doc: dict) -> dict | None:
    """Derives this record's own real risk_distance from its own real
    entry_price/price/final_r, then converts final_r/mae_r/mfe_r through
    build_result_conversion using that genuine per-trade distance. Returns
    None (skip, no fabrication) if the record doesn't have real enough data
    to derive a genuine distance."""
    entry = float(doc.get("entry_price") or 0)
    exit_price = float(doc.get("price") or 0)
    final_r = float(doc.get("final_r") or 0)
    direction = str(doc.get("direction") or "").upper()
    if entry <= 0 or exit_price <= 0 or final_r == 0 or direction not in ("BUY", "SELL"):
        return None
    price_move = (exit_price - entry) if direction == "BUY" else (entry - exit_price)
    risk_distance = price_move / final_r
    if risk_distance <= 0:
        return None
    result_conv = build_result_conversion(r=final_r, risk_distance=risk_distance)
    out = {
        "result_pips": result_conv["result_pips"],
        "result_gold_moves": result_conv["result_gold_moves"],
    }
    mae_r = doc.get("mae_r")
    if mae_r is not None:
        mae_conv = build_result_conversion(r=float(mae_r), risk_distance=risk_distance)
        out["mae_pips"] = mae_conv["result_pips"]
        out["mae_gold_moves"] = mae_conv["result_gold_moves"]
    mfe_r = doc.get("mfe_r")
    if mfe_r is not None:
        mfe_conv = build_result_conversion(r=float(mfe_r), risk_distance=risk_distance)
        out["mfe_pips"] = mfe_conv["result_pips"]
        out["mfe_gold_moves"] = mfe_conv["result_gold_moves"]
    return out


def _outlook_conversion(doc: dict) -> dict | None:
    risk_distance = doc.get("risk_distance")
    if not risk_distance:
        return None
    out = {}
    analytics_r = doc.get("analytics_r")
    if analytics_r is not None:
        conv = build_result_conversion(r=float(analytics_r), risk_distance=risk_distance)
        out["analytics_pips"] = conv["result_pips"]
        out["analytics_gold_moves"] = conv["result_gold_moves"]
    mfe_r = doc.get("mfe_r")
    if mfe_r is not None:
        conv = build_result_conversion(r=float(mfe_r), risk_distance=risk_distance)
        out["mfe_pips"] = conv["result_pips"]
        out["mfe_gold_moves"] = conv["result_gold_moves"]
    mae_r = doc.get("mae_r")
    if mae_r is not None:
        conv = build_result_conversion(r=float(mae_r), risk_distance=risk_distance)
        out["mae_pips"] = conv["result_pips"]
        out["mae_gold_moves"] = conv["result_gold_moves"]
    return out or None


async def run(confirm: bool) -> None:
    mongo_url = os.environ["MONGO_URL"]
    db_name = os.environ["DB_NAME"]
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    print(f"Target database: {db_name}")
    print(f"Mode: {'CONFIRM (will write)' if confirm else 'DRY RUN (no writes)'}")
    print()

    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_path = BACKUP_DIR / f"pips_gold_moves_backfill_{timestamp}.json"
    backup_data: dict = {"trade_journal": [], "cloud_market_outlooks": []}

    # ---- trade_journal ----
    tj_coll = db["trade_journal"]
    tj_candidates = await tj_coll.find({
        "result_pips": {"$exists": False},
        "ticket": {"$gt": 0},  # pre-v6.25.3 records have no ticket and no rich ledger data at all
    }).to_list(length=None)
    tj_updates = []
    tj_skipped_no_real_data = 0
    for doc in tj_candidates:
        conv = _trade_journal_conversion(doc)
        if conv is None:
            tj_skipped_no_real_data += 1
            continue
        tj_updates.append((doc, conv))
    backup_data["trade_journal"] = [d for d, _ in tj_updates]
    print(f"trade_journal: {len(tj_candidates)} candidate(s) missing result_pips, "
          f"{len(tj_updates)} have real enough data to backfill, "
          f"{tj_skipped_no_real_data} skipped (no real entry/exit/R data -- would be fabrication)")

    # ---- cloud_market_outlooks ----
    mo_coll = db["cloud_market_outlooks"]
    mo_candidates = await mo_coll.find({
        "mfe_pips": {"$exists": False},
        "risk_distance": {"$exists": True, "$ne": None},
        "$or": [{"analytics_r": {"$exists": True}}, {"mfe_r": {"$exists": True}}, {"mae_r": {"$exists": True}}],
    }).to_list(length=None)
    mo_updates = []
    for doc in mo_candidates:
        conv = _outlook_conversion(doc)
        if conv is None:
            continue
        mo_updates.append((doc, conv))
    backup_data["cloud_market_outlooks"] = [d for d, _ in mo_updates]
    print(f"cloud_market_outlooks: {len(mo_candidates)} candidate(s) missing mfe_pips with a stored "
          f"risk_distance, {len(mo_updates)} will be backfilled")

    total_to_update = len(tj_updates) + len(mo_updates)
    if total_to_update == 0:
        print("\nNothing to do -- every eligible document already has pips/Gold-move fields, "
              "or has no real enough data to derive them from. Migration is a no-op.")
        client.close()
        return

    with open(backup_path, "w", encoding="utf-8") as f:
        json.dump(backup_data, f, cls=_JSONEncoder, indent=2)
    assert backup_path.exists() and backup_path.stat().st_size > 0, "Backup write did not complete"
    print(f"\nBackup written and verified: {backup_path} ({backup_path.stat().st_size} bytes)")

    if not confirm:
        print("\nDRY RUN complete. Re-run with --confirm to apply the backfill.")
        client.close()
        return

    print("\nApplying backfill...")
    tj_modified = 0
    for doc, conv in tj_updates:
        result = await tj_coll.update_one({"_id": doc["_id"]}, {"$set": conv})
        tj_modified += result.modified_count
    print(f"trade_journal: modified={tj_modified}")

    mo_modified = 0
    for doc, conv in mo_updates:
        result = await mo_coll.update_one({"_id": doc["_id"]}, {"$set": conv})
        mo_modified += result.modified_count
    print(f"cloud_market_outlooks: modified={mo_modified}")

    print("\nMigration complete.")
    client.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--confirm", action="store_true", help="Actually apply the backfill (default is dry run)")
    args = parser.parse_args()
    asyncio.run(run(confirm=args.confirm))
