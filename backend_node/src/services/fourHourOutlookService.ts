/**
 * XauCloud 4H Outlook -- orchestration (generate / store / review / notify).
 *
 * DISPLAY + NOTIFICATION ONLY. This service reads real OHLC (fourHourFeed),
 * reads EA evidence + the existing short-term Outlook READ-ONLY for context,
 * computes a forecast (fourHourOutlookEngine), persists it, tracks MFE/MAE,
 * handles 4h expiry + event-driven invalidation, and fans out a push
 * notification on a material change via the existing web-push infrastructure.
 *
 * It NEVER writes cloud_bot_commands, never calls OpenTrade/execution, never
 * touches cloud_market_outlooks (only reads it), and never affects the EA.
 * Collections it owns: four_hour_outlooks (current) and four_hour_outlook_history.
 */
import { randomUUID } from "node:crypto";
import { getDb } from "../db.js";
import { readMarketData } from "./fourHourFeed.js";
import { computeForecast, pipsOf, type Direction, type FourHourForecast, type ThesisState, type TradeOpportunity } from "./fourHourOutlookEngine.js";
import { sendWebPushToUser } from "./webPush.js";

const SYMBOL = "XAUUSD";
// A thesis is multi-session. Individual opportunities are reviewed separately;
// refreshing a clock every four hours must not turn one thesis into one trade.
const LIFETIME_MS = 7 * 24 * 3600 * 1000;
const REVIEW_INTERVAL_MS = 3 * 60 * 1000;
const ENTRY_REENTRY_COOLDOWN_MS = 6 * 3600 * 1000;

export interface FourHourDoc extends FourHourForecast {
  id: string;
  symbol: string;
  version: number;
  thesisId: string;
  state: ThesisState;
  status: "ACTIVE" | "WAIT_FOR_ENTRY" | "NO_QUALIFYING_OPPORTUNITY" | "INVALIDATED" | "EXPIRED";
  generatedAt: string;
  expiresAt: string;
  lastReviewedAt: string;
  nextScheduledReviewAt: string;
  generatedPrice: number;
  seen: boolean;
  previousDirection: string | null;
  changeEvent: string | null;
  mfePips: number;
  maePips: number;
  marketDataAt: string;
  currentOpportunity: PersistedOpportunity | null;
  entryCooldownUntil: string | null;
  recentOpportunities?: PersistedOpportunity[];
}

export interface PersistedOpportunity extends TradeOpportunity {
  id: string;
  thesisId: string;
  generatedAt: string;
  generatedPrice: number;
  status: "ACTIVE" | "T1_REACHED" | "INVALIDATED" | "EXPIRED";
  mfePips: number;
  maePips: number;
  completedAt: string | null;
}

// ---- data-integrity gate: only publish on the EA's own genuine, fresh broker read ----
const EA_STALE_SEC = 10 * 60; // if the newest EA evidence is older than this, the bot is offline -> degrade
const GENUINE_SOURCE = "ea-stream(spot)";
let reviewInFlight: Promise<FourHourDoc | null> | null = null;

/** Reject a forecast when the bot's live data is missing, offline/stale, or thin. */
export function validateMarketData(md: import("./fourHourFeed.js").MarketData | null): { ok: boolean; reason: string } {
  if (!md) return { ok: false, reason: "NO_EA_DATA" };
  if (!Number.isFinite(md.ageSec) || md.ageSec > EA_STALE_SEC) return { ok: false, reason: `EA_OFFLINE_OR_STALE age=${Math.round(md.ageSec / 60)}m` };
  // HTF direction is calculated from persisted H1/H4/D1 broker candles.
  // M10 snapshots are entry context only, so one fresh quote is enough to
  // distinguish a working/no-setup feed from a genuinely unavailable feed.
  if (md.snapshots.length < 1) return { ok: false, reason: "NO_CURRENT_BROKER_QUOTE" };
  if (!(md.price >= 1000 && md.price <= 20000)) return { ok: false, reason: `PRICE_OUT_OF_RANGE price=${md.price}` };
  return { ok: true, reason: "" };
}

/** Only forecasts built from the EA's own genuine broker stream are ever served. */
function isGenuineSource(src: unknown): boolean {
  return String(src ?? "") === GENUINE_SOURCE;
}

function statusFromForecast(f: FourHourForecast): FourHourDoc["status"] {
  if (f.direction === "NEUTRAL" || f.qualification === "NO_QUALIFYING_OPPORTUNITY") return "NO_QUALIFYING_OPPORTUNITY";
  if (f.qualification === "WAIT_FOR_ENTRY") return "WAIT_FOR_ENTRY";
  return "ACTIVE";
}

async function getCurrent(): Promise<FourHourDoc | null> {
  return (await getDb().collection("four_hour_outlooks").findOne({ symbol: SYMBOL }, { projection: { _id: 0 } })) as FourHourDoc | null;
}

function persistOpportunity(candidate: TradeOpportunity, thesisId: string, price: number): PersistedOpportunity {
  return {
    ...candidate, id: randomUUID(), thesisId, generatedAt: new Date().toISOString(), generatedPrice: price,
    status: "ACTIVE", mfePips: 0, maePips: 0, completedAt: null,
  };
}

async function insertOpportunity(opportunity: PersistedOpportunity): Promise<void> {
  await getDb().collection("four_hour_trade_opportunities").insertOne(opportunity);
}

async function reviewOpportunity(opportunity: PersistedOpportunity | null, price: number): Promise<PersistedOpportunity | null> {
  if (!opportunity || opportunity.status !== "ACTIVE") return opportunity;
  const move = pipsOf(price - opportunity.generatedPrice) * (opportunity.direction === "SELL" ? -1 : 1);
  const mfePips = Math.max(opportunity.mfePips, Math.round(move));
  const maePips = Math.min(opportunity.maePips, Math.round(move));
  let status: PersistedOpportunity["status"] = "ACTIVE";
  if ((opportunity.direction === "BUY" && price <= opportunity.invalidation) || (opportunity.direction === "SELL" && price >= opportunity.invalidation)) status = "INVALIDATED";
  else if ((opportunity.direction === "BUY" && price >= opportunity.targets[0]!.price) || (opportunity.direction === "SELL" && price <= opportunity.targets[0]!.price)) status = "T1_REACHED";
  else if (Date.now() - new Date(opportunity.generatedAt).getTime() >= 24 * 3600 * 1000) status = "EXPIRED";
  const next = { ...opportunity, mfePips, maePips, status, completedAt: status === "ACTIVE" ? null : new Date().toISOString() };
  await getDb().collection("four_hour_trade_opportunities").updateOne({ id: opportunity.id }, { $set: next });
  return next;
}

/** Build + persist a brand-new forecast, archive the outgoing one, notify on change. */
async function publishNew(forecast: FourHourForecast, previous: FourHourDoc | null, changeEvent: string): Promise<FourHourDoc> {
  const db = getDb();
  const now = new Date();
  const nextReview = new Date(now.getTime() + REVIEW_INTERVAL_MS);
  const thesisId = previous?.thesisId && previous.direction === forecast.direction ? previous.thesisId : randomUUID();
  const currentOpportunity = forecast.opportunity ? persistOpportunity(forecast.opportunity, thesisId, forecast.currentPrice) : null;
  const doc: FourHourDoc = {
    ...forecast,
    id: randomUUID(),
    thesisId,
    state: forecast.thesisStatus,
    symbol: SYMBOL,
    version: (previous?.version ?? 0) + 1,
    status: statusFromForecast(forecast),
    generatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + LIFETIME_MS).toISOString(),
    lastReviewedAt: now.toISOString(),
    nextScheduledReviewAt: nextReview.toISOString(),
    generatedPrice: forecast.currentPrice,
    seen: false,
    previousDirection: previous ? previous.direction : null,
    changeEvent,
    mfePips: 0,
    maePips: 0,
    marketDataAt: new Date().toISOString(),
    currentOpportunity,
    entryCooldownUntil: null,
  };

  if (previous) await finalizeHistory(previous, "REPLACED");
  await db.collection("four_hour_outlooks").replaceOne({ symbol: SYMBOL }, doc, { upsert: true });
  await db.collection("four_hour_outlook_history").insertOne({ ...doc, historyId: randomUUID(), archivedAt: null, finalResult: null });
  if (currentOpportunity) await insertOpportunity(currentOpportunity);

  const directionChanged = previous && previous.direction !== doc.direction;
  console.log(`4H_OUTLOOK_GENERATED symbol=${SYMBOL} dir=${doc.direction} status=${doc.status} conf=${doc.confidence} move=${JSON.stringify(doc.expectedMovePips)} event=${changeEvent} src=${doc.dataSource}${doc.dataStale ? " (stale)" : ""}`);
  if (directionChanged) {
    console.log(`4H_OUTLOOK_UPDATED ${previous!.direction} -> ${doc.direction} conf=${doc.confidence}`);
    await notifyChange(previous!, doc);
  }
  return doc;
}

/** Append the final MFE/MAE + correctness verdict onto the history row. */
async function finalizeHistory(prev: FourHourDoc, reason: string): Promise<void> {
  const db = getDb();
  const correct =
    prev.direction === "NEUTRAL"
      ? null
      : prev.direction === "BUY"
        ? prev.mfePips >= Math.abs(prev.maePips)
        : prev.direction === "SELL"
          ? prev.mfePips >= Math.abs(prev.maePips)
          : null;
  await db.collection("four_hour_outlook_history").updateOne(
    { id: prev.id },
    { $set: { archivedAt: new Date().toISOString(), finalResult: { reason, mfePips: prev.mfePips, maePips: prev.maePips, directionCorrect: correct } } },
  );
}

async function notifyChange(prev: FourHourDoc, next: FourHourDoc): Promise<void> {
  const db = getDb();
  const moveTxt = next.expectedMovePips ? `${next.expectedMovePips[0]}–${next.expectedMovePips[1]} pips` : "no qualifying move";
  const title = "Manual Trading Intelligence changed";
  const body = `4H bias ${prev.direction} → ${next.direction} · ${next.confidence}% · ${moveTxt}`;
  const subs = await db.collection("web_push_subscriptions").distinct("user_id");
  let sent = 0;
  for (const userId of subs) {
    if (!userId) continue;
    try {
      const n = await sendWebPushToUser(String(userId), { title, body, deep_link: "/command/dashboard", category: "MARKET_OUTLOOK", tag: "4h-outlook" });
      if (n > 0) sent += 1;
    } catch {
      /* fail-safe: a push failure must never break the forecast pipeline */
    }
    await db.collection("cloud_notification_log").insertOne({
      id: randomUUID(),
      idempotency_key: `4h:${next.id}:${userId}`,
      user_id: String(userId),
      outlook_id: next.id,
      notification_type: "4H_OUTLOOK_CHANGED",
      category: "MARKET_OUTLOOK",
      title,
      body,
      scheduled_time: new Date().toISOString(),
      delivery_status: "SENT",
    }).catch(() => {});
  }
  console.log(`4H_OUTLOOK_NOTIFICATION_SENT change=${prev.direction}->${next.direction} recipients=${sent}`);
}

/** Update MFE/MAE from live price against the generated entry. */
function trackExcursion(doc: FourHourDoc, price: number): { mfePips: number; maePips: number } {
  const movePips = pipsOf(price - doc.generatedPrice) * (doc.direction === "SELL" ? -1 : 1);
  const mfePips = doc.direction === "NEUTRAL" ? doc.mfePips : Math.max(doc.mfePips, Math.round(movePips));
  const maePips = doc.direction === "NEUTRAL" ? doc.maePips : Math.min(doc.maePips, Math.round(movePips));
  return { mfePips, maePips };
}

/**
 * One review pass: fetch fresh data, and either
 *  - generate the first forecast, or
 *  - refresh on 4h expiry (scheduled), or
 *  - replace + notify on a MATERIAL change (direction flip / invalidation
 *    breach / confidence collapse), or
 *  - otherwise just update lastReviewed + MFE/MAE (clock NOT reset).
 * Returns the current doc (or null if live data is unavailable and none exists).
 */
export async function reviewFourHourOutlook(): Promise<FourHourDoc | null> {
  const db = getDb();
  const md = await readMarketData();
  let current = await getCurrent();

  // Purge any forecast not built from the EA's own genuine broker stream
  // (e.g. retired external/futures-sourced docs) so the card never shows them.
  if (current && (!isGenuineSource(current.dataSource) || !current.marketDataAt || !current.thesisId)) {
    await db.collection("four_hour_outlooks").deleteOne({ symbol: SYMBOL });
    console.log(`MTI_PURGED_NON_GENUINE src=${current.dataSource}`);
    current = null;
  }

  // Data-integrity gate: only the bot's own genuine, fresh broker read publishes.
  const check = validateMarketData(md);
  if (!check.ok) {
    console.log(`MTI_DEGRADED reason=${check.reason}`);
    // A previously-published, genuine, not-yet-expired forecast may keep
    // showing; otherwise there is nothing valid to display (card degrades).
    if (current && new Date(current.expiresAt).getTime() > Date.now()) return current;
    return null;
  }

  const validMd = md!; // validated non-null above
  const previousDir: Direction = (current?.direction as Direction) ?? "NEUTRAL";
  const forecast = computeForecast(validMd, previousDir); // hysteresis -> stable long-horizon bias
  const now = new Date();
  console.log(`MTI_DECISION thesis=${current?.thesisId ?? "NEW"} previous=${previousDir} proposed=${forecast.direction} state=${forecast.thesisStatus} regime=${forecast.regimeLabel} conf=${forecast.confidence} runway=${forecast.directionalRunwayPips ?? 0} entry=${forecast.entryTiming} d1=${forecast.htfScores.d1} h4=${forecast.htfScores.h4} h1=${forecast.htfScores.h1} data=${forecast.dataStatus} flipEvidence=${forecast.opposingStructureConfirmed}`);

  if (!current) return publishNew(forecast, null, "INITIAL");

  // A new installation starts with a real price but not enough D1/H4 history.
  // It may state NO SETUP, but it must not invalidate or flip a thesis from a
  // partial series. This is a data-availability state, not market evidence.
  if (validMd.dataStatus !== "READY") {
    const reviewedAt = now.toISOString();
    await db.collection("four_hour_outlooks").updateOne(
      { symbol: SYMBOL },
      { $set: { lastReviewedAt: reviewedAt, nextScheduledReviewAt: new Date(now.getTime() + REVIEW_INTERVAL_MS).toISOString(), currentPrice: validMd.price, marketDataAt: reviewedAt, dataStale: false, dataStatus: validMd.dataStatus } },
    );
    return { ...current, lastReviewedAt: reviewedAt, currentPrice: validMd.price, marketDataAt: reviewedAt, dataStale: false, dataStatus: validMd.dataStatus };
  }

  const expired = new Date(current.expiresAt).getTime() <= now.getTime();
  if (expired) {
    await finalizeHistory(current, "EXPIRED");
    console.log(`4H_OUTLOOK_EXPIRED id=${current.id} dir=${current.direction} mfe=${current.mfePips} mae=${current.maePips}`);
    return publishNew(forecast, current, "SCHEDULED_REFRESH");
  }

  // Material invalidation / change detection.
  const priceBreachedInvalidation =
    current.direction !== "NEUTRAL" &&
    current.invalidation != null &&
    ((current.direction === "BUY" && validMd.price < current.invalidation) || (current.direction === "SELL" && validMd.price > current.invalidation));
  const directionFlip = forecast.direction !== current.direction && forecast.direction !== "NEUTRAL" && forecast.opposingStructureConfirmed && forecast.confidence >= 75;

  if (priceBreachedInvalidation || directionFlip) {
    const reason = priceBreachedInvalidation ? "INVALIDATION_BREACHED" : "DIRECTION_FLIP";
    if (priceBreachedInvalidation) {
      await db.collection("four_hour_outlooks").updateOne({ symbol: SYMBOL }, { $set: { status: "INVALIDATED" } });
      console.log(`4H_OUTLOOK_INVALIDATED id=${current.id} reason=${reason} price=${validMd.price} inval=${current.invalidation}`);
    }
    return publishNew(forecast, current, reason);
  }

  // No material thesis change: small candles can alter an entry, never the
  // HTF direction. A closed-H1 setup key is allowed to create a fresh entry
  // only after the prior entry has resolved; this is explicit re-entry support.
  const { mfePips, maePips } = trackExcursion(current, validMd.price);
  const reviewedOpportunity = await reviewOpportunity(current.currentOpportunity ?? null, validMd.price);
  const opportunityJustResolved = current.currentOpportunity?.status === "ACTIVE" && reviewedOpportunity?.status !== "ACTIVE";
  const entryCooldownUntil = opportunityJustResolved ? new Date(now.getTime() + ENTRY_REENTRY_COOLDOWN_MS).toISOString() : (current.entryCooldownUntil ?? null);
  const cooldownElapsed = !entryCooldownUntil || new Date(entryCooldownUntil).getTime() <= now.getTime();
  let currentOpportunity = reviewedOpportunity;
  if (forecast.opportunity && cooldownElapsed && (!reviewedOpportunity || reviewedOpportunity.status !== "ACTIVE") && forecast.opportunity.setupKey !== reviewedOpportunity?.setupKey) {
    currentOpportunity = persistOpportunity(forecast.opportunity, current.thesisId, forecast.currentPrice);
    await insertOpportunity(currentOpportunity);
  }
  const state: ThesisState = current.direction !== "NEUTRAL" && forecast.direction !== current.direction ? "WEAKENING" : forecast.thesisStatus;
  await db.collection("four_hour_outlooks").updateOne(
    { symbol: SYMBOL },
    { $set: { lastReviewedAt: now.toISOString(), nextScheduledReviewAt: new Date(now.getTime() + REVIEW_INTERVAL_MS).toISOString(), currentPrice: forecast.currentPrice, marketDataAt: now.toISOString(), dataStale: false, dataStatus: validMd.dataStatus, state, confidence: forecast.confidence, evidence: forecast.evidence, reasoning: forecast.reasoning, entryTiming: forecast.entryTiming, qualification: forecast.qualification, preferredZone: forecast.preferredZone, expectedMovePips: forecast.expectedMovePips, targets: forecast.targets, directionalRunwayPips: forecast.directionalRunwayPips, rejectionReasons: forecast.rejectionReasons, opportunity: forecast.opportunity, currentOpportunity, entryCooldownUntil, htfScores: forecast.htfScores, mfePips, maePips } },
  );
  return { ...current, lastReviewedAt: now.toISOString(), currentPrice: forecast.currentPrice, marketDataAt: now.toISOString(), dataStale: false, dataStatus: validMd.dataStatus, state, confidence: forecast.confidence, evidence: forecast.evidence, reasoning: forecast.reasoning, entryTiming: forecast.entryTiming, qualification: forecast.qualification, preferredZone: forecast.preferredZone, expectedMovePips: forecast.expectedMovePips, targets: forecast.targets, directionalRunwayPips: forecast.directionalRunwayPips, rejectionReasons: forecast.rejectionReasons, opportunity: forecast.opportunity, currentOpportunity, entryCooldownUntil, htfScores: forecast.htfScores, mfePips, maePips };
}

/** Coalesce heartbeat/background requests onto the one existing 4H review. */
export function ensureFourHourOutlookReview(): Promise<FourHourDoc | null> {
  if (!reviewInFlight) {
    reviewInFlight = reviewFourHourOutlook().finally(() => { reviewInFlight = null; });
  }
  return reviewInFlight;
}

/** Mark the current forecast as seen (clears the dashboard NEW badge). */
export async function markFourHourSeen(): Promise<void> {
  await getDb().collection("four_hour_outlooks").updateOne({ symbol: SYMBOL }, { $set: { seen: true } });
}

export async function getFourHourCurrent(): Promise<FourHourDoc | null> {
  const doc = await getCurrent();
  if (!doc) return null;
  if (!isGenuineSource(doc.dataSource)) return null; // never serve legacy futures data
  if (!doc.marketDataAt || Date.now() - new Date(doc.marketDataAt).getTime() > EA_STALE_SEC * 1000) return null;
  if (new Date(doc.expiresAt).getTime() <= Date.now()) return null; // expired -> card shows unavailable
  const recentOpportunities = await getDb().collection("four_hour_trade_opportunities")
    .find({ thesisId: doc.thesisId }, { projection: { _id: 0 } }).sort({ generatedAt: -1 }).limit(8).toArray() as unknown as PersistedOpportunity[];
  return { ...doc, currentOpportunity: doc.currentOpportunity ?? null, recentOpportunities };
}

export async function getFourHourHistory(limit = 30): Promise<Record<string, unknown>[]> {
  return getDb().collection("four_hour_outlook_history").find({}, { projection: { _id: 0 } }).sort({ generatedAt: -1 }).limit(limit).toArray();
}

/** Background loop -- reviews every 3 min (event-driven) and refreshes on 4h expiry. */
export async function fourHourOutlookLoop(logger?: { info: (m: string) => void; warn: (m: string) => void }): Promise<void> {
  for (;;) {
    try {
      await ensureFourHourOutlookReview();
    } catch (e) {
      logger?.warn(`[4h-outlook] ${String(e)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, REVIEW_INTERVAL_MS));
  }
}
