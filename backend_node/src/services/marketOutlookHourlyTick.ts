import { getDb } from "../db.js";
import { OUTLOOK_SYMBOL } from "./marketOutlookCore.js";
import { generateOutlookForAccount } from "./marketOutlookSignal.js";
import { dispatchSignalEvent } from "./marketOutlookPublish.js";
import { mirrorSubscriberSignal, outlookDocAsSubscriberSignal } from "./subscriberSignalFeed.js";

/** Port of market_outlook.py:2847 `_dispatch_hourly_notification`. */
async function dispatchHourlyNotification(doc: Record<string, unknown>): Promise<void> {
  if (["BUY", "SELL"].includes(String(doc["primary_direction"])) && doc["tracking_entry_price"]) {
    await dispatchSignalEvent(doc, "TRACKING_STARTED");
  }
}

function hourlySlotFor(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}T${String(date.getUTCHours()).padStart(2, "0")}:00`;
}

function parseHourlySlot(slot: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):00$/.exec(slot);
  if (!m) return null;
  const [, y, mo, d, h] = m;
  return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h)));
}

/**
 * Port of market_outlook.py:1794 `hourly_generation_tick` -- generates at
 * most one NEW outlook per (account, symbol, UTC hourly slot) that has
 * posted EA evidence recently. Returns [publishedCount, actionableDocs].
 */
export async function hourlyGenerationTick(account = ""): Promise<[number, Record<string, unknown>[]]> {
  const db = getDb();
  const now = new Date();
  const currentSlot = hourlySlotFor(now);
  const cutoff = new Date(now.getTime() - 2 * 3600_000).toISOString();

  const accounts: string[] = account ? [account] : await db.collection("cloud_bot_activity").distinct("account", { ts: { $gte: cutoff } });
  let published = 0;
  const actionableDocs: Record<string, unknown>[] = [];

  for (const acct of accounts) {
    if (!acct) continue;
    const outlooks = db.collection("cloud_market_outlooks");
    const existingSlot = await outlooks.findOne({ account: acct, symbol: OUTLOOK_SYMBOL, hourly_slot: currentSlot }, { projection: { _id: 0, id: 1 } });
    if (existingSlot) continue;

    const lastDoc = await outlooks.findOne({ account: acct, symbol: OUTLOOK_SYMBOL }, { projection: { _id: 0, hourly_slot: 1 }, sort: { generated_at: -1 } });
    let isLateCatchup = false;
    const lastSlot = lastDoc?.["hourly_slot"] as string | undefined;
    if (lastSlot && lastSlot !== currentSlot) {
      const lastSlotDt = parseHourlySlot(lastSlot);
      const currentSlotDt = parseHourlySlot(currentSlot);
      if (lastSlotDt && currentSlotDt) {
        isLateCatchup = currentSlotDt.getTime() - lastSlotDt.getTime() > (3600 + 5 * 60) * 1000;
      }
    }

    let licKey = "";
    const row = await db.collection("cloud_bot_activity").findOne({ account: acct }, { projection: { _id: 0, details: 1 }, sort: { ts: -1 } });
    if (row) licKey = String((row["details"] as Record<string, unknown> | undefined)?.["license_key"] ?? "");

    try {
      const doc = await generateOutlookForAccount({ license_key: licKey, account: acct, account_id: acct, is_late_catchup: isLateCatchup });
      if (doc) {
        const newlyInserted = doc["_newly_inserted"] ?? true;
        delete doc["_newly_inserted"];
        if (newlyInserted) {
          published += 1;
          await dispatchHourlyNotification(doc);
        }
        const isNewActionable = newlyInserted && ["BUY", "SELL"].includes(String(doc["primary_direction"]));
        if (isNewActionable) {
          actionableDocs.push(doc);
        }
        // Subscriber-feed mirror: a no-op for every account except the one
        // an admin has explicitly configured as the signal source. Never
        // affects this account's own generation/notification/execution.
        await mirrorSubscriberSignal(acct, outlookDocAsSubscriberSignal(doc, "OUTLOOK", isNewActionable)).catch(() => {});
      }
    } catch {
      /* logged-and-continue in Python, matches per-account isolation */
    }
  }

  return [published, actionableDocs];
}
