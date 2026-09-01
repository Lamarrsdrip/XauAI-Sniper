import { randomUUID } from "node:crypto";
import { getDb } from "../db.js";
import { ANALYTICS_TERMINAL_OUTCOMES, TIMEOUT_TERMINAL_STATES } from "./marketOutlookCore.js";
import { asUtc } from "./marketOutlookEvidence.js";
import { advancePersistedSignal } from "./marketOutlookLifecycle.js";
import { dispatchSignalEvent } from "./marketOutlookPublish.js";
import { buildOutlookObservation, recordGlobalBrainObservation } from "./globalBrainIngest.js";

type Quote = [number, number, Date];

/** Port of market_outlook.py:2233 `_account_quotes_since` -- persisted account quotes in event order, for restart replay. */
async function accountQuotesSince(account: string, since: Date, until: Date): Promise<Quote[]> {
  if (!account) return [];
  const rows = await getDb()
    .collection("cloud_bot_activity")
    .find(
      {
        account,
        ts: { $gt: since.toISOString(), $lte: until.toISOString() },
        "details.market_thesis.live_bid": { $gt: 0 },
        "details.market_thesis.live_ask": { $gt: 0 },
      },
      { projection: { _id: 0, ts: 1, "details.market_thesis.live_bid": 1, "details.market_thesis.live_ask": 1 } },
    )
    .sort({ ts: 1 })
    .limit(5000)
    .toArray();

  const quotes: Quote[] = [];
  for (const row of rows) {
    const thesis = ((row["details"] as Record<string, unknown> | undefined)?.["market_thesis"] as Record<string, unknown> | undefined) ?? {};
    const quoteTime = asUtc(row["ts"]);
    const quoteBid = Number(thesis["live_bid"]);
    const quoteAsk = Number(thesis["live_ask"]);
    if (quoteTime && quoteBid && quoteAsk && quoteAsk >= quoteBid) quotes.push([quoteBid, quoteAsk, quoteTime]);
  }
  return quotes;
}

/** Port of market_outlook.py:2373 `_record_revision`. */
export async function recordRevision(outlookId: string, field: string, previousValue: unknown, newValue: unknown, reason: string): Promise<void> {
  await getDb().collection("cloud_market_outlook_revisions").insertOne({
    id: randomUUID(),
    outlook_id: outlookId,
    revision_time: new Date().toISOString(),
    field,
    previous_value: previousValue,
    new_value: newValue,
    reason,
  });
}

/** Port of market_outlook.py:2386 `_persist_signal_outcome`. */
export async function persistSignalOutcome(doc: Record<string, unknown>): Promise<void> {
  if (!ANALYTICS_TERMINAL_OUTCOMES.has(String(doc["analytics_outcome"]))) return;
  const outcomeDoc = {
    outlook_id: doc["id"],
    account: doc["account"],
    analytics_outcome: doc["analytics_outcome"],
    analytics_r: doc["analytics_r"],
    signal_state: doc["signal_state"],
    classification_at: doc["classification_at"],
    tracking_entry_price: doc["tracking_entry_price"],
    original_sl: doc["original_sl"],
    risk_distance: doc["risk_distance"],
    mfe_r: doc["mfe_r"],
    mae_r: doc["mae_r"],
    highest_tp_reached: doc["highest_tp_reached"],
    confidence_pct: doc["confidence_pct"],
    primary_direction: doc["primary_direction"],
    setup_type: doc["setup_type"],
    expected_path: doc["expected_path"],
    session: doc["session"],
    current_r: doc["current_r"],
    latest_path_event: doc["latest_path_event"],
    first_half_r_at: doc["first_half_r_at"],
    tp1_hit_at: doc["tp1_hit_at"],
    tp2_hit_at: doc["tp2_hit_at"],
    tp3_hit_at: doc["tp3_hit_at"],
    sl_hit_at: doc["sl_hit_at"],
    event_snapshots: doc["event_snapshots"] ?? {},
    updated_at: new Date().toISOString(),
  };
  await getDb()
    .collection("cloud_market_outlook_outcomes")
    .updateOne({ outlook_id: doc["id"] }, { $set: outcomeDoc, $setOnInsert: { id: randomUUID() } }, { upsert: true });

  // Global Learning Brain: build the unified observation for this
  // now-terminal Outlook signal, replaying the SAME causally-ordered quote
  // journey already used to classify its real outcome for counterfactual
  // entry-timing analysis (see globalBrainCounterfactual.ts -- purely
  // retrospective, no new lookahead risk). Best-effort, never affects the
  // outcome persistence above -- see globalBrainIngest.ts's shadow-only
  // boundary comment.
  try {
    const since = asUtc(doc["published_quote_at"]) ?? asUtc(doc["published_at"]);
    const until = asUtc(doc["classification_at"]) ?? asUtc(doc["evaluation_deadline"]) ?? new Date();
    const quotes = since ? await accountQuotesSince(String(doc["account"] ?? ""), since, until) : [];
    const observation = buildOutlookObservation(doc, quotes);
    if (observation) await recordGlobalBrainObservation(observation);
  } catch {
    /* best-effort */
  }
}

/** Port of market_outlook.py:1954 `_signal_events_present`. */
function signalEventsPresent(doc: Record<string, unknown>): string[] {
  const events: string[] = doc["tracking_entry_price"] ? ["TRACKING_STARTED"] : [];
  const fieldEvents: [string, string][] = [
    ["first_half_r_at", "HALF_R_REACHED"],
    ["tp1_hit_at", "TP1_HIT"],
    ["tp2_hit_at", "TP2_HIT"],
    ["tp3_hit_at", "TP3_HIT"],
    ["sl_hit_at", "SL_HIT"],
  ];
  for (const [field, event] of fieldEvents) if (doc[field]) events.push(event);
  if (TIMEOUT_TERMINAL_STATES.has(String(doc["signal_state"]))) events.push("TIMEOUT_60M");
  return events;
}

/** Port of market_outlook.py:2435 `dispatch_pending_signal_notifications` -- closes the state-write/send crash gap after restarts. */
export async function dispatchPendingSignalNotifications(): Promise<number> {
  const db = getDb();
  const pendingEventConditions = [
    { "notification_flags.TRACKING_STARTED": { $exists: false } },
    { first_half_r_at: { $ne: null }, "notification_flags.HALF_R_REACHED": { $exists: false } },
    { tp1_hit_at: { $ne: null }, "notification_flags.TP1_HIT": { $exists: false } },
    { tp2_hit_at: { $ne: null }, "notification_flags.TP2_HIT": { $exists: false } },
    { tp3_hit_at: { $ne: null }, "notification_flags.TP3_HIT": { $exists: false } },
    { sl_hit_at: { $ne: null }, "notification_flags.SL_HIT": { $exists: false } },
    { signal_state: { $in: Array.from(TIMEOUT_TERMINAL_STATES) }, "notification_flags.TIMEOUT_60M": { $exists: false } },
  ];
  const rows = db
    .collection("cloud_market_outlooks")
    .find({ tracking_entry_price: { $gt: 0 }, $or: pendingEventConditions }, { projection: { _id: 0 } })
    .sort({ published_at: -1 });

  let dispatched = 0;
  for await (const doc of rows) {
    for (const event of signalEventsPresent(doc)) {
      const flags = (doc["notification_flags"] as Record<string, unknown> | undefined) ?? {};
      if (!flags[event]) {
        await dispatchSignalEvent(doc, event);
        dispatched += 1;
      }
    }
  }
  return dispatched;
}

/**
 * Port of market_outlook.py:2255 `track_outlook_lifecycle_tick` --
 * restart-safe persisted signal monitor. The activity endpoint passes a
 * fresh account-specific broker quote for event-driven updates; the
 * background loop calls this with no arguments and resumes every open
 * persisted signal, including deadline processing when no fresh quote is
 * temporarily available. Uses optimistic compare-and-set (matching on
 * last_monitored_at, and additionally on analytics_outcome=null for the
 * first classification write) so two concurrent updates can never both win.
 */
export async function trackOutlookLifecycleTick(opts: {
  account?: string;
  bid?: number | null;
  ask?: number | null;
  quote_at?: unknown;
  now?: Date;
} = {}): Promise<number> {
  const { account = "", bid = null, ask = null, quote_at: quoteAt, now: nowInput } = opts;
  const db = getDb();
  const wallNow = (nowInput ? asUtc(nowInput) : null) ?? new Date();
  const outlooks = db.collection("cloud_market_outlooks");

  const query: Record<string, unknown> = {
    primary_direction: { $in: ["BUY", "SELL"] },
    tracking_entry_price: { $gt: 0 },
    monitoring_closed: { $ne: true },
  };
  if (account) query["account"] = account;

  const docsCursor = outlooks.find(query, { projection: { _id: 0 } });
  let updatedCount = 0;

  for await (const initialDoc of docsCursor) {
    let doc = initialDoc;
    let committed: [Record<string, unknown>, string[]] | null = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      const docAccount = String(doc["account"] ?? "");
      const lastMonitored = asUtc(doc["last_monitored_at"]) ?? asUtc(doc["published_quote_at"]) ?? asUtc(doc["published_at"]) ?? wallNow;

      let quoteJourney: Quote[];
      if (account) {
        const observed = asUtc(quoteAt) ?? wallNow;
        quoteJourney = observed > lastMonitored ? [[bid ?? 0, ask ?? 0, observed]] : [];
      } else {
        quoteJourney = await accountQuotesSince(docAccount, lastMonitored, wallNow);
      }

      const priceUpdates: Record<string, unknown> = {};
      const events: string[] = [];
      let merged: Record<string, unknown> = { ...doc };

      for (const [docBid, docAsk, observed] of quoteJourney) {
        const deadline = asUtc(merged["evaluation_deadline"]);
        if (deadline && observed > deadline && (merged["analytics_outcome"] === null || merged["analytics_outcome"] === undefined)) {
          const [timeoutUpdates, timeoutEvents] = advancePersistedSignal(merged, null, null, deadline);
          Object.assign(priceUpdates, timeoutUpdates);
          events.push(...timeoutEvents);
          merged = { ...merged, ...timeoutUpdates };
        }
        const [quoteUpdates, quoteEvents] = advancePersistedSignal(merged, docBid, docAsk, observed);
        Object.assign(priceUpdates, quoteUpdates);
        events.push(...quoteEvents);
        merged = { ...merged, ...quoteUpdates };
      }

      const deadline = asUtc(merged["evaluation_deadline"]);
      if (deadline && wallNow >= deadline && (merged["analytics_outcome"] === null || merged["analytics_outcome"] === undefined)) {
        const [timeoutUpdates, timeoutEvents] = advancePersistedSignal(merged, null, null, deadline);
        Object.assign(priceUpdates, timeoutUpdates);
        events.push(...timeoutEvents);
        merged = { ...merged, ...timeoutUpdates };
      }

      const changed = Object.entries(priceUpdates).some(([key, value]) => doc[key] !== value);
      if (!changed) {
        committed = [merged, []];
        break;
      }

      const updateFilter: Record<string, unknown> = { id: doc["id"], last_monitored_at: doc["last_monitored_at"] ?? null };
      if ("analytics_outcome" in priceUpdates && (doc["analytics_outcome"] === null || doc["analytics_outcome"] === undefined)) {
        updateFilter["analytics_outcome"] = null;
      }

      const result = await outlooks.updateOne(updateFilter, { $set: priceUpdates });
      if (result.modifiedCount > 0) {
        if (doc["analytics_outcome"] !== merged["analytics_outcome"]) {
          await recordRevision(
            String(doc["id"]),
            "analytics_outcome",
            doc["analytics_outcome"] ?? null,
            merged["analytics_outcome"] ?? null,
            String(merged["latest_path_event"] ?? "signal classified"),
          );
        }
        if (ANALYTICS_TERMINAL_OUTCOMES.has(String(merged["analytics_outcome"]))) {
          await persistSignalOutcome(merged);
        }
        updatedCount += 1;
        committed = [merged, Array.from(new Set(events))];
        break;
      }

      const fresh = await outlooks.findOne({ id: doc["id"] }, { projection: { _id: 0 } });
      if (!fresh || fresh["monitoring_closed"]) break;
      doc = fresh;
    }

    if (committed) {
      const [merged, committedEvents] = committed;
      for (const event of committedEvents) {
        await dispatchSignalEvent(merged, event);
      }
    }
  }

  if (!account) {
    await dispatchPendingSignalNotifications();
    try {
      const { dispatchPendingTradeNotifications } = await import("./notifications.js");
      await dispatchPendingTradeNotifications();
    } catch {
      /* best-effort, matches Python's logged-and-swallowed retry failure */
    }
    try {
      const { dispatchPendingAutomatedTradeNotifications } = await import("./automatedTradeReconciliation.js");
      await dispatchPendingAutomatedTradeNotifications();
    } catch {
      /* best-effort, matches Python's logged-and-swallowed retry failure */
    }
  }

  return updatedCount;
}
