"""v6.25.3 owner directive 2026-07-17 (Phase 5 P0, final pre-launch hardening)
-- DELETE RETIRED CLOUD COPY-TRADING.

The product is now "licensed local EA + remote monitor/control" -- NOT a
master/slave copy-trading service. This migration is the one-time,
auditable, backup-then-delete step for the copy-trading data that the
retired backend/server.py routes (removed in this same change) used to
read/write. It does NOT touch anything used by the kept local-EA monitor
product (pin_licenses, cloud_bot_heartbeats, cloud_bot_activity,
cloud_direction_reservations, cloud_bot_commands, trading_universe_settings,
cloud_push_subscriptions, cloud_notification_log, cloud_market_outlooks*).

SAFETY MODEL:
  - DRY RUN BY DEFAULT. Nothing is deleted unless you pass --confirm.
  - Always backs up before deleting, in the same run, in the same order
    (backup completes and is verified written to disk before any delete
    call executes).
  - Idempotent: safe to re-run -- collections/fields that are already gone
    are silently skipped, not errored on.
  - This script targets whatever MONGO_URL/DB_NAME are in the environment
    when it's run. Point it at production explicitly; it will NOT guess or
    default to a "safe-looking" database name.

USAGE:
  # 1. Dry run (always do this first) -- reports exactly what WOULD happen,
  #    changes nothing:
  MONGO_URL="mongodb://..." DB_NAME="..." python3 backend/migrations/0001_delete_copy_trading.py

  # 2. Real run, after reviewing the dry-run output:
  MONGO_URL="mongodb://..." DB_NAME="..." python3 backend/migrations/0001_delete_copy_trading.py --confirm

Backup is written to backend/migrations/backups/copy_trading_backup_<UTC timestamp>.json
next to this script, as a single JSON document per collection (array of
its documents) plus the specific fields stripped from cloud_users and
cloud_settings (backed up as their own entries, not deleted from the
document wholesale -- those two collections are KEPT, only specific
copy-trading fields are unset from them).
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
BACKUP_DIR = MIGRATION_DIR / "backups"

# Collections used ONLY by copy-trading -- dropped entirely.
COPY_TRADING_COLLECTIONS = [
    "cloud_shadow_trades",
    "cloud_signals",
    "cloud_signal_partials",
    "cloud_trades",
    "cloud_trade_partials",
    "cloud_fanout_logs",
    "cloud_workers",
    "cloud_pair_codes",
    "cloud_force_close_queue",
    "cloud_broker_logs",
    "cloud_equity_snapshots",
    "cloud_account_status_logs",
    "cloud_payments",
    "cloud_reasoning",
]

# Fields stripped from cloud_users -- the collection itself is KEPT (it's
# the shared Command Center account system: email/password_hash/full_name/
# license_key/command_license_key/license_linked_at all stay).
CLOUD_USERS_COPY_TRADING_FIELDS = [
    "mt5_login", "mt5_password_enc", "mt5_connected",
    "mt5_verification_status", "mt5_verification_error", "mt5_verification_at",
    "mt5_credentials_at", "broker_server", "broker_name", "broker_platform",
    "broker_support_status", "broker_last_health", "broker_last_check_at",
    "broker_last_check_result", "broker_detected_name", "broker_detected_platform",
    "broker_symbol_suffix", "risk_tier", "assigned_worker_id", "paused",
    "plan", "status", "subscription_ends_at", "trial_used", "custom_price_usd",
    "last_balance", "last_equity", "last_balance_updated_at", "last_equity_ts",
    "account_currency", "force_equity_refresh", "last_refresh_request_at",
    "copy_status", "copy_logged_in", "copy_algo_ok", "copy_retry_count",
    "copy_next_retry_at", "copy_last_success_at", "copy_last_error",
    "copy_last_status_at", "copy_worker_id", "cloud_positions_count",
    "cloud_positions_ts",
]

# Fields stripped from the cloud_settings singleton (key="main") -- the
# document itself is KEPT (monitor_last_heartbeat/monitor_last_status/
# monitor_last_activity* are read/written by kept monitor routes).
CLOUD_SETTINGS_COPY_TRADING_FIELDS = [
    "crypto_wallets", "bank_accounts", "fiat_paystack_enabled", "plans",
    "fx_rates", "shadow_mode", "agent_token", "master_ea_status",
    "master_last_heartbeat", "bot_mode", "bot_mode_set_at",
    "telegram_alerts_enabled",
]


class _JSONEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, ObjectId):
            return str(o)
        if isinstance(o, datetime):
            return o.isoformat()
        return super().default(o)


async def _backup_collection(db, name: str) -> list:
    docs = await db[name].find({}).to_list(length=None)
    return docs


async def run(confirm: bool) -> None:
    mongo_url = os.environ["MONGO_URL"]
    db_name = os.environ["DB_NAME"]
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    print(f"{'CONFIRMED DELETE RUN' if confirm else 'DRY RUN (nothing will be changed)'} "
          f"-- target database: {db_name}")
    print("=" * 78)

    backup_payload = {"generated_at": datetime.now(timezone.utc).isoformat(),
                       "db_name": db_name, "collections": {}, "cloud_users_fields": [],
                       "cloud_settings_fields": {}}

    # ---- 1. Backup every pure copy-trading collection ----
    total_docs_to_delete = 0
    for coll_name in COPY_TRADING_COLLECTIONS:
        docs = await _backup_collection(db, coll_name)
        backup_payload["collections"][coll_name] = docs
        total_docs_to_delete += len(docs)
        print(f"  collection {coll_name:30s} {len(docs):6d} document(s)" + (" (will DROP)" if docs or confirm else " (already empty/absent)"))

    # ---- 2. Backup the copy-trading fields on cloud_users (per-user) ----
    users_with_copy_fields = await db.cloud_users.find(
        {"$or": [{f: {"$exists": True}} for f in CLOUD_USERS_COPY_TRADING_FIELDS]},
        {"_id": 1, "email": 1, **{f: 1 for f in CLOUD_USERS_COPY_TRADING_FIELDS}},
    ).to_list(length=None)
    backup_payload["cloud_users_fields"] = users_with_copy_fields
    print(f"  cloud_users documents carrying copy-trading fields: {len(users_with_copy_fields)}")
    # mt5_password_enc is real encrypted credential material -- flag it
    # explicitly in the console output so a human reviewing this run sees
    # the sensitive-data count, not just a generic number.
    with_password = sum(1 for u in users_with_copy_fields if u.get("mt5_password_enc"))
    if with_password:
        print(f"    -- includes {with_password} document(s) with an encrypted mt5_password_enc value")

    # ---- 3. Backup the copy-trading fields on cloud_settings (singleton) ----
    settings_doc = await db.cloud_settings.find_one({"key": "main"})
    if settings_doc:
        stripped = {f: settings_doc[f] for f in CLOUD_SETTINGS_COPY_TRADING_FIELDS if f in settings_doc}
        backup_payload["cloud_settings_fields"] = stripped
        print(f"  cloud_settings copy-trading fields present: {list(stripped.keys())}")

    # ---- 4. Write the backup to disk BEFORE any deletion happens ----
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_path = BACKUP_DIR / f"copy_trading_backup_{ts}.json"
    backup_path.write_text(json.dumps(backup_payload, cls=_JSONEncoder, indent=2), encoding="utf-8")
    print(f"\nBackup written: {backup_path} ({backup_path.stat().st_size} bytes)")

    if not confirm:
        print("\nDry run complete -- no data was changed. Re-run with --confirm to actually delete.")
        client.close()
        return

    # ---- 5. Real deletion, only reached with --confirm ----
    print("\nProceeding with deletion (backup verified written above)...")
    for coll_name in COPY_TRADING_COLLECTIONS:
        result = await db[coll_name].delete_many({})
        print(f"  dropped {coll_name}: {result.deleted_count} document(s) removed")

    if users_with_copy_fields:
        unset_fields = {f: "" for f in CLOUD_USERS_COPY_TRADING_FIELDS}
        result = await db.cloud_users.update_many({}, {"$unset": unset_fields})
        print(f"  stripped copy-trading fields from cloud_users: {result.modified_count} document(s) modified")

    if settings_doc and backup_payload["cloud_settings_fields"]:
        unset_fields = {f: "" for f in CLOUD_SETTINGS_COPY_TRADING_FIELDS}
        await db.cloud_settings.update_one({"key": "main"}, {"$unset": unset_fields})
        print("  stripped copy-trading fields from cloud_settings")

    print(f"\nDone. {total_docs_to_delete} copy-trading document(s) backed up and removed. "
          f"Backup: {backup_path}")
    client.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--confirm", action="store_true",
                         help="Actually delete. Without this flag, only a dry-run report + backup is produced.")
    args = parser.parse_args()
    if "MONGO_URL" not in os.environ or "DB_NAME" not in os.environ:
        print("MONGO_URL and DB_NAME must be set in the environment -- refusing to guess a target database.",
              file=sys.stderr)
        sys.exit(1)
    asyncio.run(run(confirm=args.confirm))
