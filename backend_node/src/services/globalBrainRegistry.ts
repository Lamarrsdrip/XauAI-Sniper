import { randomUUID } from "node:crypto";
import { getDb } from "../db.js";
import {
  GLOBAL_BRAIN_MODELS_COLLECTION,
  GLOBAL_BRAIN_PROMOTIONS_COLLECTION,
} from "../models/globalBrain.js";
import type { BucketedEstimatorResult } from "./globalBrainEstimator.js";
import type { ModelMetrics } from "./globalBrainPromotion.js";

/**
 * Champion/challenger model registry. Deliberately Mongo-document-based
 * rather than a single-file-plus-atomic-rename like
 * services/releaseManifest.ts (the EA-binary release registry) -- model
 * doc content is small and data-driven (bucket tables + metrics), not a
 * binary artifact needing filesystem integrity checks, but the SAME
 * principles are reused: every promotion/rejection/rollback is
 * audit-logged, and rollback walks that audit log to find the last-known-good
 * version rather than trusting a single mutable pointer.
 */

export type ModelStatus = "CHAMPION" | "CHALLENGER" | "REJECTED" | "SUPERSEDED" | "ROLLED_BACK";

export interface GlobalBrainModelDoc {
  question: string;
  version: number;
  status: ModelStatus;
  trained_at: string;
  training_window: { from: string | null; to: string | null; n: number };
  dataset_fingerprint: string;
  validation_metrics: ModelMetrics;
  holdout_metrics: ModelMetrics;
  buckets: BucketedEstimatorResult;
  promotion_reason: string;
  promoted_at: string | null;
  /** Evidence-based maturity bookkeeping (see globalBrainMaturity.ts). True only when this cycle's holdout fell in the multi-cycle band (below MIN_HOLDOUT_SAMPLE, at/above MIN_HOLDOUT_SAMPLE_FLOOR) AND cleared the same statistical effect-size bar the fast path uses. */
  meets_small_sample_criteria: boolean;
  /** Consecutive qualifying cycles ending at (and including) this one, on genuinely new data each time; 0 if this cycle did not qualify or took the fast path. */
  streak_count: number;
  maturity_path: "FAST_PATH" | "MULTI_CYCLE" | "INSUFFICIENT_EVIDENCE";
}

export interface PromotionAuditEntry {
  question: string;
  action: "PROMOTE" | "REJECT" | "ROLLBACK";
  from_version: number | null;
  to_version: number | null;
  reason: string;
  at: string;
}

export class RollbackError extends Error {}
export class RegistryLockError extends Error {}

const GLOBAL_BRAIN_LOCKS_COLLECTION = "global_brain_registry_locks";
const LOCK_STALE_AFTER_MS = 30_000; // generous vs. this operation's expected near-instant duration; only matters if a process crashed mid-lock

export async function ensureGlobalBrainRegistryIndexes(): Promise<void> {
  const db = getDb();
  await db.collection(GLOBAL_BRAIN_MODELS_COLLECTION).createIndex({ question: 1, version: 1 }, { unique: true });
  await db.collection(GLOBAL_BRAIN_MODELS_COLLECTION).createIndex({ question: 1, status: 1 });
  await db.collection(GLOBAL_BRAIN_PROMOTIONS_COLLECTION).createIndex({ question: 1, at: -1 });
}

/**
 * Per-question mutual exclusion for champion-pointer mutations, same
 * atomicity trick as routes/cloud/reservation.ts's cross-instance claim: an
 * upsert filter that only matches an ALREADY-expired lock fails with a
 * duplicate-key error when a live lock already holds that `_id` -- there is
 * no read-then-write race window. Closes a real race an adversarial review
 * found: two concurrent promotions for the same question (e.g. the daily
 * cron and a manual admin "run cycle" click) could otherwise both demote
 * the same prior champion and both insert a new CHAMPION doc, leaving two
 * champions (or, after a concurrent rollback, zero).
 */
async function withQuestionLock<T>(question: string, fn: () => Promise<T>): Promise<T> {
  const db = getDb();
  const lockId = `lock:${question}`;
  const now = Date.now();
  const holderId = randomUUID();
  try {
    await db
      .collection(GLOBAL_BRAIN_LOCKS_COLLECTION)
      .updateOne({ _id: lockId as unknown as never, acquired_at: { $lt: now - LOCK_STALE_AFTER_MS } }, { $set: { acquired_at: now, holder_id: holderId } }, { upsert: true });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      throw new RegistryLockError(`Global Brain registry for question "${question}" is already being updated by a concurrent operation. Try again shortly.`);
    }
    throw error;
  }
  try {
    return await fn();
  } finally {
    await db.collection(GLOBAL_BRAIN_LOCKS_COLLECTION).deleteOne({ _id: lockId as unknown as never, holder_id: holderId }).catch(() => undefined);
  }
}

export async function getCurrentChampion(question: string): Promise<GlobalBrainModelDoc | null> {
  return getDb()
    .collection<GlobalBrainModelDoc>(GLOBAL_BRAIN_MODELS_COLLECTION)
    .findOne({ question, status: "CHAMPION" }, { projection: { _id: 0 } });
}

/** Most recent model doc for a question REGARDLESS of status -- the multi-cycle maturity streak (globalBrainMaturity.ts) is carried on whatever the last cycle produced (CHAMPION or REJECTED), not only on the current champion. */
export async function getLatestModelDoc(question: string): Promise<GlobalBrainModelDoc | null> {
  const docs = await getDb()
    .collection<GlobalBrainModelDoc>(GLOBAL_BRAIN_MODELS_COLLECTION)
    .find({ question }, { projection: { _id: 0 } })
    .sort({ version: -1 })
    .limit(1)
    .toArray();
  return docs[0] ?? null;
}

async function nextVersion(question: string): Promise<number> {
  const latest = await getDb()
    .collection<GlobalBrainModelDoc>(GLOBAL_BRAIN_MODELS_COLLECTION)
    .find({ question }, { projection: { _id: 0, version: 1 } })
    .sort({ version: -1 })
    .limit(1)
    .toArray();
  return (latest[0]?.version ?? 0) + 1;
}

async function writeAudit(entry: PromotionAuditEntry): Promise<void> {
  await getDb().collection(GLOBAL_BRAIN_PROMOTIONS_COLLECTION).insertOne(entry);
}

export interface NewModelInput {
  question: string;
  trained_at: string;
  training_window: { from: string | null; to: string | null; n: number };
  dataset_fingerprint: string;
  validation_metrics: ModelMetrics;
  holdout_metrics: ModelMetrics;
  buckets: BucketedEstimatorResult;
  meets_small_sample_criteria: boolean;
  streak_count: number;
  maturity_path: "FAST_PATH" | "MULTI_CYCLE" | "INSUFFICIENT_EVIDENCE";
}

/** Persists a challenger as CHAMPION, demoting the prior champion (if any) to SUPERSEDED, and writes an audit entry. Never deletes the prior champion doc -- it remains queryable by version for rollback. Locked per-question so two concurrent promotions (e.g. the daily cron and a manual admin trigger) can never both demote the same prior champion or race on the next version number. */
export async function promoteChallenger(input: NewModelInput, reason: string): Promise<GlobalBrainModelDoc> {
  return withQuestionLock(input.question, async () => {
    const db = getDb();
    const collection = db.collection<GlobalBrainModelDoc>(GLOBAL_BRAIN_MODELS_COLLECTION);
    const priorChampion = await getCurrentChampion(input.question);
    if (priorChampion) {
      await collection.updateOne({ question: input.question, version: priorChampion.version }, { $set: { status: "SUPERSEDED" } });
    }
    const version = await nextVersion(input.question);
    const doc: GlobalBrainModelDoc = {
      question: input.question,
      version,
      status: "CHAMPION",
      trained_at: input.trained_at,
      training_window: input.training_window,
      dataset_fingerprint: input.dataset_fingerprint,
      validation_metrics: input.validation_metrics,
      holdout_metrics: input.holdout_metrics,
      buckets: input.buckets,
      promotion_reason: reason,
      promoted_at: new Date().toISOString(),
      meets_small_sample_criteria: input.meets_small_sample_criteria,
      streak_count: input.streak_count,
      maturity_path: input.maturity_path,
    };
    await collection.insertOne(doc);
    await writeAudit({
      question: input.question,
      action: "PROMOTE",
      from_version: priorChampion?.version ?? null,
      to_version: version,
      reason,
      at: new Date().toISOString(),
    });
    return doc;
  });
}

/** Persists a challenger as REJECTED for audit history. Champion untouched. */
export async function rejectChallenger(input: NewModelInput, reason: string): Promise<GlobalBrainModelDoc> {
  return withQuestionLock(input.question, async () => {
    const collection = getDb().collection<GlobalBrainModelDoc>(GLOBAL_BRAIN_MODELS_COLLECTION);
    const version = await nextVersion(input.question);
    const doc: GlobalBrainModelDoc = {
      question: input.question,
      version,
      status: "REJECTED",
      trained_at: input.trained_at,
      training_window: input.training_window,
      dataset_fingerprint: input.dataset_fingerprint,
      validation_metrics: input.validation_metrics,
      holdout_metrics: input.holdout_metrics,
      buckets: input.buckets,
      promotion_reason: reason,
      promoted_at: null,
      meets_small_sample_criteria: input.meets_small_sample_criteria,
      streak_count: input.streak_count,
      maturity_path: input.maturity_path,
    };
    await collection.insertOne(doc);
    await writeAudit({ question: input.question, action: "REJECT", from_version: null, to_version: version, reason, at: new Date().toISOString() });
    return doc;
  });
}

/** Walks the audit log for the most recent PROMOTE entry's from_version (the champion immediately before the current one) and restores it. Fails loudly -- never silently no-ops -- if there is nothing to roll back to. Locked per-question, same reason as promoteChallenger. */
export async function rollbackToPreviousChampion(question: string): Promise<GlobalBrainModelDoc> {
  return withQuestionLock(question, async () => {
    const db = getDb();
    // Sorted by to_version (monotonic per question), not by wall-clock `at` --
    // two promotions issued in rapid succession can share a millisecond-
    // resolution timestamp, which would make an `at`-sort pick the wrong
    // "most recent" entry and roll back to the wrong version.
    const lastPromote = await db
      .collection<PromotionAuditEntry>(GLOBAL_BRAIN_PROMOTIONS_COLLECTION)
      .find({ question, action: "PROMOTE" }, { projection: { _id: 0 } })
      .sort({ to_version: -1 })
      .limit(1)
      .toArray();
    const entry = lastPromote[0];
    if (!entry || entry.from_version === null) {
      throw new RollbackError(`No previous champion exists for question "${question}" to roll back to.`);
    }
    const collection = db.collection<GlobalBrainModelDoc>(GLOBAL_BRAIN_MODELS_COLLECTION);
    const previous = await collection.findOne({ question, version: entry.from_version }, { projection: { _id: 0 } });
    if (!previous) throw new RollbackError(`Previous champion version ${entry.from_version} for "${question}" no longer exists.`);

    const current = await getCurrentChampion(question);
    if (current) {
      await collection.updateOne({ question, version: current.version }, { $set: { status: "ROLLED_BACK" } });
    }
    await collection.updateOne({ question, version: previous.version }, { $set: { status: "CHAMPION" } });
    await writeAudit({
      question,
      action: "ROLLBACK",
      from_version: current?.version ?? null,
      to_version: previous.version,
      reason: `Manual rollback to version ${previous.version}.`,
      at: new Date().toISOString(),
    });
    return { ...previous, status: "CHAMPION" };
  });
}

export async function listPromotionHistory(question: string | null, limit = 50): Promise<PromotionAuditEntry[]> {
  const query = question ? { question } : {};
  return getDb()
    .collection<PromotionAuditEntry>(GLOBAL_BRAIN_PROMOTIONS_COLLECTION)
    .find(query, { projection: { _id: 0 } })
    .sort({ at: -1 })
    .limit(limit)
    .toArray();
}
