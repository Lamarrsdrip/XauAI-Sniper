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
  /**
   * Customer-facing M10 evidence panel fields (2026-08-25 dashboard-unification
   * fix) -- optional because OUTLOOK-engine mirrors and the older
   * candidate-only M10 event mirror don't populate them. Sourced only from
   * the EA's own m10_signal payload, already sanitized (no account/license/
   * broker fields ever read from it here).
   */
  buy_evidence?: number | null;
  sell_evidence?: number | null;
  /** Raw EA decision enum (e.g. WAIT_FOR_BUY_RETRACE) -- lets the UI reuse the same fine-grained M10_DECISION_LABELS map bot owners see, not just the coarse WATCHING/ACTIONABLE/BLOCKED/EXPIRED status bucket. */
  decision?: string | null;
  freshness_state?: string | null;
  trend_state?: string | null;
  structure_state?: string | null;
  location_state?: string | null;
  exhaustion_decision?: string | null;
  reason?: string | null;
  evidence_id?: number | string | null;
  bar_time?: string | null;
  /** Outlook-only customer-safe fields, mirroring cloud_market_outlooks -- lets the subscriber Outlook card reuse the exact bot-owner AIMarketOutlookCard shape instead of a stripped-down summary. */
  confidence_category?: string | null;
  automated_entry_approved?: boolean | null;
  entry_zone_low?: number | null;
  entry_zone_high?: number | null;
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
    buy_evidence: input.buy_evidence ?? null,
    sell_evidence: input.sell_evidence ?? null,
    decision: input.decision ?? null,
    freshness_state: input.freshness_state ?? null,
    trend_state: input.trend_state ?? null,
    structure_state: input.structure_state ?? null,
    location_state: input.location_state ?? null,
    exhaustion_decision: input.exhaustion_decision ?? null,
    reason: input.reason ?? null,
    evidence_id: input.evidence_id ?? null,
    bar_time: input.bar_time ?? null,
    confidence_category: input.confidence_category ?? null,
    automated_entry_approved: input.automated_entry_approved ?? null,
    entry_zone_low: input.entry_zone_low ?? null,
    entry_zone_high: input.entry_zone_high ?? null,
    last_evaluated_at: nowIso,
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

/**
 * Continuous M10-evaluation mirror (2026-08-25 dashboard-unification fix).
 *
 * Root cause this exists to fix: the EA re-evaluates and re-stamps its M10
 * snapshot (g_m10Snapshot, with its own age_seconds) on every heartbeat --
 * that's why the bot-owner dashboard's M10 card is always fresh. But
 * mirrorSubscriberSignal() above is only ever called for a genuine candidate
 * (BUY_CANDIDATE/SELL_CANDIDATE/ALLOW_CORE -- see marketOutlookPublish.ts and
 * its caller in routes/cloud/activity.ts), so a subscriber's copy of the
 * M10_ENGINE doc previously went untouched for however long the engine
 * stayed in WATCHING/no-candidate, showing a misleadingly stale "Updated Xh
 * ago" even though the engine was actively scanning the whole time.
 *
 * This is called unconditionally on every heartbeat that carries a
 * m10_signal payload from the configured subscriber source account (see
 * routes/cloud/activity.ts). It never creates notification noise (never
 * calls sendSubscriberSignalNotification) and never duplicates "Recent
 * Signals" rows for a routine re-evaluation that didn't actually change
 * anything: when the current state (status+direction) matches the existing
 * latest M10_ENGINE doc, it only refreshes that same doc's evidence fields
 * and last_evaluated_at/updated_at (created_at, i.e. "last state change,"
 * stays untouched). Only a genuine status/direction change creates a new
 * doc -- exactly the "last evaluated" vs "last state change" distinction
 * the dashboard needs, and exactly why Recent Signals doesn't flood with
 * near-identical WATCHING rows every few seconds.
 */
function m10StatusFromDecision(decision: string): SubscriberSignalStatus {
  return ["BUY_CANDIDATE", "SELL_CANDIDATE", "ALLOW_CORE"].includes(decision)
    ? "ACTIONABLE"
    : decision.startsWith("BLOCK") ? "BLOCKED"
    : decision === "EXPIRED" || decision === "STALE" ? "EXPIRED"
    : "WATCHING";
}

/**
 * Shared evidence extractor -- used by BOTH the continuous per-heartbeat
 * evaluation mirror below AND the candidate/notification-gated path
 * (m10EventAsSubscriberSignal, when handed the raw m10_signal payload). Both
 * paths write to the same "current M10_ENGINE state" doc space and are
 * compared by updated_at to decide what's "latest" -- if only one of them
 * populated these fields, whichever path happened to write last would
 * silently blank the evidence panel even though a real evaluation just ran.
 */
function buildM10EvidenceFields(m10: Record<string, unknown>, decision: string) {
  return {
    confidence: typeof m10["confidence"] === "number" ? (m10["confidence"] as number) : null,
    buy_evidence: typeof m10["buy_case_score"] === "number" ? (m10["buy_case_score"] as number) : null,
    sell_evidence: typeof m10["sell_case_score"] === "number" ? (m10["sell_case_score"] as number) : null,
    decision: decision || null,
    freshness_state: typeof m10["freshness_state"] === "string" ? (m10["freshness_state"] as string) : null,
    trend_state: typeof m10["trend_state"] === "string" ? (m10["trend_state"] as string) : null,
    structure_state: typeof m10["structure_state"] === "string" ? (m10["structure_state"] as string) : null,
    location_state: typeof m10["location_state"] === "string" ? (m10["location_state"] as string) : null,
    exhaustion_decision: typeof m10["exhaustion_decision"] === "string" ? (m10["exhaustion_decision"] as string) : null,
    reason: typeof m10["reason"] === "string" ? (m10["reason"] as string) : null,
    evidence_id: (m10["evidence_id"] as number | string | undefined) ?? null,
    bar_time: typeof m10["bar_time"] === "string" ? (m10["bar_time"] as string) : null,
  };
}

export async function mirrorSubscriberM10Evaluation(account: string, m10: Record<string, unknown>, eventTime: unknown): Promise<void> {
  if (!(await isConfiguredSubscriberSource(account))) return;
  if (!m10 || Object.keys(m10).length === 0) return;

  const decision = String(m10["decision"] ?? m10["final_decision"] ?? "").toUpperCase();
  const preferredDir = String(m10["preferred_direction"] ?? m10["direction"] ?? "").toUpperCase();
  const status = m10StatusFromDecision(decision);
  const direction = status === "ACTIONABLE" && ["BUY", "SELL"].includes(preferredDir) ? preferredDir : (["BUY", "SELL"].includes(preferredDir) ? preferredDir : "NONE");

  const db = getDb();
  const collection = db.collection("subscriber_signals");
  const latest = await collection.findOne({ engine: "M10_ENGINE" }, { sort: { updated_at: -1 } });

  const nowIso = new Date().toISOString();
  const evidenceFields = buildM10EvidenceFields(m10, decision);

  const sameState = latest && latest["engine"] === "M10_ENGINE" && latest["status"] === status && latest["direction"] === direction;

  if (sameState) {
    // Routine re-evaluation, nothing customer-visible changed -- refresh in
    // place. Never touches created_at (last state change) or effective_at.
    await collection.updateOne(
      { signal_id: latest!["signal_id"], engine: "M10_ENGINE" },
      { $set: { ...evidenceFields, last_evaluated_at: nowIso, updated_at: nowIso } },
    );
    return;
  }

  // Genuine state/direction change -- a new doc, which is also correctly a
  // new "Recent Signals" entry. Not a notification trigger by itself
  // (mirrorSubscriberSignal already owns notifications for real actionable
  // candidates via the existing candidate-gated path).
  const signalId = String(m10["evidence_id"] ?? m10["candidate_id"] ?? `${String(m10["bar_time"] ?? "")}-${direction}-${status}`);
  const effectiveAt = String(eventTime ?? m10["bar_time"] ?? nowIso);
  const doc = {
    signal_id: signalId,
    engine: "M10_ENGINE" as const,
    symbol: "XAUUSD",
    direction,
    status,
    ...evidenceFields,
    entry: null,
    stop: null,
    tp1: null,
    tp2: null,
    tp3: null,
    rationale: null,
    effective_at: effectiveAt,
    expires_at: null,
    last_evaluated_at: nowIso,
    source: "subscriber_feed",
    updated_at: nowIso,
  };
  await collection.updateOne(
    { signal_id: signalId, engine: "M10_ENGINE" },
    { $set: doc, $setOnInsert: { created_at: nowIso } },
    { upsert: true },
  );
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
    rationale: typeof doc["reasoning"] === "string" ? (doc["reasoning"] as string) : null,
    effective_at: String(doc["published_at"] ?? doc["generated_at"] ?? new Date().toISOString()),
    expires_at: typeof doc["expiry_at"] === "string" ? (doc["expiry_at"] as string) : null,
    confidence_category: typeof doc["confidence_category"] === "string" ? (doc["confidence_category"] as string) : null,
    automated_entry_approved: typeof doc["automated_entry_approved"] === "boolean" ? (doc["automated_entry_approved"] as boolean) : null,
    entry_zone_low: typeof doc["preferred_entry_zone_low"] === "number" ? (doc["preferred_entry_zone_low"] as number) : null,
    entry_zone_high: typeof doc["preferred_entry_zone_high"] === "number" ? (doc["preferred_entry_zone_high"] as number) : null,
    isNewActionable,
  };
}

/** Maps a cloud_outlook_signal_events row (the M10 lifecycle event, before it necessarily becomes an actionable publication) into the sanitized subscriber shape -- used to keep the subscriber "10-minute engine" view current even for WATCHING/BLOCKED states that never produce a notification. */
/**
 * `rawM10` (the same details.m10_signal payload mirrorSubscriberM10Evaluation
 * reads) is optional but should always be passed when available -- without
 * it, this candidate/notification-gated write only carries direction/
 * confidence/status, and since it and the continuous evaluation mirror both
 * write to the same "current M10_ENGINE state" doc space (compared by
 * updated_at), whichever one wrote LAST would blank the evidence panel even
 * though a real evaluation just ran. See buildM10EvidenceFields.
 */
export function m10EventAsSubscriberSignal(eventDoc: Record<string, unknown>, rawM10?: Record<string, unknown>): SubscriberSignalInput {
  const eventType = String(eventDoc["event_type"] ?? "");
  const status: SubscriberSignalStatus = eventType === "ACTIONABLE_SIGNAL" ? "ACTIONABLE" : eventType === "BLOCKED" ? "BLOCKED" : eventType === "EXPIRED" ? "EXPIRED" : "WATCHING";
  const decision = String(rawM10?.["decision"] ?? rawM10?.["final_decision"] ?? "").toUpperCase();
  const evidenceFields = rawM10 ? buildM10EvidenceFields(rawM10, decision) : {};
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
    ...evidenceFields,
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
