import { getDb } from "../db.js";
import { getCurrentChampion } from "./globalBrainRegistry.js";
import { lookupBucket } from "./globalBrainEstimator.js";
import { getGlobalBrainSettings } from "./globalBrainSettings.js";

/**
 * Real-time shadow serving: logs what the CURRENT CHAMPION would suggest
 * for a decision at the exact moment the real (rule-based) decision is
 * made, alongside what the rules actually decided -- the spec's "RULE
 * DECISION / BRAIN DECISION / ACTUAL DECISION" evidence record, captured
 * live rather than only reconstructed retrospectively from terminal
 * outcomes (globalBrainIngest.ts already does the retrospective side).
 *
 * SHADOW-ONLY: both call sites (below, and the /ml/shadow/record hook in
 * routes/ml.ts) fire strictly AFTER the real decision is already finalized
 * and persisted/returned -- this module only ever reads champion bucket
 * tables and writes a comparison log. Nothing here can feed back into the
 * decision it is logging.
 */

export const GLOBAL_BRAIN_SHADOW_SERVING_COLLECTION = "global_brain_shadow_serving_log";

export async function ensureGlobalBrainShadowServingIndexes(): Promise<void> {
  await getDb().collection(GLOBAL_BRAIN_SHADOW_SERVING_COLLECTION).createIndex({ source: 1, logged_at: -1 });
}

/**
 * Called from services/marketOutlookSignal.ts's generateOutlookForAccount,
 * strictly AFTER insertOutlookAtomically has already durably persisted the
 * real Outlook doc -- this never runs before or influences that write.
 */
export async function logOutlookShadowComparison(doc: Record<string, unknown>): Promise<void> {
  try {
    const settings = await getGlobalBrainSettings();
    if (!settings.shadow_serving_enabled) return;
    const direction = String(doc["primary_direction"] ?? "").toUpperCase();
    if (direction !== "BUY" && direction !== "SELL") return; // only actionable decisions are worth comparing

    const session = String(doc["session"] ?? "");
    const regime = String(doc["market_regime"] ?? "");
    const setupType = String(doc["setup_type"] ?? "");
    const confidencePct = Number(doc["confidence_pct"] ?? 0);
    const decile = Math.min(9, Math.max(0, Math.floor(confidencePct / 10)));

    const [directionQuality, setupQuality, calibration] = await Promise.all([
      getCurrentChampion("DIRECTION_QUALITY"),
      getCurrentChampion("SETUP_QUALITY"),
      getCurrentChampion("CALIBRATION"),
    ]);

    await getDb()
      .collection(GLOBAL_BRAIN_SHADOW_SERVING_COLLECTION)
      .insertOne({
        source: "OUTLOOK",
        outlook_id: String(doc["id"] ?? ""),
        logged_at: new Date().toISOString(),
        rule_decision: direction,
        features_key: { direction, session, regime, setup_type: setupType, confidence_decile: `decile_${decile}` },
        brain_suggestions: {
          DIRECTION_QUALITY: directionQuality ? lookupBucket(directionQuality.buckets, `${direction}|${regime}|${setupType}`) : null,
          SETUP_QUALITY: setupQuality ? lookupBucket(setupQuality.buckets, setupType) : null,
          CALIBRATION: calibration ? lookupBucket(calibration.buckets, `decile_${decile}`) : null,
        },
      });
  } catch {
    /* best-effort -- never affect the real Outlook decision this rides along with */
  }
}

/**
 * Called from routes/ml.ts's existing POST /ml/shadow/record handler,
 * strictly AFTER the real ml_shadow_decisions row has already been
 * inserted -- enriches that SAME existing shadow-log record (never a new
 * decision surface) with what the current Global Brain champion suggests,
 * for B1/bot-trade shadow comparison. The endpoint's response is
 * unaffected either way (see routes/ml.test.ts's existing "no gating
 * field in response" assertion, which this does not touch).
 */
export async function logBotTradeShadowComparison(shadowDoc: {
  signature: string;
  direction?: string;
  regime?: string;
  setup_type?: string;
}): Promise<void> {
  try {
    const settings = await getGlobalBrainSettings();
    if (!settings.shadow_serving_enabled) return;
    const direction = String(shadowDoc.direction ?? "").toUpperCase();
    const regime = String(shadowDoc.regime ?? "");
    const setupType = String(shadowDoc.setup_type ?? "");
    const directionQuality = await getCurrentChampion("DIRECTION_QUALITY");
    if (!directionQuality) return; // no champion yet -- nothing to compare against

    // Bot-trade decisions carry no session field today (see
    // globalBrainIngest.ts's buildBotTradeObservation comment) -- the
    // bucket key's session segment is empty, matching how training itself
    // builds this same bucket key for bot-trade observations.
    const bucketKey = `${direction}|${regime}|${setupType}`;
    // findOneAndUpdate + sort, matching routes/journal.ts's existing
    // "most-recent-matching-signature" convention exactly (updateOne has
    // no equivalent tie-break-by-sort in this codebase's established usage).
    await getDb()
      .collection("ml_shadow_decisions")
      .findOneAndUpdate(
        { signature: shadowDoc.signature, actual_action: "CANDIDATE" },
        { $set: { global_brain_suggestion: lookupBucket(directionQuality.buckets, bucketKey) } },
        { sort: { decision_time_utc: -1 } },
      );
  } catch {
    /* best-effort -- never affect the real shadow-record write this rides along with */
  }
}
