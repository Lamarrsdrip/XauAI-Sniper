import { randomUUID } from "node:crypto";
import { getDb } from "../db.js";
import { clampGoldStopToMaxDistance } from "./marketOutlookCore.js";

/**
 * Outlook/Manual-Intelligence -> Aurum integration layer (redesigned
 * 2026-09-02, Outlook+Aurum Unified Coordination fix).
 *
 * PRIOR BEHAVIOR (root cause of the architectural bug this file fixes):
 * this module used to turn a fresh, owner-policy-approved Market Outlook /
 * M10 signal directly into an `OUTLOOK_SIGNAL_OPEN` row in
 * `cloud_bot_commands` -- the EXACT same channel used for owner remote
 * commands (MANUAL_OPEN_NOW etc). The EA treated that as a standing order:
 * arm a timer, then fire OpenTrade on its own bespoke (lighter-weight)
 * gate once the timer elapsed. That made Outlook a second, independent
 * trade-execution source, running alongside (not through) Aurum's real
 * candidate -> structure -> freshness -> timing -> FinalEntryArbiter
 * pipeline.
 *
 * NEW BEHAVIOR: a fresh actionable Outlook/M10 doc no longer enqueues any
 * command. It publishes/upserts a passive `cloud_outlook_thesis` row --
 * directional context (direction, confidence, entry zone, invalidation
 * price, targets, freshness window) with NO execution authority of its
 * own. `GET /cloud/outlook/thesis` (routes/cloud/outlookThesis.ts) is the
 * read-only feed Aurum polls; Aurum's own entry intelligence (the
 * OUTLOOK_ALIGNED candidate lane, gated by the same
 * XAU_TimingAuthorityAllows/XAU_FinalEntryArbiter authorities every other
 * candidate must pass) decides if/when/at what price to actually trade it.
 *
 * `OUTLOOK_SIGNAL_OPEN` is intentionally never emitted by this function
 * anymore. See `retireStaleOutlookSignalOpenCommands` (services/startup.ts)
 * for how any commands emitted by the OLD code path (already sitting in
 * `cloud_bot_commands` from before this deploy) are safely retired so a
 * still-connected EA can never pick one up and self-execute it.
 */
export interface OutlookThesisDoc {
  id: string;
  outlook_id: string;
  account: string;
  license_key: string;
  symbol: string;
  source: string;
  direction: "BUY" | "SELL";
  confidence: number | null;
  regime: string | null;
  setup_type: string | null;
  generated_at: string;
  expires_at: string;
  reference_price: number;
  preferred_entry_zone_low: number;
  preferred_entry_zone_high: number;
  invalidation_price: number;
  suggested_sl: number;
  chase_limit: number;
  tp1_price: number | null;
  tp2_price: number | null;
  tp3_price: number | null;
  status: "ACTIVE" | "EXPIRED" | "SUPERSEDED";
  created_at: string;
  updated_at: string;
}

/** Default freshness window for a thesis that carries no explicit expiry (matches the EA's pre-existing ~1h Outlook opportunity window). */
const DEFAULT_THESIS_TTL_SECONDS = 3600;

/**
 * Builds and upserts an OUTLOOK_THESIS row from a fresh actionable Outlook
 * or M10 doc. Returns the thesis id, or null if the doc is not actionable
 * (missing account/direction/signal id, or no usable SL/entry context --
 * we do not fabricate missing information, per the owner's explicit
 * instruction not to invent thesis data).
 *
 * Name kept as `enqueueIfActionable` for caller-source continuity
 * (index.ts, routes/cloud/activity.ts) -- it no longer enqueues anything;
 * it publishes thesis context. `publishOutlookThesis` is the same function
 * under its accurate name for new call sites.
 */
export async function publishOutlookThesis(doc: Record<string, unknown> | null, sourceLabel = "MARKET_OUTLOOK"): Promise<string | null> {
  if (!doc) return null;
  const account = String(doc["account"] ?? "");
  const direction = String(doc["primary_direction"] ?? "").toUpperCase();
  const signalId = String(doc["id"] ?? doc["candidate_id"] ?? "");
  if (!account || !["BUY", "SELL"].includes(direction) || !signalId) return null;

  // Same authoritative-SL resolution the old command payload used --
  // reused, not reinvented (owner directive 2026-08-08 items 2 & 3 remain
  // the source of truth for what "the signal's own stop" means).
  const requestedSl = Number(doc["suggested_sl"] ?? doc["invalidation_price"] ?? doc["final_structural_sl"] ?? 0) || 0;
  const entryLow = Number(doc["preferred_entry_zone_low"] ?? 0) || 0;
  const entryHigh = Number(doc["preferred_entry_zone_high"] ?? 0) || 0;
  const entryRef = entryLow > 0 && entryHigh > 0 ? Math.round(((entryLow + entryHigh) / 2) * 100) / 100 : 0;
  const clampedSl = entryRef > 0 ? clampGoldStopToMaxDistance(entryRef, requestedSl, direction === "BUY" ? 1 : -1) : 0;
  if (!clampedSl || !entryRef) return null;

  const nowIso = new Date().toISOString();
  const generatedAt = String(doc["generated_at"] ?? nowIso);
  const explicitExpiry = String(doc["expiry_at"] ?? "");
  const expiresAt = explicitExpiry || new Date(new Date(generatedAt).getTime() + DEFAULT_THESIS_TTL_SECONDS * 1000).toISOString();

  const confidenceRaw = doc["confidence_pct"] ?? doc["confidence"];
  const confidence = confidenceRaw === null || confidenceRaw === undefined ? null : Number(confidenceRaw);

  const thesis: OutlookThesisDoc = {
    id: randomUUID(),
    outlook_id: signalId,
    account,
    license_key: String(doc["license_key"] ?? ""),
    symbol: String(doc["symbol"] ?? "XAUUSD"),
    source: sourceLabel,
    direction: direction as "BUY" | "SELL",
    confidence: confidence !== null && Number.isFinite(confidence) ? confidence : null,
    regime: (doc["market_regime"] as string | undefined) ?? (doc["regime"] as string | undefined) ?? null,
    setup_type: (doc["setup_type"] as string | undefined) ?? null,
    generated_at: generatedAt,
    expires_at: expiresAt,
    reference_price: entryRef,
    preferred_entry_zone_low: entryLow,
    preferred_entry_zone_high: entryHigh,
    invalidation_price: requestedSl,
    suggested_sl: clampedSl,
    chase_limit: Number(doc["chase_limit"] ?? 0) || 0,
    tp1_price: Number(doc["tp1_price"] ?? 0) || null,
    tp2_price: Number(doc["tp2_price"] ?? 0) || null,
    tp3_price: Number(doc["tp3_price"] ?? 0) || null,
    status: "ACTIVE",
    created_at: nowIso,
    updated_at: nowIso,
  };

  const db = getDb();
  const collection = db.collection("cloud_outlook_thesis");

  // One active thesis per (account, symbol): a fresh actionable doc
  // supersedes whatever thesis was previously active for that account, but
  // never overwrites/erases history -- the prior active row (if any and if
  // genuinely different) is marked SUPERSEDED rather than deleted, so
  // Trade Brain / analytics can still see the full lineage.
  await collection.updateMany(
    { account, symbol: thesis.symbol, status: "ACTIVE", outlook_id: { $ne: thesis.outlook_id } },
    { $set: { status: "SUPERSEDED", updated_at: nowIso } },
  );

  await collection.updateOne(
    { account, symbol: thesis.symbol, outlook_id: thesis.outlook_id },
    { $set: thesis },
    { upsert: true },
  );

  return thesis.id;
}

/** Back-compat alias -- see publishOutlookThesis's own doc comment. */
export const enqueueIfActionable = publishOutlookThesis;
