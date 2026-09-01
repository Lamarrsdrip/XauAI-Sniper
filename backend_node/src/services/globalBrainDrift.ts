import { getDb } from "../db.js";
import type { ModelMetrics } from "./globalBrainPromotion.js";

/**
 * Drift monitoring: a promoted champion's performance can degrade after
 * promotion as market conditions shift, even though nothing about the
 * model itself changed. This is deliberately ALERT-ONLY -- it never
 * auto-rolls-back a champion. An automatic rollback triggered by a
 * noisy metric swing would itself be an unvalidated "instant behavior
 * change from one bad signal," exactly what the spec's safety principles
 * forbid; a human reviewing the alert and using the existing
 * POST /admin/global-brain/rollback endpoint is the intended response.
 */

export const GLOBAL_BRAIN_DRIFT_ALERTS_COLLECTION = "global_brain_drift_alerts";

// Looser than the promotion gate's DEGRADATION_TOLERANCE (0.01) -- drift
// monitoring is a warning signal for a human to look at, not a strict gate,
// so it should not fire on ordinary sampling noise between cycles.
export const DRIFT_BRIER_THRESHOLD = 0.05;
export const DRIFT_AVG_R_THRESHOLD = 0.15;
export const DRIFT_MIN_SAMPLE = 20;

export interface DriftCheckResult {
  drifted: boolean;
  reason: string;
}

/** Pure comparison: the champion's metrics AT PROMOTION TIME vs. its metrics re-scored on the CURRENT holdout. */
export function detectDrift(currentMetrics: ModelMetrics, recordedMetrics: ModelMetrics): DriftCheckResult {
  if (currentMetrics.holdout_n < DRIFT_MIN_SAMPLE) {
    return { drifted: false, reason: `Not enough current data to assess drift (n=${currentMetrics.holdout_n}, need ${DRIFT_MIN_SAMPLE}).` };
  }
  const brierDelta = currentMetrics.brier_score - recordedMetrics.brier_score;
  const avgRDelta = currentMetrics.avg_r_captured - recordedMetrics.avg_r_captured;
  if (brierDelta > DRIFT_BRIER_THRESHOLD) {
    return { drifted: true, reason: `Calibration degraded by ${brierDelta.toFixed(3)} brier vs. promotion-time performance (n=${currentMetrics.holdout_n}).` };
  }
  if (avgRDelta < -DRIFT_AVG_R_THRESHOLD) {
    return { drifted: true, reason: `Captured expectancy dropped by ${(-avgRDelta).toFixed(3)}R vs. promotion-time performance (n=${currentMetrics.holdout_n}).` };
  }
  return { drifted: false, reason: "No meaningful drift detected." };
}

export interface DriftAlert {
  question: string;
  champion_version: number;
  checked_at: string;
  recorded_metrics: ModelMetrics;
  current_metrics: ModelMetrics;
  reason: string;
}

export async function recordDriftAlert(alert: DriftAlert): Promise<void> {
  try {
    await getDb().collection(GLOBAL_BRAIN_DRIFT_ALERTS_COLLECTION).insertOne(alert);
  } catch {
    /* best-effort */
  }
}

export async function latestDriftAlert(question: string): Promise<DriftAlert | null> {
  const rows = await getDb()
    .collection<DriftAlert>(GLOBAL_BRAIN_DRIFT_ALERTS_COLLECTION)
    .find({ question }, { projection: { _id: 0 } })
    .sort({ checked_at: -1 })
    .limit(1)
    .toArray();
  return rows[0] ?? null;
}

export async function ensureGlobalBrainDriftIndexes(): Promise<void> {
  await getDb().collection(GLOBAL_BRAIN_DRIFT_ALERTS_COLLECTION).createIndex({ question: 1, checked_at: -1 });
}
