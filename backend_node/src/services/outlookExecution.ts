import { randomUUID } from "node:crypto";
import { MongoServerError } from "mongodb";
import { getDb } from "../db.js";
import { clampGoldStopToMaxDistance } from "./marketOutlookCore.js";

/**
 * Port of backend/outlook_execution.py -- Phase 2 integration layer that
 * turns a genuine, fresh, owner-policy-approved Market Outlook signal into
 * an EA execution candidate. Deliberately separate from the Market Outlook
 * engine itself (STRICT SEPARATION -- that engine never touches
 * cloud_bot_commands). Reuses the exact same command channel/idempotency
 * machinery as every other remote command (MANUAL_OPEN_NOW etc).
 */
export async function enqueueIfActionable(doc: Record<string, unknown> | null): Promise<string | null> {
  if (!doc) return null;
  const account = String(doc["account"] ?? "");
  const direction = String(doc["primary_direction"] ?? "").toUpperCase();
  const signalId = String(doc["id"] ?? "");
  if (!account || !["BUY", "SELL"].includes(direction) || !signalId) return null;

  // Authoritative Outlook stop-loss + reference entry travel WITH the command
  // so the EA fires this exact signal's stop after the shared entry delay
  // (owner directive 2026-08-08 — items 2 & 3). The EA still recalculates lot
  // size from the ACTUAL execution price → this SL, and skips if the SL is no
  // longer valid at fire time. sl is the signal's suggested/invalidation stop.
  const requestedOutlookSl = Number(doc["suggested_sl"] ?? doc["invalidation_price"] ?? doc["final_structural_sl"] ?? 0) || 0;
  const entryLow = Number(doc["preferred_entry_zone_low"] ?? 0) || 0;
  const entryHigh = Number(doc["preferred_entry_zone_high"] ?? 0) || 0;
  const entryRef = entryLow > 0 && entryHigh > 0 ? Math.round(((entryLow + entryHigh) / 2) * 100) / 100 : 0;
  const outlookSl = clampGoldStopToMaxDistance(entryRef, requestedOutlookSl, direction === "BUY" ? 1 : -1);
  const chaseLimit = Number(doc["chase_limit"] ?? 0) || 0;
  if (!outlookSl) return null;

  const db = getDb();
  const commandId = randomUUID();
  const dedupeKey = `${account}:OUTLOOK_SIGNAL_OPEN:${signalId}`;
  const nowIso = new Date().toISOString();
  const commandDoc = {
    id: commandId,
    user_id: null,
    user_email: "SYSTEM_MARKET_OUTLOOK",
    license_key: String(doc["license_key"] ?? ""),
    mt5_account: account,
    action: "OUTLOOK_SIGNAL_OPEN",
    label: "Market Outlook signal execution (owner-approved, automatic)",
    status: "PENDING",
    requested_at: nowIso,
    payload: {
      direction,
      signal_id: signalId,
      sl: outlookSl,
      entry_ref: entryRef,
      chase_limit: chaseLimit,
      generated_at: String(doc["generated_at"] ?? nowIso),
    },
    ack_at: "",
    ack_status: "",
    ack_message: "",
    ack_details: {},
    dedupe_key: dedupeKey,
    source: "MARKET_OUTLOOK",
    outlook_signal_id: signalId,
  };

  try {
    await db.collection("cloud_bot_commands").insertOne({ ...commandDoc });
    return commandId;
  } catch (err) {
    if (err instanceof MongoServerError && err.code === 11000) {
      const existing = await db.collection("cloud_bot_commands").findOne({ dedupe_key: dedupeKey }, { projection: { _id: 0 } });
      return (existing?.["id"] as string | undefined) ?? null;
    }
    throw err;
  }
}
