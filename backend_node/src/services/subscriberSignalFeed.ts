import { getDb } from "../db.js";
import { getSettings } from "./settings.js";
import { sendSubscriberSignalNotification } from "./notifications.js";

const HEARTBEAT_STALE_SECONDS = 90;

export type SubscriberSignalStatus = "WATCHING" | "ACTIONABLE" | "BLOCKED" | "EXPIRED";
export type SubscriberSignalEngine = "OUTLOOK" | "M10_ENGINE";

export interface SubscriberSignalInput {
  signal_id: string;
  engine: SubscriberSignalEngine;
  symbol: string;
  direction: string;
  status: SubscriberSignalStatus;
  confidence: number | null;
  entry: number | null;
  stop: number | null;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  rationale: string | null;
  effective_at: string;
  expires_at: string | null;
  /** True only for a genuinely NEW actionable BUY/SELL -- gates the (rate-limited-by-nature) notification fan-out. A WATCHING/BLOCKED state update never notifies. */
  isNewActionable: boolean;
}

async function configuredSourceAccounts(): Promise<{ primary: string; backup: string }> {
  const settings = await getSettings();
  return {
    primary: String(settings["subscriber_signal_source_account"] ?? "").trim(),
    backup: String(settings["subscriber_signal_backup_source_account"] ?? "").trim(),
  };
}

/**
 * True only for the account(s) an admin has explicitly designated as the
 * subscriber-signal source. Every other account's Outlook/M10 generation
 * (i.e. every licensed bot customer) is completely unaffected -- this
 * function is the ONLY gate that decides whether anything gets mirrored.
 */
export async function isConfiguredSubscriberSource(account: string): Promise<boolean> {
  if (!account) return false;
  const { primary, backup } = await configuredSourceAccounts();
  return account === primary || (Boolean(backup) && account === backup);
}

/**
 * Sanitized copy-on-write mirror for the read-only subscriber signal feed.
 * NOT a second Outlook engine: the real signal was already computed by the
 * existing production Outlook/M10 pipeline for the configured source
 * account; this only stores a customer-safe snapshot of it and, for a
 * genuinely new actionable signal, notifies entitled trial/subscription
 * users. Never called for, and never affects, any other account's
 * generation or execution.
 */
export async function mirrorSubscriberSignal(account: string, input: SubscriberSignalInput): Promise<void> {
  if (!(await isConfiguredSubscriberSource(account))) return;

  const db = getDb();
  const nowIso = new Date().toISOString();
  const doc = {
    signal_id: input.signal_id,
    engine: input.engine,
    symbol: input.symbol,
    direction: input.direction,
    status: input.status,
    confidence: input.confidence,
    entry: input.entry,
    stop: input.stop,
    tp1: input.tp1,
    tp2: input.tp2,
    tp3: input.tp3,
    rationale: input.rationale,
    effective_at: input.effective_at,
    expires_at: input.expires_at,
    source: "subscriber_feed",
    updated_at: nowIso,
  };
  await db.collection("subscriber_signals").updateOne(
    { signal_id: input.signal_id, engine: input.engine },
    { $set: doc, $setOnInsert: { created_at: nowIso } },
    { upsert: true },
  );

  if (input.isNewActionable) {
    await sendSubscriberSignalNotification(doc);
  }
}

/** Shared mapper: a full cloud_market_outlooks-shaped doc (hourly Outlook OR the M10 actionable-publication doc, both produced by generateOutlookForAccount) into the sanitized subscriber shape. */
export function outlookDocAsSubscriberSignal(doc: Record<string, unknown>, engine: SubscriberSignalEngine, isNewActionable: boolean): SubscriberSignalInput {
  const direction = String(doc["primary_direction"] ?? "");
  return {
    signal_id: String(doc["id"] ?? ""),
    engine,
    symbol: String(doc["symbol"] ?? "XAUUSD"),
    direction,
    status: direction === "BLOCKED" ? "BLOCKED" : ["BUY", "SELL"].includes(direction) ? "ACTIONABLE" : "WATCHING",
    confidence: typeof doc["confidence_pct"] === "number" ? (doc["confidence_pct"] as number) : null,
    entry: typeof doc["tracking_entry_price"] === "number" ? (doc["tracking_entry_price"] as number) : null,
    stop: typeof doc["suggested_sl"] === "number" ? (doc["suggested_sl"] as number) : null,
    tp1: typeof doc["tp1_price"] === "number" ? (doc["tp1_price"] as number) : null,
    tp2: typeof doc["tp2_price"] === "number" ? (doc["tp2_price"] as number) : null,
    tp3: typeof doc["tp3_price"] === "number" ? (doc["tp3_price"] as number) : null,
    rationale: null,
    effective_at: String(doc["published_at"] ?? doc["generated_at"] ?? new Date().toISOString()),
    expires_at: typeof doc["expiry_at"] === "string" ? (doc["expiry_at"] as string) : null,
    isNewActionable,
  };
}

/** Maps a cloud_outlook_signal_events row (the M10 lifecycle event, before it necessarily becomes an actionable publication) into the sanitized subscriber shape -- used to keep the subscriber "10-minute engine" view current even for WATCHING/BLOCKED states that never produce a notification. */
export function m10EventAsSubscriberSignal(eventDoc: Record<string, unknown>): SubscriberSignalInput {
  const eventType = String(eventDoc["event_type"] ?? "");
  const status: SubscriberSignalStatus = eventType === "ACTIONABLE_SIGNAL" ? "ACTIONABLE" : eventType === "BLOCKED" ? "BLOCKED" : eventType === "EXPIRED" ? "EXPIRED" : "WATCHING";
  return {
    signal_id: String(eventDoc["candidate_id"] ?? ""),
    engine: "M10_ENGINE",
    symbol: String(eventDoc["symbol"] ?? "XAUUSD"),
    direction: String(eventDoc["direction"] ?? ""),
    status,
    confidence: typeof eventDoc["confidence"] === "number" ? (eventDoc["confidence"] as number) : null,
    entry: null,
    stop: null,
    tp1: null,
    tp2: null,
    tp3: null,
    rationale: null,
    effective_at: String(eventDoc["event_time"] ?? new Date().toISOString()),
    expires_at: null,
    isNewActionable: false,
  };
}

export interface SubscriberSourceHealth {
  configured: boolean;
  account: string | null;
  online: boolean;
  last_heartbeat_at: string | null;
}

/**
 * Reuses the same heartbeat-staleness pattern notifications.ts already uses
 * for licensed-bot delivery gating (cloud_bot_heartbeats, 90s threshold).
 * Never fabricates a signal when the source is offline -- callers must show
 * "temporarily unavailable" and stop, not synthesize a fallback signal.
 */
export async function subscriberSourceHealth(): Promise<SubscriberSourceHealth> {
  const { primary, backup } = await configuredSourceAccounts();
  if (!primary) return { configured: false, account: null, online: false, last_heartbeat_at: null };

  const db = getDb();
  const check = async (account: string) => {
    const hb = await db.collection("cloud_bot_heartbeats").findOne({ account_number: account }, { projection: { _id: 0, ts: 1 }, sort: { ts: -1 } });
    const ts = hb?.["ts"];
    const hbTime = typeof ts === "string" ? new Date(ts) : null;
    const ageSec = hbTime && !Number.isNaN(hbTime.getTime()) ? (Date.now() - hbTime.getTime()) / 1000 : null;
    return { online: ageSec !== null && ageSec <= HEARTBEAT_STALE_SECONDS, ts: typeof ts === "string" ? ts : null };
  };

  const primaryHealth = await check(primary);
  if (primaryHealth.online) return { configured: true, account: primary, online: true, last_heartbeat_at: primaryHealth.ts };
  if (backup) {
    const backupHealth = await check(backup);
    if (backupHealth.online) return { configured: true, account: backup, online: true, last_heartbeat_at: backupHealth.ts };
  }
  return { configured: true, account: primary, online: false, last_heartbeat_at: primaryHealth.ts };
}
