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
import { fetchXauOhlc, type OhlcFeed } from "./fourHourFeed.js";
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

// ---- data-integrity gate (2026-08): never publish on wrong/stale/mismatched pricing ----
const MAX_CANDLE_AGE_SEC = 3 * 3600; // newest H1 bar must be < 3h old (gold trades ~23h/day)
const BROKER_MAX_AGE_SEC = 20 * 60; // broker reference usable for cross-check only if < 20 min old
const PRICE_TOLERANCE_USD = 12; // external SPOT must agree with broker XAUUSD within $12 -> rejects ~$40-60 futures basis

/** XauCloud's own live broker XAUUSD mid (the market customers actually trade). */
async function readBrokerXauPrice(): Promise<{ mid: number; ageSec: number } | null> {
  const row = await getDb()
    .collection("cloud_bot_activity")
    .findOne(
      { "details.market_thesis.live_bid": { $gt: 0 }, "details.market_thesis.live_ask": { $gt: 0 } },
      { projection: { _id: 0, ts: 1, "details.market_thesis.live_bid": 1, "details.market_thesis.live_ask": 1 }, sort: { ts: -1 } },
    );
  if (!row) return null;
  const mt = ((row["details"] as Record<string, unknown> | undefined)?.["market_thesis"] as Record<string, unknown> | undefined) ?? {};
  const bid = Number(mt["live_bid"]);
  const ask = Number(mt["live_ask"]);
  if (!(bid > 0 && ask > 0)) return null;
  const tsMs = row["ts"] ? new Date(String(row["ts"])).getTime() : NaN;
  return { mid: (bid + ask) / 2, ageSec: Number.isFinite(tsMs) ? (Date.now() - tsMs) / 1000 : Infinity };
}

/** Reject a forecast when the market data is not genuine, fresh, complete, and consistent with the broker XAUUSD. */
function validateFeed(feed: OhlcFeed | null, broker: { mid: number; ageSec: number } | null): { ok: boolean; reason: string } {
  if (!feed) return { ok: false, reason: "NO_LIVE_SPOT_DATA" };
  const ageSec = (Date.now() - new Date(feed.latestCandleTime).getTime()) / 1000;
  if (!Number.isFinite(ageSec)) return { ok: false, reason: "INVALID_TIMESTAMP" };
  if (feed.stale || ageSec > MAX_CANDLE_AGE_SEC) return { ok: false, reason: `STALE_CANDLES age=${Math.round(ageSec / 60)}m src=${feed.source}` };
  if (feed.h1.length < 60 || feed.h4.length < 20) return { ok: false, reason: `INCOMPLETE_CANDLES h1=${feed.h1.length} h4=${feed.h4.length}` };
  if (!(feed.spot >= 1000 && feed.spot <= 20000)) return { ok: false, reason: `PRICE_OUT_OF_RANGE spot=${feed.spot}` };
  if (broker && broker.ageSec <= BROKER_MAX_AGE_SEC) {
    const diff = Math.abs(feed.spot - broker.mid);
    if (diff > PRICE_TOLERANCE_USD)
      return { ok: false, reason: `PRICE_MISMATCH_VS_BROKER diff=$${diff.toFixed(1)} spot=${feed.spot.toFixed(1)} broker=${broker.mid.toFixed(1)} src=${feed.source}` };
  }
  return { ok: true, reason: "" };
}

/** A genuine spot source name always carries "(spot)"; a legacy futures forecast never will. */
function isSpotSource(src: unknown): boolean {
  return /\(spot\)/i.test(String(src ?? ""));
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
  const feed = await fetchXauOhlc();
  const broker = await readBrokerXauPrice();
  let current = await getCurrent();

  // Purge any legacy futures-sourced forecast so the card never shows the wrong
  // (~$40-60 high) prices from the retired GC=F futures feed.
  if (current && !isSpotSource(current.dataSource)) {
    await db.collection("four_hour_outlooks").deleteOne({ symbol: SYMBOL });
    console.log(`MTI_PURGED_NON_SPOT_FORECAST src=${current.dataSource}`);
    current = null;
  }

  // Data-integrity gate: never publish on wrong/stale/incomplete/mismatched pricing.
  const check = validateFeed(feed, broker);
  if (!check.ok) {
    console.log(`MTI_DEGRADED reason=${check.reason}${broker ? "" : " broker_ref=unavailable"}`);
    // A previously-published, genuinely-sourced, not-yet-expired forecast may
    // keep showing; otherwise there is nothing valid to display (card degrades).
    if (current && new Date(current.expiresAt).getTime() > Date.now()) return current;
    return null;
  }

  const validFeed = feed as OhlcFeed; // validated non-null + genuine spot above
  const [ea, existing] = await Promise.all([readEaContext(), readExistingOutlook()]);
  const forecast = computeForecast(validFeed, ea, existing);
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
    ((current.direction === "BUY" && validFeed.spot < current.invalidation) || (current.direction === "SELL" && validFeed.spot > current.invalidation));
  const directionFlip = forecast.direction !== current.direction && Math.abs(forecast.netScore) >= 30;
  const confidenceCollapse = current.direction !== "NEUTRAL" && current.confidence - forecast.confidence >= CONFIDENCE_COLLAPSE && forecast.confidence < 50;

  if (priceBreachedInvalidation || directionFlip || confidenceCollapse) {
    const reason = priceBreachedInvalidation ? "INVALIDATION_BREACHED" : directionFlip ? "DIRECTION_FLIP" : "CONFIDENCE_COLLAPSE";
    if (priceBreachedInvalidation) {
      await db.collection("four_hour_outlooks").updateOne({ symbol: SYMBOL }, { $set: { status: "INVALIDATED" } });
      console.log(`4H_OUTLOOK_INVALIDATED id=${current.id} reason=${reason} price=${validFeed.spot} inval=${current.invalidation}`);
    }
    return publishNew(forecast, current, reason);
  }

  // No material change: update review timestamps + excursion tracking only.
  const { mfePips, maePips } = trackExcursion(current, validFeed.spot);
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
  const doc = await getCurrent();
  if (!doc) return null;
  if (!isSpotSource(doc.dataSource)) return null; // never serve legacy futures data
  if (new Date(doc.expiresAt).getTime() <= Date.now()) return null; // expired -> card shows unavailable
  return doc;
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
