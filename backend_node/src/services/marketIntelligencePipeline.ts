import { canonicalM10Signal, extractEvidenceQuoteFromDetails } from "./marketOutlookEvidence.js";
import { trackOutlookLifecycleTick } from "./marketOutlookTick.js";
import { publishM10SignalFromActivity } from "./marketOutlookPublish.js";
import { mirrorSubscriberM10Evaluation } from "./subscriberSignalFeed.js";
import { hourlyGenerationTick } from "./marketOutlookHourlyTick.js";
import { publishOutlookThesis } from "./outlookExecution.js";
import { recordPersistentDiagnostic } from "./persistentDiagnostics.js";
import { MARKET_INTELLIGENCE_RESPONSE_BUDGET_MS } from "./marketIntelligenceConfig.js";

export interface MarketIntelligencePipelineInput {
  license_key: string;
  account: string;
  source_event_id: string;
  event_at: string;
  details: Record<string, unknown>;
  route?: string;
  request_id?: string;
}

export interface MarketIntelligencePipelineResult {
  quote_processed: boolean;
  m10_mirrored: boolean;
  m10_published: boolean;
  hourly_generated: number;
  failures: string[];
  /** True when the EA was acknowledged before the pipeline finished; stages still run and record diagnostics. */
  deferred?: boolean;
}

async function stage<T>(
  name: string,
  input: MarketIntelligencePipelineInput,
  fn: () => Promise<T>,
  failures: string[],
): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    failures.push(name);
    await recordPersistentDiagnostic("error", "market-intelligence-pipeline", error, {
      code: "MARKET_INTELLIGENCE_STAGE_FAILED",
      stage: name,
      account: input.account,
      source_event_id: input.source_event_id,
      route: input.route,
      request_id: input.request_id,
    });
    return null;
  }
}

/**
 * One canonical downstream pipeline used by both heartbeat and activity.
 * Every stage is idempotent or naturally de-duplicated by the existing
 * signal/outlook keys, so a later heartbeat safely retries a failed stage.
 * Failures are durable/observable but never turn monitoring into a trading
 * dependency.
 */
export async function processMarketIntelligenceEvidence(
  input: MarketIntelligencePipelineInput,
): Promise<MarketIntelligencePipelineResult> {
  const failures: string[] = [];
  const result: MarketIntelligencePipelineResult = {
    quote_processed: false,
    m10_mirrored: false,
    m10_published: false,
    hourly_generated: 0,
    failures,
  };
  if (!input.account) return result;

  const quote = extractEvidenceQuoteFromDetails(input.details, input.event_at);
  const m10Signal = (input.details["m10_signal"] as Record<string, unknown> | undefined) ?? {};
  const hasM10 = Object.keys(m10Signal).length > 0;

  if (quote.valid && Number(quote.bid) > 0 && Number(quote.ask) >= Number(quote.bid)) {
    const lifecycle = await stage("OUTLOOK_LIFECYCLE", input, () => trackOutlookLifecycleTick({
      account: input.account,
      bid: Number(quote.bid),
      ask: Number(quote.ask),
      quote_at: quote.quote_at ?? input.event_at,
    }), failures);
    result.quote_processed = lifecycle !== null;
  }

  if (hasM10) {
    const mirrored = await stage("M10_EVALUATION_MIRROR", input, async () => {
      await mirrorSubscriberM10Evaluation(input.account, m10Signal, input.event_at);
      return true;
    }, failures);
    result.m10_mirrored = mirrored === true;
  }

  const canonical = hasM10 ? canonicalM10Signal({
    ts: input.event_at,
    market_thesis: input.details["market_thesis"] ?? {},
    entry_readiness: input.details["entry_readiness"] ?? {},
    m10_signal: m10Signal,
    execution: {
      candidate_allowed: input.details["candidate_allowed"],
      final_execution_allowed: input.details["final_execution_allowed"],
      final_decision: input.details["final_decision"],
      final_blocker: input.details["final_blocker"] ?? input.details["blocked_by"],
      pipeline_stage: input.details["pipeline_stage"],
      open_trade_called: input.details["open_trade_called"],
      broker_retcode: input.details["broker_retcode"],
    },
  }) : null;

  // Preserve blocked/expired lifecycle truth even if no publication quote is
  // available. An ACTIONABLE candidate needs a real quote before publication.
  const candidateCanBeProcessed = canonical?.["candidate"] === true &&
    (canonical["blocked"] === true || canonical["expired"] === true || quote.valid);
  if (candidateCanBeProcessed) {
    const published = await stage("M10_PUBLICATION", input, async () => {
      const doc = await publishM10SignalFromActivity(input.license_key, input.account, input.source_event_id);
      if (doc) await publishOutlookThesis(doc, "M10_SIGNAL_ENGINE");
      return Boolean(doc);
    }, failures);
    result.m10_published = published === true;
  }

  if (quote.valid) {
    const hourly = await stage("HOURLY_GENERATION", input, () => hourlyGenerationTick(input.account), failures);
    if (hourly) {
      result.hourly_generated = hourly[0];
      for (const doc of hourly[1]) {
        await stage("HOURLY_PUBLICATION", input, () => publishOutlookThesis(doc, "MARKET_OUTLOOK"), failures);
      }
    }
  }

  return result;
}

function emptyResult(failures: string[] = []): MarketIntelligencePipelineResult {
  return { quote_processed: false, m10_mirrored: false, m10_published: false, hourly_generated: 0, failures };
}

/**
 * Route entry point for EA heartbeat/activity. Runs the canonical pipeline but
 * never holds the EA's synchronous WebRequest longer than the response budget:
 * if the pipeline is still working it keeps running in the background (every
 * stage already records durable diagnostics) and the EA is acknowledged with
 * `deferred: true`. Never throws.
 */
export async function runMarketIntelligenceForEaRequest(
  input: MarketIntelligencePipelineInput,
  budgetMs = MARKET_INTELLIGENCE_RESPONSE_BUDGET_MS,
): Promise<MarketIntelligencePipelineResult> {
  const run = processMarketIntelligenceEvidence(input).catch(async (error: unknown) => {
    await recordPersistentDiagnostic("error", "market-intelligence-pipeline", error, {
      code: "MARKET_INTELLIGENCE_PIPELINE_FAILED",
      account: input.account,
      source_event_id: input.source_event_id,
      route: input.route,
      request_id: input.request_id,
    });
    return emptyResult(["PIPELINE"]);
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), budgetMs);
    timer.unref?.();
  });
  try {
    const settled = await Promise.race([run, budget]);
    return settled ?? { ...emptyResult(), deferred: true };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
