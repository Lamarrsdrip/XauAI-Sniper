import { randomUUID } from "node:crypto";
import { getDb } from "../db.js";
import {
  ANALYTICS_BREAKEVEN,
  ANALYTICS_LOSS,
  ANALYTICS_PARTIAL,
  ANALYTICS_TERMINAL_OUTCOMES,
  ANALYTICS_UNAVAILABLE,
  ANALYTICS_WIN,
  MAX_HISTORICAL_ANCHOR_AGE_SECONDS,
  MAX_HISTORICAL_QUOTE_GAP_SECONDS,
  OUTLOOK_EVALUATION_MINUTES,
  OUTLOOK_HORIZON_HOURS,
  SIGNAL_TRACKING,
  TIMEOUT_TERMINAL_STATES,
} from "./marketOutlookCore.js";
import { asUtc } from "./marketOutlookEvidence.js";
import { MARKET_EVIDENCE_COLLECTION } from "./marketIntelligenceConfig.js";
import { advancePersistedSignal } from "./marketOutlookLifecycle.js";
import { buildTrackingAnchor, fixedTpPrices, targetsHaveValidGeometry } from "./marketOutlookSignal.js";

type Doc = Record<string, unknown>;
type Quote = { bid: number; ask: number; at: Date };

function accountVariants(accountInput: string): Array<string | number> {
  const account = String(accountInput ?? "").trim();
  if (!account) return [];
  const values: Array<string | number> = [account];
  const numeric = Number(account);
  if (Number.isFinite(numeric) && Number.isSafeInteger(numeric)) values.push(numeric);
  return values;
}

export interface OutlookHistoryRepairReport {
  examined: number;
  reconstructed: number;
  wins: number;
  losses: number;
  partial_profits: number;
  breakevens: number;
  active: number;
  unavailable: number;
}

async function revision(doc: Doc, next: unknown, reason: string): Promise<void> {
  await getDb().collection("cloud_market_outlook_revisions").insertOne({
    id: randomUUID(),
    outlook_id: doc["id"],
    revision_time: new Date().toISOString(),
    field: "final_result",
    previous_value: doc["final_result"],
    new_value: next,
    reason,
  });
}

async function markUnavailable(doc: Doc, reason: string): Promise<void> {
  const now = new Date().toISOString();
  const update = {
    signal_tracking_version: 2,
    signal_state: ANALYTICS_UNAVAILABLE,
    historical_repair_status: ANALYTICS_UNAVAILABLE,
    historical_data_unavailable_reason: reason,
    analytics_outcome: ANALYTICS_UNAVAILABLE,
    analytics_r: null,
    final_r: null,
    final_result: ANALYTICS_UNAVAILABLE,
    color_state: "GRAY",
    status: ANALYTICS_UNAVAILABLE,
    excluded_from_signal_analytics: true,
    legacy_result_before_repair: doc["final_result"],
    historical_repaired_at: now,
    monitoring_closed: true,
  };
  await getDb().collection("cloud_market_outlooks").updateOne({ id: doc["id"] }, { $set: update });
  await revision(doc, ANALYTICS_UNAVAILABLE, "historical signal excluded: " + reason);
}

async function persistOutcome(doc: Doc): Promise<void> {
  if (!ANALYTICS_TERMINAL_OUTCOMES.has(String(doc["analytics_outcome"] ?? ""))) return;
  const value = {
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
    historical_backfill: true,
  };
  await getDb().collection("cloud_market_outlook_outcomes").updateOne(
    { outlook_id: doc["id"] },
    { $set: value, $setOnInsert: { id: randomUUID() } },
    { upsert: true },
  );
}

function eventFlags(doc: Doc): Record<string, string> {
  const names: string[] = doc["tracking_entry_price"] ? ["TRACKING_STARTED"] : [];
  const fields: [string, string][] = [
    ["first_half_r_at", "HALF_R_REACHED"],
    ["tp1_hit_at", "TP1_HIT"],
    ["tp2_hit_at", "TP2_HIT"],
    ["tp3_hit_at", "TP3_HIT"],
    ["sl_hit_at", "SL_HIT"],
  ];
  for (const [field, name] of fields) if (doc[field]) names.push(name);
  if (TIMEOUT_TERMINAL_STATES.has(String(doc["signal_state"] ?? ""))) names.push("TIMEOUT_60M");
  return Object.fromEntries(names.map((name) => [name, "BACKFILL_SUPPRESSED"]));
}

async function quotesFor(account: string, start: Date, end: Date): Promise<Quote[]> {
  const db = getDb();
  const accountIds = accountVariants(account);
  const accountQuery = accountIds.length > 1 ? { $in: accountIds } : accountIds[0];
  const ledgerRows = await db.collection(MARKET_EVIDENCE_COLLECTION)
    .find(
      { account: accountQuery, quote_valid: true, observed_at: { $gte: start.toISOString(), $lte: end.toISOString() } },
      { projection: { _id: 0, observed_at: 1, bid: 1, ask: 1 } },
    )
    .sort({ observed_at: 1 })
    .limit(20000)
    .toArray();

  const ledger = ledgerRows.flatMap((row) => {
    const at = asUtc(row["observed_at"]);
    const bid = Number(row["bid"] ?? 0);
    const ask = Number(row["ask"] ?? 0);
    return at && bid > 0 && ask >= bid ? [{ bid, ask, at }] : [];
  });
  if (ledger.length) return ledger;

  const activityRows = await db.collection("cloud_bot_activity")
    .find(
      {
        account: accountQuery,
        ts: { $gte: start.toISOString(), $lte: end.toISOString() },
        "details.market_thesis.live_bid": { $gt: 0 },
        "details.market_thesis.live_ask": { $gt: 0 },
      },
      { projection: { _id: 0, ts: 1, "details.market_thesis.live_bid": 1, "details.market_thesis.live_ask": 1 } },
    )
    .sort({ ts: 1 })
    .limit(5000)
    .toArray();

  return activityRows.flatMap((row) => {
    const details = (row["details"] as Doc | undefined) ?? {};
    const thesis = (details["market_thesis"] as Doc | undefined) ?? {};
    const at = asUtc(row["ts"]);
    const bid = Number(thesis["live_bid"] ?? 0);
    const ask = Number(thesis["live_ask"] ?? 0);
    return at && bid > 0 && ask >= bid ? [{ bid, ask, at }] : [];
  });
}

function reliableCoverage(quotes: Quote[], published: Date, deadline: Date): boolean {
  const window = quotes.filter((q) => q.at >= published && q.at <= deadline);
  if (!window.length) return false;
  let maxGap = 0;
  for (let i = 1; i < window.length; i++) {
    maxGap = Math.max(maxGap, window[i]!.at.getTime() - window[i - 1]!.at.getTime());
  }
  return (
    window[0]!.at.getTime() <= published.getTime() + MAX_HISTORICAL_QUOTE_GAP_SECONDS * 1000 &&
    window[window.length - 1]!.at.getTime() >= deadline.getTime() - MAX_HISTORICAL_QUOTE_GAP_SECONDS * 1000 &&
    maxGap <= MAX_HISTORICAL_QUOTE_GAP_SECONDS * 1000
  );
}

/**
 * Production Node parity for the Python historical Outlook repair.
 * Legacy BUY/SELL rows are reconstructed only from persisted broker Bid/Ask.
 * Sparse or missing evidence becomes HISTORICAL_DATA_UNAVAILABLE, never a
 * fabricated loss. The migration is idempotent via signal_tracking_version=2.
 */
export async function backfillSignalOutlookHistory(limit = 500): Promise<OutlookHistoryRepairReport> {
  const db = getDb();
  const now = new Date();
  const legacy = await db.collection("cloud_market_outlooks")
    .find(
      { primary_direction: { $in: ["BUY", "SELL"] }, signal_tracking_version: { $ne: 2 } },
      { projection: { _id: 0 } },
    )
    .sort({ generated_at: 1 })
    .limit(limit)
    .toArray();

  const report: OutlookHistoryRepairReport = {
    examined: legacy.length,
    reconstructed: 0,
    wins: 0,
    losses: 0,
    partial_profits: 0,
    breakevens: 0,
    active: 0,
    unavailable: 0,
  };

  for (const old of legacy) {
    const published = asUtc(old["published_at"] ?? old["generated_at"]);
    const account = String(old["account"] ?? "").trim();
    const sl = Number(old["original_sl"] ?? old["suggested_sl"] ?? 0) || 0;
    if (!published || !account || sl <= 0) {
      await markUnavailable(old, "missing publication timestamp, account, or original SL");
      report.unavailable += 1;
      continue;
    }

    const deadline = new Date(published.getTime() + OUTLOOK_EVALUATION_MINUTES * 60000);
    const horizon = new Date(published.getTime() + OUTLOOK_HORIZON_HOURS * 3600000);
    const end = new Date(Math.min(now.getTime(), horizon.getTime()));
    const quotes = await quotesFor(account, new Date(published.getTime() - 120000), end);
    if (!quotes.length) {
      await markUnavailable(old, "no stored broker Bid/Ask history");
      report.unavailable += 1;
      continue;
    }

    const anchor = quotes.filter((q) => q.at <= published).at(-1);
    if (!anchor) {
      await markUnavailable(old, "no stored executable quote at or before publication");
      report.unavailable += 1;
      continue;
    }
    if (published.getTime() - anchor.at.getTime() > MAX_HISTORICAL_ANCHOR_AGE_SECONDS * 1000) {
      await markUnavailable(old, "no reliable publication quote within 90 seconds before publication");
      report.unavailable += 1;
      continue;
    }

    const direction = String(old["primary_direction"] ?? "").toUpperCase();
    const tracking = buildTrackingAnchor(direction, anchor.bid, anchor.ask, sl);
    if (!tracking) {
      await markUnavailable(old, "publication quote and original SL have invalid directional geometry");
      report.unavailable += 1;
      continue;
    }
    const [tp1, tp2, tp3] = fixedTpPrices(direction, tracking.tracking_entry_price);
    if (!targetsHaveValidGeometry(direction, tracking.tracking_entry_price, tp1, tp2, tp3)) {
      await markUnavailable(old, "reconstructed entry price and fixed TP grid have invalid directional geometry");
      report.unavailable += 1;
      continue;
    }

    let working: Doc = {
      ...old,
      published_at: published.toISOString(),
      published_bid: anchor.bid,
      published_ask: anchor.ask,
      published_spread: anchor.ask - anchor.bid,
      published_quote_at: anchor.at.toISOString(),
      ...tracking,
      tp1_price: tp1,
      tp2_price: tp2,
      tp3_price: tp3,
      legacy_tp1_price_before_repair: old["tp1_price"],
      legacy_tp2_price_before_repair: old["tp2_price"],
      evaluation_deadline: deadline.toISOString(),
      signal_tracking_version: 2,
      signal_state: SIGNAL_TRACKING,
      analytics_outcome: null,
      analytics_r: null,
      mfe: tracking.mfe_r,
      mae: tracking.mae_r,
      last_monitored_at: anchor.at.toISOString(),
      first_half_r_at: null,
      tp1_hit_at: null,
      tp2_hit_at: null,
      tp3_hit_at: null,
      sl_hit_at: null,
      classification_at: null,
      latest_path_event: "TRACKING_STARTED",
      monitoring_closed: false,
      color_state: "AMBER",
      status: "TRACKING",
      milestones_hit: [],
      event_snapshots: {
        TRACKING_STARTED: {
          event_at: published.toISOString(),
          hit_price: tracking.tracking_entry_price,
          achieved_r: tracking.current_r,
        },
      },
      final_result: null,
      final_r: null,
      resolved_at: null,
      legacy_result_before_repair: old["final_result"],
      activation: {
        activated: true,
        activated_at: published.toISOString(),
        activated_price: tracking.tracking_entry_price,
      },
      excluded_from_signal_analytics: false,
    };

    const coverage = deadline <= now && reliableCoverage(quotes, published, deadline);
    let unavailable = false;
    for (const q of quotes) {
      if (q.at < published || q.at > end) continue;
      if (q.at > deadline && working["analytics_outcome"] == null) {
        if (!coverage) {
          await markUnavailable(old, "stored quotes do not reliably cover the full 60-minute window");
          report.unavailable += 1;
          unavailable = true;
          break;
        }
        const [deadlineUpdate] = advancePersistedSignal(working, null, null, deadline);
        working = { ...working, ...deadlineUpdate };
      }

      const [quoteUpdate] = advancePersistedSignal(working, q.bid, q.ask, q.at);
      working = { ...working, ...quoteUpdate };

      if (TIMEOUT_TERMINAL_STATES.has(String(working["signal_state"] ?? "")) && !coverage) {
        await markUnavailable(old, "stored quotes do not reliably cover the full 60-minute window");
        report.unavailable += 1;
        unavailable = true;
        break;
      }
      if (working["monitoring_closed"] === true) break;
    }
    if (unavailable) continue;

    if (deadline <= now && working["analytics_outcome"] == null) {
      if (!coverage) {
        await markUnavailable(old, "stored quotes do not reliably cover the full 60-minute window");
        report.unavailable += 1;
        continue;
      }
      const [deadlineUpdate] = advancePersistedSignal(working, null, null, deadline);
      working = { ...working, ...deadlineUpdate };
    }

    working = {
      ...working,
      historical_repair_status: "RECONSTRUCTED",
      historical_repaired_at: now.toISOString(),
      notification_flags: eventFlags(working),
    };
    const { _id: ignored, ...persist } = working;
    void ignored;
    await db.collection("cloud_market_outlooks").updateOne({ id: old["id"] }, { $set: persist });
    await revision(old, working["final_result"], "v2 signal lifecycle reconstructed from persisted broker quotes");
    await persistOutcome(working);

    report.reconstructed += 1;
    if (working["analytics_outcome"] === ANALYTICS_WIN) report.wins += 1;
    else if (working["analytics_outcome"] === ANALYTICS_LOSS) report.losses += 1;
    else if (working["analytics_outcome"] === ANALYTICS_PARTIAL) report.partial_profits += 1;
    else if (working["analytics_outcome"] === ANALYTICS_BREAKEVEN) report.breakevens += 1;
    else report.active += 1;
  }

  await db.collection("cloud_market_outlook_repair_runs").insertOne({
    id: randomUUID(),
    started_at: now.toISOString(),
    completed_at: new Date().toISOString(),
    tracking_version: 2,
    report,
  });
  return report;
}


/**
 * Drain the full legacy backlog in bounded batches. The previous startup call
 * processed only the oldest 500 rows once, so accounts later in the collection
 * could stay permanently unrepaired until another process restart.
 */
export async function backfillAllSignalOutlookHistory(
  batchSize = 500,
  maxBatches = 20,
): Promise<OutlookHistoryRepairReport & { batches: number; backlog_remaining: boolean }> {
  const total: OutlookHistoryRepairReport & { batches: number; backlog_remaining: boolean } = {
    examined: 0,
    reconstructed: 0,
    wins: 0,
    losses: 0,
    partial_profits: 0,
    breakevens: 0,
    active: 0,
    unavailable: 0,
    batches: 0,
    backlog_remaining: false,
  };

  const safeBatch = Math.max(1, Math.min(Math.trunc(batchSize), 1000));
  const safeMax = Math.max(1, Math.min(Math.trunc(maxBatches), 100));

  for (let i = 0; i < safeMax; i += 1) {
    const report = await backfillSignalOutlookHistory(safeBatch);
    total.batches += 1;
    for (const key of ["examined", "reconstructed", "wins", "losses", "partial_profits", "breakevens", "active", "unavailable"] as const) {
      total[key] += report[key];
    }
    if (report.examined < safeBatch) {
      total.backlog_remaining = false;
      return total;
    }
  }

  total.backlog_remaining = await getDb().collection("cloud_market_outlooks").countDocuments({
    primary_direction: { $in: ["BUY", "SELL"] },
    signal_tracking_version: { $ne: 2 },
  }) > 0;
  return total;
}
