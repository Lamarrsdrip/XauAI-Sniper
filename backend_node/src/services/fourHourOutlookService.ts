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
import { fetchXauOhlc } from "./fourHourFeed.js";
import { computeForecast, pipsOf, type EaContext, type ExistingOutlook, type FourHourForecast } from "./fourHourOutlookEngine.js";
import { sendWebPushToUser } from "./webPush.js";

const SYMBOL = "XAUUSD";
const LIFETIME_MS = 4 * 3600 * 1000;
const REVIEW_INTERVAL_MS = 3 * 60 * 1000;
const CONFIDENCE_COLLAPSE = 20;

export interface FourHourDoc extends FourHourForecast {
  id: string;
  symbol: string;
  version: number;
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
}

/** Latest EA market intelligence (read-only) as forecast context. */
async function readEaContext(): Promise<EaContext | null> {
  const db = getDb();
  const row = await db
    .collection("cloud_bot_activity")
    .findOne({ "details.market_thesis.live_bid": { $gt: 0 } }, { projection: { _id: 0, ts: 1, details: 1 }, sort: { ts: -1 } });
  if (!row) return null;
  const details = (row["details"] as Record<string, unknown>) ?? {};
  const mt = (details["market_thesis"] as Record<string, unknown>) ?? {};
  const m10 = (details["m10_signal"] as Record<string, unknown>) ?? {};
  const ts = row["ts"] ? new Date(String(row["ts"])) : null;
  const ageSeconds = ts && !Number.isNaN(ts.getTime()) ? (Date.now() - ts.getTime()) / 1000 : null;
  return {
    regime: strOr(details["regime"] ?? mt["direction"] ?? m10["trend_state"]),
    trendHealth: numOr(mt["trend_health"]),
    location: numOr(mt["location_quality"]),
    exhaustion: numOr(mt["exhaustion_pct"]),
    buyPressure: numOr(mt["buy_pressure"] ?? m10["buy_pressure"]),
    sellPressure: numOr(mt["sell_pressure"] ?? m10["sell_pressure"]),
    roomR: numOr(mt["remaining_room_r"]),
    htfState: strOr(mt["htf_indicator_state"]),
    m10Direction: strOr(m10["preferred_direction"]),
    ageSeconds,
  };
}

/** Existing short-term Outlook (read-only) as context evidence. */
async function readExistingOutlook(): Promise<ExistingOutlook | null> {
  const db = getDb();
  const doc = await db
    .collection("cloud_market_outlooks")
    .findOne({ symbol: SYMBOL, primary_direction: { $in: ["BUY", "SELL", "NEUTRAL"] } }, { projection: { _id: 0, primary_direction: 1, confidence_pct: 1 }, sort: { generated_at: -1 } });
  if (!doc) return null;
  return { direction: strOr(doc["primary_direction"]), confidence: numOr(doc["confidence_pct"]) };
}

function strOr(v: unknown): string | undefined {
  return v == null ? undefined : String(v);
}
function numOr(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function statusFromForecast(f: FourHourForecast): FourHourDoc["status"] {
  if (f.direction === "NEUTRAL" || f.qualification === "NO_QUALIFYING_OPPORTUNITY") return "NO_QUALIFYING_OPPORTUNITY";
  if (f.qualification === "WAIT_FOR_ENTRY") return "WAIT_FOR_ENTRY";
  return "ACTIVE";
}

async function getCurrent(): Promise<FourHourDoc | null> {
  return (await getDb().collection("four_hour_outlooks").findOne({ symbol: SYMBOL }, { projection: { _id: 0 } })) as FourHourDoc | null;
}

/** Build + persist a brand-new forecast, archive the outgoing one, notify on change. */
async function publishNew(forecast: FourHourForecast, previous: FourHourDoc | null, changeEvent: string): Promise<FourHourDoc> {
  const db = getDb();
  const now = new Date();
  const nextReview = new Date(now.getTime() + REVIEW_INTERVAL_MS);
  const doc: FourHourDoc = {
    ...forecast,
    id: randomUUID(),
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
  };

  if (previous) await finalizeHistory(previous, "REPLACED");
  await db.collection("four_hour_outlooks").replaceOne({ symbol: SYMBOL }, doc, { upsert: true });
  await db.collection("four_hour_outlook_history").insertOne({ ...doc, historyId: randomUUID(), archivedAt: null, finalResult: null });

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
  const title = "XauCloud 4H Outlook Changed";
  const body = `${prev.direction} → ${next.direction} · ${next.confidence}% · ${moveTxt}`;
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
  const feed = await fetchXauOhlc();
  const current = await getCurrent();

  if (!feed) {
    if (!current) {
      console.log("4H_OUTLOOK_NO_OPPORTUNITY reason=NO_LIVE_DATA");
      return null;
    }
    return current; // keep last good; UI will show it (possibly stale)
  }

  const [ea, existing] = await Promise.all([readEaContext(), readExistingOutlook()]);
  const forecast = computeForecast(feed, ea, existing);
  const now = new Date();

  if (!current) return publishNew(forecast, null, "INITIAL");

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
    ((current.direction === "BUY" && feed.spot < current.invalidation) || (current.direction === "SELL" && feed.spot > current.invalidation));
  const directionFlip = forecast.direction !== current.direction && Math.abs(forecast.netScore) >= 30;
  const confidenceCollapse = current.direction !== "NEUTRAL" && current.confidence - forecast.confidence >= CONFIDENCE_COLLAPSE && forecast.confidence < 50;

  if (priceBreachedInvalidation || directionFlip || confidenceCollapse) {
    const reason = priceBreachedInvalidation ? "INVALIDATION_BREACHED" : directionFlip ? "DIRECTION_FLIP" : "CONFIDENCE_COLLAPSE";
    if (priceBreachedInvalidation) {
      await db.collection("four_hour_outlooks").updateOne({ symbol: SYMBOL }, { $set: { status: "INVALIDATED" } });
      console.log(`4H_OUTLOOK_INVALIDATED id=${current.id} reason=${reason} price=${feed.spot} inval=${current.invalidation}`);
    }
    return publishNew(forecast, current, reason);
  }

  // No material change: update review timestamps + excursion tracking only.
  const { mfePips, maePips } = trackExcursion(current, feed.spot);
  await db.collection("four_hour_outlooks").updateOne(
    { symbol: SYMBOL },
    { $set: { lastReviewedAt: now.toISOString(), nextScheduledReviewAt: new Date(now.getTime() + REVIEW_INTERVAL_MS).toISOString(), currentPrice: forecast.currentPrice, mfePips, maePips } },
  );
  return { ...current, lastReviewedAt: now.toISOString(), currentPrice: forecast.currentPrice, mfePips, maePips };
}

/** Mark the current forecast as seen (clears the dashboard NEW badge). */
export async function markFourHourSeen(): Promise<void> {
  await getDb().collection("four_hour_outlooks").updateOne({ symbol: SYMBOL }, { $set: { seen: true } });
}

export async function getFourHourCurrent(): Promise<FourHourDoc | null> {
  return getCurrent();
}

export async function getFourHourHistory(limit = 30): Promise<Record<string, unknown>[]> {
  return getDb().collection("four_hour_outlook_history").find({}, { projection: { _id: 0 } }).sort({ generatedAt: -1 }).limit(limit).toArray();
}

/** Background loop -- reviews every 3 min (event-driven) and refreshes on 4h expiry. */
export async function fourHourOutlookLoop(logger?: { info: (m: string) => void; warn: (m: string) => void }): Promise<void> {
  for (;;) {
    try {
      await reviewFourHourOutlook();
    } catch (e) {
      logger?.warn(`[4h-outlook] ${String(e)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, REVIEW_INTERVAL_MS));
  }
}
