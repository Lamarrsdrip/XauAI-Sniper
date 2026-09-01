"""Nomba payment migration -- ADD payment_transactions/pin_licenses
"provider" field, non-destructively.

Every row created before this migration is a real Paystack payment --
this migration backfills provider="PAYSTACK" onto them so old and new
rows are queryable/reportable the same way, without touching any other
field. New rows created by application code going forward set their own
`provider` at insert time (PAYSTACK or NOMBA) and never need backfilling.

SAFETY MODEL (same as 0001_delete_copy_trading.py):
  - DRY RUN BY DEFAULT. Nothing is written unless you pass --confirm.
  - Backs up affected documents before writing, in the same run, verified
    written to disk before any update call executes.
  - Idempotent: only touches documents where `provider` is absent --
    safe to re-run any number of times, including after new NOMBA rows
    already exist (they already have `provider` set and are skipped).
  - Purely additive: never deletes, renames, or overwrites any existing
    field. No historical Paystack data changes meaning.
  - Targets whatever MONGO_URL/DB_NAME are in the environment when run --
    never guesses or defaults to a "safe-looking" database name.

USAGE:
  # 1. Dry run (always do this first) -- reports exactly what WOULD change:
  MONGO_URL="mongodb://..." DB_NAME="..." python3 backend/migrations/0002_add_payment_provider_field.py

  # 2. Real run, after reviewing the dry-run output:
  MONGO_URL="mongodb://..." DB_NAME="..." python3 backend/migrations/0002_add_payment_provider_field.py --confirm

Backup is written to
backend/migrations/backups/payment_provider_backfill_<UTC timestamp>.json
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId

MIGRATION_DIR = Path(__file__).resolve().parent
BACKUP_DIR = MIGRATION_DIR / "backups"

# Collections that get a "provider" field backfilled onto every row that
# doesn't already have one.
TARGET_COLLECTIONS = ["payment_transactions", "pin_licenses"]
BACKFILL_VALUE = "PAYSTACK"


class _JSONEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, ObjectId):
            return str(o)
        if isinstance(o, datetime):
            return o.isoformat()
        return super().default(o)


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
    backup_path = BACKUP_DIR / f"payment_provider_backfill_{timestamp}.json"
    backup_data: dict = {}
    total_to_update = 0

    for coll_name in TARGET_COLLECTIONS:
        coll = db[coll_name]
        missing_provider = await coll.find({"provider": {"$exists": False}}).to_list(length=None)
        backup_data[coll_name] = missing_provider
        count = len(missing_provider)
        total_to_update += count
        print(f"{coll_name}: {count} document(s) missing 'provider' -- would backfill provider='{BACKFILL_VALUE}'")

    if total_to_update == 0:
        print("\nNothing to do -- every document already has a 'provider' field. Migration is a no-op.")
        client.close()
        return

    # Write backup BEFORE any update, verified on disk, same order every
    # time -- matches 0001_delete_copy_trading.py's safety model even
    # though this migration is additive, not destructive.
    with open(backup_path, "w", encoding="utf-8") as f:
        json.dump(backup_data, f, cls=_JSONEncoder, indent=2)
    assert backup_path.exists() and backup_path.stat().st_size > 0, "Backup write did not complete"
    print(f"\nBackup written and verified: {backup_path} ({backup_path.stat().st_size} bytes)")

    if not confirm:
        print("\nDRY RUN complete. Re-run with --confirm to apply the backfill.")
        client.close()
        return

    print("\nApplying backfill...")
    for coll_name in TARGET_COLLECTIONS:
        coll = db[coll_name]
        result = await coll.update_many(
            {"provider": {"$exists": False}},
            {"$set": {"provider": BACKFILL_VALUE}},
        )
        print(f"{coll_name}: matched={result.matched_count} modified={result.modified_count}")

    print("\nMigration complete.")
    client.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--confirm", action="store_true", help="Actually apply the backfill (default is dry run)")
    args = parser.parse_args()
    asyncio.run(run(confirm=args.confirm))
