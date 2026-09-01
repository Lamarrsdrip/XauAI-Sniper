import { getDb } from "../db.js";

/**
 * Owner-controlled master switches for the Global Learning Brain. A
 * dedicated singleton document (own collection, not the shared
 * admin_settings doc services/settings.ts owns) so this feature's
 * on/off state can never collide with unrelated payment/notification
 * settings that document already carries.
 *
 * Every flag here is checked at exactly the single choke point each
 * capability funnels through, so flipping one switch has one obvious,
 * traceable effect:
 *  - global_learning_enabled: services/globalBrainIngest.ts's
 *    recordGlobalBrainObservation (every ingestion hook writes through
 *    this one function -- gating it here gates all of them at once).
 *  - scheduled_cycle_enabled: index.ts's globalBrainDailyLoop, checked
 *    BEFORE calling runGlobalBrainDailyCycle -- a manual admin-triggered
 *    run is a separate, deliberate action and is not gated by this.
 *  - auto_training_enabled: services/globalBrainTraining.ts's
 *    runGlobalBrainDailyCycle, checked at the very top of every run
 *    (scheduled or manual).
 *  - auto_promotion_enabled: same file, checked per-question right
 *    before a promotion decision would be acted on -- challenger
 *    training/reporting still happens either way, only the promotion
 *    action itself is gated.
 *  - shadow_serving_enabled: services/globalBrainShadowServing.ts's two
 *    logging functions.
 *  - advisory_integration_enabled: routes/ml.ts's GET /ml/brain/suggestion
 *    -- when off, always returns the safe "no data" shape regardless of
 *    what is actually in the registry.
 *  - {bot,m10,outlook}_learned_influence_enabled: gate the three real,
 *    tested production-influence consumers (AGENTS spec sections 21-23) --
 *    routes/ai.ts's POST /ai/analyze (BOT), and
 *    services/marketOutlookSignal.ts's generateOutlookForAccount when
 *    publication_mode is M10_SIGNAL (M10) or HOURLY/other (OUTLOOK). All
 *    three funnel through the single choke point
 *    services/globalBrainInfluence.ts's evaluateGlobalBrainInfluence, which
 *    returns NO_OPINION/not-applied WITHOUT reading the registry whenever
 *    the relevant flag here is false -- their production default, and the
 *    only state the owner has approved for live traffic so far. See
 *    globalBrainInfluence.ts's module comment for the full safety contract
 *    (REJECT-only, never invents a trade, never touches SL/TP/lot beyond
 *    zeroing them alongside a REJECT-driven downgrade to SKIP/BLOCKED).
 */
export interface GlobalBrainSettings {
  global_learning_enabled: boolean;
  scheduled_cycle_enabled: boolean;
  auto_training_enabled: boolean;
  auto_promotion_enabled: boolean;
  shadow_serving_enabled: boolean;
  advisory_integration_enabled: boolean;
  bot_learned_influence_enabled: boolean;
  m10_learned_influence_enabled: boolean;
  outlook_learned_influence_enabled: boolean;
  updated_at: string | null;
  updated_by: string | null;
}

const SETTINGS_COLLECTION = "global_brain_settings";
const SETTINGS_KEY = "main";

const DEFAULT_SETTINGS: GlobalBrainSettings = {
  global_learning_enabled: true,
  scheduled_cycle_enabled: true,
  auto_training_enabled: true,
  auto_promotion_enabled: true,
  shadow_serving_enabled: true,
  advisory_integration_enabled: true,
  bot_learned_influence_enabled: false,
  m10_learned_influence_enabled: false,
  outlook_learned_influence_enabled: false,
  updated_at: null,
  updated_by: null,
};

export async function ensureGlobalBrainSettingsIndexes(): Promise<void> {
  await getDb().collection(SETTINGS_COLLECTION).createIndex("key", { unique: true });
}

export async function getGlobalBrainSettings(): Promise<GlobalBrainSettings> {
  try {
    const existing = await getDb().collection(SETTINGS_COLLECTION).findOne({ key: SETTINGS_KEY }, { projection: { _id: 0 } });
    if (existing) {
      // Strip the persistence-only `key` field -- it identifies the
      // singleton doc in Mongo but is not part of the GlobalBrainSettings
      // shape, so it must never leak into the returned object (that shape
      // must stay identical to what updateGlobalBrainSettings returns).
      const { key: _key, ...rest } = existing;
      return { ...DEFAULT_SETTINGS, ...rest } as GlobalBrainSettings;
    }
  } catch {
    /* fail safe to defaults below -- a settings-read failure must never crash the caller */
  }
  return DEFAULT_SETTINGS;
}

export type GlobalBrainSettingsPatch = Partial<Omit<GlobalBrainSettings, "updated_at" | "updated_by">>;

export async function updateGlobalBrainSettings(patch: GlobalBrainSettingsPatch, updatedBy: string): Promise<GlobalBrainSettings> {
  const current = await getGlobalBrainSettings();
  const next: GlobalBrainSettings = { ...current, ...patch, updated_at: new Date().toISOString(), updated_by: updatedBy };
  await getDb()
    .collection(SETTINGS_COLLECTION)
    .updateOne({ key: SETTINGS_KEY }, { $set: { ...next, key: SETTINGS_KEY } }, { upsert: true });
  return next;
}

/** The "emergency fallback to baseline" kill switch: every capability off in one atomic write, so the platform returns to exactly its pre-Global-Brain behavior (no ingestion, no training, no promotion, no shadow logs, no advisory reads, no production influence). Never touches the champion/challenger registry itself -- existing champions remain in place, simply unreachable, so re-enabling restores prior state instantly. Explicitly includes the three production-influence flags: this is the one action that must ALWAYS zero out live-decision influence, even if an owner had deliberately enabled one for isolated testing (spec section 18). */
export async function emergencyDisableGlobalBrain(updatedBy: string): Promise<GlobalBrainSettings> {
  return updateGlobalBrainSettings(
    {
      global_learning_enabled: false,
      scheduled_cycle_enabled: false,
      auto_training_enabled: false,
      auto_promotion_enabled: false,
      shadow_serving_enabled: false,
      advisory_integration_enabled: false,
      bot_learned_influence_enabled: false,
      m10_learned_influence_enabled: false,
      outlook_learned_influence_enabled: false,
    },
    updatedBy,
  );
}
