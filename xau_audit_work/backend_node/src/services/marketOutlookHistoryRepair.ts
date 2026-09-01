import { randomUUID } from "node:crypto";
import { getDb } from "../db.js";
import {
  ANALYTICS_BREAKEVEN,
  ANALYTICS_LOSS,
  ANALYTICS_PARTIAL,
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
import { buildTrackingAnchor, fixedTpPrices, targetsHaveValidGeometry } from "./marketOutlookSignal.js";
import { advancePersistedSignal } from "./marketOutlookLifecycle.js";
import { persistSignalOutcome, recordRevision } from "./marketOutlookTick.js";

type QuoteRow = { bid: number; ask: number; at: Date };

function quoteFromActivity(row: Record<string, unknown>): QuoteRow | null {
  const thesis = ((row["details"] as Record<string, unknown> | undefined)?.["market_thesis"] as Record<string, unknown> | undefined) ?? {};
  const bid = Number(thesis["live_bid"] ?? 0);
  const ask = Number(thesis["live_ask"] ?? 0);
  const at = asUtc(row["ts"]);
  if (!at || !Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask < bid) return null;
  return { bid, ask, at };
}

async function markHistoryUnavailable(doc: Record<string, unknown>, reason: string): Promise<void> {
  const update: Record<string, unknown> = {
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
    legacy_result_before_repair: doc["final_result"] ?? null,
    historical_repaired_at: new Date().toISOString(),
    monitoring_closed: true,
  };
  await getDb().collection("cloud_market_outlooks").updateOne({ id: doc["id"] }, { $set: update });
  await recordRevision(String(doc["id"] ?? ""), "final_result", doc["final_result"], ANALYTICS_UNAVAILABLE, `historical signal excluded: ${reason}`);
}

function presentEvents(doc: Record<string, unknown>): string[] {
  const events: string[] = doc["tracking_entry_price"] ? ["TRACKING_STARTED"] : [];
  const map: Array<[string, string]> = [
    ["first_half_r_at", "HALF_R_REACHED"], ["tp1_hit_at", "TP1_HIT"], ["tp2_hit_at", "TP2_HIT"],
    ["tp3_hit_at", "TP3_HIT"], ["sl_hit_at", "SL_HIT"],
  ];
  for (const [field, event] of map) if (doc[field]) events.push(event);
  if (TIMEOUT_TERMINAL_STATES.has(String(doc["signal_state"] ?? ""))) events.push("TIMEOUT_60M");
  return events;
}

/**
 * One-shot bounded Node port of Python backfill_signal_outlook_history().
 * Never invents a timeout/loss from sparse history: a 60-minute timeout is
 * reconstructed only when persisted broker quotes cover the whole window with
 * <=10s gaps. Unreliable legacy rows are explicitly excluded from analytics.
 */
export async function backfillSignalOutlookHistory(limit = 500): Promise<Record<string, number>> {
  const db = getDb();
  const now = new Date();
  const repairRunId = randomUUID();
  const legacy = await db.collection("cloud_market_outlooks").find(
    { primary_direction: { $in: ["BUY", "SELL"] }, signal_tracking_version: { $ne: 2 } },
    { projection: { _id: 0 } },
  ).sort({ generated_at: 1 }).limit(limit).toArray();

  const report: Record<string, number> = {
    examined: legacy.length, reconstructed: 0, wins: 0, losses: 0,
    partial_profits: 0, breakevens: 0, active: 0, unavailable: 0,
  };

  for (const old of legacy as Record<string, unknown>[]) {
    const published = asUtc(old["published_at"] ?? old["generated_at"]);
    const sl = Number(old["original_sl"] ?? old["suggested_sl"] ?? 0);
    const account = String(old["account"] ?? "");
    if (!published || !account || !Number.isFinite(sl) || sl <= 0) {
      await markHistoryUnavailable(old, "missing publication timestamp, account, or original SL"); report.unavailable!++; continue;
    }
    const deadline = new Date(published.getTime() + OUTLOOK_EVALUATION_MINUTES * 60_000);
    const horizonEnd = new Date(published.getTime() + OUTLOOK_HORIZON_HOURS * 3_600_000);
    const end = new Date(Math.min(now.getTime(), horizonEnd.getTime()));
    const rows = await db.collection("cloud_bot_activity").find({
      account,
      ts: { $gte: new Date(published.getTime() - 120_000).toISOString(), $lte: end.toISOString() },
      "details.market_thesis.live_bid": { $gt: 0 },
      "details.market_thesis.live_ask": { $gt: 0 },
    }, { projection: { _id: 0, ts: 1, "details.market_thesis.live_bid": 1, "details.market_thesis.live_ask": 1 } })
      .sort({ ts: 1 }).limit(5000).toArray();
    const usable = (rows as Record<string, unknown>[]).map(quoteFromActivity).filter((q): q is QuoteRow => q !== null);
    if (!usable.length) { await markHistoryUnavailable(old, "no stored broker Bid/Ask history"); report.unavailable!++; continue; }
    const anchorCandidates = usable.filter((q) => q.at <= published);
    if (!anchorCandidates.length) { await markHistoryUnavailable(old, "no stored executable quote at or before publication"); report.unavailable!++; continue; }
    const anchor = anchorCandidates[anchorCandidates.length - 1]!;
    if ((published.getTime() - anchor.at.getTime()) / 1000 > MAX_HISTORICAL_ANCHOR_AGE_SECONDS) {
      await markHistoryUnavailable(old, "no reliable publication quote within 90 seconds before publication"); report.unavailable!++; continue;
    }
    const direction = String(old["primary_direction"] ?? "");
    const tracking = buildTrackingAnchor(direction, anchor.bid, anchor.ask, sl);
    if (!tracking) { await markHistoryUnavailable(old, "publication quote and original SL have invalid directional geometry"); report.unavailable!++; continue; }
    const [tp1, tp2, tp3] = fixedTpPrices(direction, tracking.tracking_entry_price);
    if (!targetsHaveValidGeometry(direction, tracking.tracking_entry_price, tp1, tp2, tp3)) {
      await markHistoryUnavailable(old, "reconstructed entry price and fixed TP grid have invalid directional geometry"); report.unavailable!++; continue;
    }

    const working: Record<string, unknown> = {
      ...old,
      published_at: published.toISOString(), published_bid: anchor.bid, published_ask: anchor.ask,
      published_spread: anchor.ask - anchor.bid, published_quote_at: anchor.at.toISOString(),
      tracking_entry_price: tracking.tracking_entry_price, original_sl: sl, risk_distance: tracking.risk_distance,
      tp1_price: tp1, tp2_price: tp2, tp3_price: tp3,
      legacy_tp1_price_before_repair: old["tp1_price"] ?? null, legacy_tp2_price_before_repair: old["tp2_price"] ?? null,
      evaluation_deadline: deadline.toISOString(), signal_tracking_version: 2,
      signal_state: SIGNAL_TRACKING, analytics_outcome: null, analytics_r: null,
      current_r: tracking.current_r, mfe_r: tracking.mfe_r, mae_r: tracking.mae_r, mfe: tracking.mfe_r, mae: tracking.mae_r,
      highest_tracked_price: tracking.highest_tracked_price, lowest_tracked_price: tracking.lowest_tracked_price,
      last_bid: tracking.last_bid, last_ask: tracking.last_ask, last_tracked_price: tracking.last_tracked_price,
      last_monitored_at: anchor.at.toISOString(), first_half_r_at: null, tp1_hit_at: null, tp2_hit_at: null,
      tp3_hit_at: null, sl_hit_at: null, classification_at: null, latest_path_event: "TRACKING_STARTED",
      monitoring_closed: false, color_state: "AMBER", status: "TRACKING", milestones_hit: [],
      event_snapshots: { TRACKING_STARTED: { event_at: published.toISOString(), hit_price: tracking.tracking_entry_price, achieved_r: tracking.current_r } },
      final_result: null, final_r: null, resolved_at: null, legacy_result_before_repair: old["final_result"] ?? null,
      activation: { activated: true, activated_at: published.toISOString(), activated_price: tracking.tracking_entry_price },
      excluded_from_signal_analytics: false,
    };

    const inWindow = usable.filter((q) => q.at >= published && q.at <= deadline);
    let coverageReliable = false;
    if (inWindow.length && deadline <= now) {
      let maxGap = 0;
      for (let i = 1; i < inWindow.length; i++) maxGap = Math.max(maxGap, (inWindow[i]!.at.getTime() - inWindow[i - 1]!.at.getTime()) / 1000);
      coverageReliable = inWindow[0]!.at.getTime() <= published.getTime() + MAX_HISTORICAL_QUOTE_GAP_SECONDS * 1000
        && inWindow[inWindow.length - 1]!.at.getTime() >= deadline.getTime() - MAX_HISTORICAL_QUOTE_GAP_SECONDS * 1000
        && maxGap <= MAX_HISTORICAL_QUOTE_GAP_SECONDS;
    }

    let unavailable = false;
    for (const quote of usable) {
      if (quote.at < published || quote.at > end) continue;
      if (quote.at > deadline && working["analytics_outcome"] == null) {
        if (!coverageReliable) { await markHistoryUnavailable(old, "stored quotes do not reliably cover the full 60-minute window"); report.unavailable!++; unavailable = true; break; }
        const [update] = advancePersistedSignal(working, null, null, deadline); Object.assign(working, update);
      }
      const [update] = advancePersistedSignal(working, quote.bid, quote.ask, quote.at); Object.assign(working, update);
      if (TIMEOUT_TERMINAL_STATES.has(String(working["signal_state"] ?? "")) && !coverageReliable) {
        await markHistoryUnavailable(old, "stored quotes do not reliably cover the full 60-minute window"); report.unavailable!++; unavailable = true; break;
      }
      if (working["monitoring_closed"]) break;
    }
    if (unavailable) continue;
    if (deadline <= now && working["analytics_outcome"] == null) {
      if (!coverageReliable) { await markHistoryUnavailable(old, "stored quotes do not reliably cover the full 60-minute window"); report.unavailable!++; continue; }
      const [update] = advancePersistedSignal(working, null, null, deadline); Object.assign(working, update);
    }

    working["historical_repair_status"] = "RECONSTRUCTED";
    working["historical_repaired_at"] = now.toISOString();
    working["notification_flags"] = Object.fromEntries(presentEvents(working).map((event) => [event, "BACKFILL_SUPPRESSED"]));
    const persist = { ...working }; delete persist["_id"];
    await db.collection("cloud_market_outlooks").updateOne({ id: old["id"] }, { $set: persist });
    await recordRevision(String(old["id"] ?? ""), "final_result", old["final_result"], working["final_result"], "v2 signal lifecycle reconstructed from persisted broker quotes");
    await persistSignalOutcome(working);
    report.reconstructed!++;
    if (working["analytics_outcome"] === ANALYTICS_WIN) report.wins!++;
    else if (working["analytics_outcome"] === ANALYTICS_LOSS) report.losses!++;
    else if (working["analytics_outcome"] === ANALYTICS_PARTIAL) report.partial_profits!++;
    else if (working["analytics_outcome"] === ANALYTICS_BREAKEVEN) report.breakevens!++;
    else report.active!++;
  }

  await db.collection("cloud_market_outlook_repair_runs").insertOne({
    id: repairRunId, started_at: now.toISOString(), completed_at: new Date().toISOString(), tracking_version: 2, report,
  });
  return report;
}
