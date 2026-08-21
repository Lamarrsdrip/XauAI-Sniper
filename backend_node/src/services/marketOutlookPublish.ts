import { randomUUID } from "node:crypto";
import { getDb } from "../db.js";
import { OUTLOOK_ACTIONABLE, OUTLOOK_BLOCKED, OUTLOOK_EXPIRED, OUTLOOK_SYMBOL, OUTLOOK_WATCHING } from "./marketOutlookCore.js";
import { canonicalM10Signal, latestEaEvidence } from "./marketOutlookEvidence.js";
import { generateOutlookForAccount } from "./marketOutlookSignal.js";
import { NAMESPACE_URL, uuidV5, uuidV5Hex } from "./uuidV5.js";
import { RETRYABLE_FAILURES, sendOutlookNotification } from "./notifications.js";
import { m10EventAsSubscriberSignal, mirrorSubscriberSignal, outlookDocAsSubscriberSignal } from "./subscriberSignalFeed.js";

/** Port of market_outlook.py:2409 `_dispatch_signal_event`. */
export async function dispatchSignalEvent(doc: Record<string, unknown>, event: string): Promise<void> {
  const flags = (doc["notification_flags"] as Record<string, unknown> | undefined) ?? {};
  if (flags[event]) return;
  const dispatchResult = await sendOutlookNotification(doc, event, "HOURLY_PLUS_RESULTS");
  if (dispatchResult === null) return;

  const db = getDb();
  const retryable = await db.collection("cloud_notification_log").findOne({
    outlook_id: doc["id"],
    notification_type: event,
    failure_reason: { $in: Array.from(RETRYABLE_FAILURES) },
  });
  if (!retryable) {
    await db.collection("cloud_market_outlooks").updateOne({ id: doc["id"] }, { $set: { [`notification_flags.${event}`]: new Date().toISOString() } });
  }
}

/** Port of market_outlook.py:1681 `publish_m10_signal_from_activity` -- persists M10 lifecycle truth, publishes only an execution-ready signal. */
export async function publishM10SignalFromActivity(licenseKey: string, account: string, sourceEventId = ""): Promise<Record<string, unknown> | null> {
  const { evidence, reason } = await latestEaEvidence(licenseKey, account, sourceEventId);
  if (!evidence) return null;
  const canonical = canonicalM10Signal(evidence);
  if (!canonical["candidate"]) return null;

  const identity = (canonical["candidate_id"] as string) || `${account}|${OUTLOOK_SYMBOL}|${canonical["bar_time"]}|${canonical["direction"]}`;
  const candidateId = (canonical["candidate_id"] as string) || uuidV5Hex(NAMESPACE_URL, identity);
  const eventState = canonical["expired"] ? OUTLOOK_EXPIRED : canonical["blocked"] ? OUTLOOK_BLOCKED : canonical["actionable"] ? OUTLOOK_ACTIONABLE : OUTLOOK_WATCHING;
  const notificationReason = canonical["actionable"]
    ? "ELIGIBLE"
    : canonical["expired"]
      ? "STALE_OR_EXPIRED_CANDIDATE"
      : canonical["blocked"]
        ? "EXECUTION_BLOCKED"
        : "CANDIDATE_NOT_EXECUTION_READY";

  const nowIso = new Date().toISOString();
  const db = getDb();
  const signalEvents = db.collection("cloud_outlook_signal_events");
  const eventDoc: Record<string, unknown> = {
    candidate_id: candidateId,
    account,
    license_key: licenseKey,
    symbol: OUTLOOK_SYMBOL,
    signal_bar_time: canonical["bar_time"],
    event_type: eventState,
    event_version: 1,
    event_time: evidence["event_time"] ?? evidence["ts"] ?? nowIso,
    source_event_id: sourceEventId || evidence["source_event_id"],
    direction: canonical["direction"],
    confidence: canonical["confidence"],
    freshness_state: canonical["freshness_state"],
    execution_status: canonical["execution_status"],
    execution_ready: Boolean(canonical["execution_ready"]),
    blocker_code: canonical["blocker_code"],
    notification_eligibility: Boolean(canonical["actionable"]),
    notification_reason: notificationReason,
    updated_at: nowIso,
  };
  await signalEvents.updateOne(
    { account, candidate_id: candidateId, event_type: eventState, event_version: 1 },
    { $set: eventDoc, $setOnInsert: { id: randomUUID(), created_at: nowIso } },
    { upsert: true },
  );
  // Keeps the subscriber "10-minute engine" view current for WATCHING/BLOCKED/EXPIRED
  // states too, not just final actionable signals. No-op for every account except
  // the configured subscriber-signal source; never affects this account's own flow.
  await mirrorSubscriberSignal(account, m10EventAsSubscriberSignal(eventDoc)).catch(() => {});

  if (!canonical["actionable"]) return null;

  const publicationKey = `m10-signal:${uuidV5Hex(NAMESPACE_URL, identity)}`;
  const doc = await generateOutlookForAccount({
    license_key: licenseKey,
    account,
    account_id: account,
    publication_key: publicationKey,
    publication_mode: "M10_SIGNAL",
    source_event_id: sourceEventId,
  });

  if (!doc) {
    await signalEvents.updateOne(
      { account, candidate_id: candidateId, event_type: OUTLOOK_ACTIONABLE, event_version: 1 },
      { $set: { notification_eligibility: false, notification_reason: "AWAITING_FRESH_PUBLICATION_QUOTE" } },
    );
    return null;
  }

  const newlyInserted = doc["_newly_inserted"] ?? true;
  delete doc["_newly_inserted"];
  if (newlyInserted && ["BUY", "SELL"].includes(String(doc["primary_direction"]))) {
    await dispatchSignalEvent(doc, "TRACKING_STARTED");
    await mirrorSubscriberSignal(account, outlookDocAsSubscriberSignal(doc, "M10_ENGINE", true)).catch(() => {});
    await signalEvents.updateOne(
      { account, candidate_id: candidateId, event_type: OUTLOOK_ACTIONABLE, event_version: 1 },
      { $set: { outlook_id: doc["id"], notification_dispatched_at: new Date().toISOString() } },
    );
    return doc;
  }
  if (!["BUY", "SELL"].includes(String(doc["primary_direction"]))) {
    await signalEvents.updateOne(
      { account, candidate_id: candidateId, event_type: OUTLOOK_ACTIONABLE, event_version: 1 },
      { $set: { notification_eligibility: false, notification_reason: "PUBLICATION_VALIDATION_FAILED", outlook_id: doc["id"] } },
    );
  }
  void reason; // evidence_reason logged in Python, no functional use here
  return null;
}
