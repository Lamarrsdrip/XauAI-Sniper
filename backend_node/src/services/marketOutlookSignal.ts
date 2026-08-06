import type { Document } from "mongodb";
import { MongoServerError } from "mongodb";
import { getDb } from "../db.js";
import {
  BREAK_EVEN_R_TOLERANCE as _BREAK_EVEN_R_TOLERANCE,
  HALF_R_WIN_THRESHOLD,
  MAX_PUBLICATION_QUOTE_AGE_SECONDS,
  MAX_PUBLICATION_QUOTE_FUTURE_SKEW_SECONDS,
  OUTLOOK_EVALUATION_MINUTES,
  OUTLOOK_HORIZON_HOURS,
  OUTLOOK_SYMBOL,
  SIGNAL_INFORMATIONAL,
  SIGNAL_TRACKING,
  XAUCLOUD_R_UNIT_GOLD_MOVES,
  XAUCLOUD_TP1_GOLD_MOVES,
  XAUCLOUD_TP2_GOLD_MOVES,
  evaluateOwnerPolicy,
} from "./marketOutlookCore.js";
import { asUtc, canonicalM10Signal, extractEvidenceQuote, latestEaEvidence } from "./marketOutlookEvidence.js";
import { computeConfidence, confidenceCategory, confidencePct, computeZoneAndTargets, expectedPath, newOutlookId, synthesizeNarrative } from "./marketOutlookConfidence.js";
import { fetchLiveGoldPrice } from "./goldPrice.js";

void _BREAK_EVEN_R_TOLERANCE; // referenced by advance_persisted_signal, still pending port

/** Port of market_outlook.py:1010 `_outlook_slot_id`. */
function outlookSlotId(account: string, symbol: string, hourlySlot: string): string {
  return `outlook-slot:${account}:${symbol}:${hourlySlot}`;
}

export interface TrackingAnchor {
  tracking_entry_price: number;
  original_sl: number;
  risk_distance: number;
  current_r: number;
  mfe_r: number;
  mae_r: number;
  highest_tracked_price: number;
  lowest_tracked_price: number;
  last_bid: number;
  last_ask: number;
  last_tracked_price: number;
}

/** Port of market_outlook.py:1014 `_build_tracking_anchor`. */
export function buildTrackingAnchor(direction: string, bid: unknown, ask: unknown, originalSl: unknown): TrackingAnchor | null {
  const dir = String(direction ?? "").toUpperCase();
  const bidN = Number(bid ?? 0) || 0;
  const askN = Number(ask ?? 0) || 0;
  const sl = Number(originalSl ?? 0) || 0;
  if (!["BUY", "SELL"].includes(dir) || bidN <= 0 || askN < bidN || sl <= 0) return null;
  const entry = dir === "BUY" ? askN : bidN;
  const geometryValid = dir === "BUY" ? sl < entry : sl > entry;
  if (!geometryValid) return null;
  if (Math.abs(entry - sl) <= 0) return null;
  const closePrice = dir === "BUY" ? bidN : askN;
  const currentR = dir === "BUY" ? (closePrice - entry) / XAUCLOUD_R_UNIT_GOLD_MOVES : (entry - closePrice) / XAUCLOUD_R_UNIT_GOLD_MOVES;
  return {
    tracking_entry_price: entry,
    original_sl: sl,
    risk_distance: XAUCLOUD_R_UNIT_GOLD_MOVES,
    current_r: Math.round(currentR * 1e6) / 1e6,
    mfe_r: Math.round(Math.max(0, currentR) * 1e6) / 1e6,
    mae_r: Math.round(Math.min(0, currentR) * 1e6) / 1e6,
    highest_tracked_price: Math.max(entry, closePrice),
    lowest_tracked_price: Math.min(entry, closePrice),
    last_bid: bidN,
    last_ask: askN,
    last_tracked_price: closePrice,
  };
}

/** Port of market_outlook.py:1065 `_fixed_tp_prices`. */
export function fixedTpPrices(direction: string, entry: number): [number, number, number] {
  const sign = String(direction ?? "").toUpperCase() === "BUY" ? 1.0 : -1.0;
  const e = Number(entry ?? 0) || 0;
  const tp1 = Math.round((e + sign * XAUCLOUD_TP1_GOLD_MOVES) * 100) / 100;
  const tp2 = Math.round((e + sign * XAUCLOUD_TP2_GOLD_MOVES) * 100) / 100;
  const tp3 = Math.round((e + sign * (XAUCLOUD_TP2_GOLD_MOVES * 2.0)) * 100) / 100;
  return [tp1, tp2, tp3];
}

/** Port of market_outlook.py:1082 `_targets_have_valid_geometry`. */
export function targetsHaveValidGeometry(direction: string, entry: unknown, tp1: unknown, tp2: unknown, tp3: unknown): boolean {
  const dir = String(direction ?? "").toUpperCase();
  const e = Number(entry ?? 0) || 0;
  const t1 = Number(tp1 ?? 0) || 0;
  const t2 = Number(tp2 ?? 0) || 0;
  const t3 = Number(tp3 ?? 0) || 0;
  if (dir === "BUY") return e > 0 && e < t1 && t1 <= t2 && t2 <= t3;
  if (dir === "SELL") return e > 0 && e > t1 && t1 >= t2 && t2 >= t3 && t3 > 0;
  return false;
}

/** Port of market_outlook.py:1101 `_insert_outlook_atomically` -- deterministic per-slot _id gives real atomicity via MongoDB's own unique index, no separate lock needed. */
export async function insertOutlookAtomically(
  doc: Record<string, unknown>,
  account: string,
  symbol: string,
  hourlySlot: string,
  publicationKey = "",
): Promise<Record<string, unknown>> {
  const db = getDb();
  const outlooks = db.collection("cloud_market_outlooks");
  const key = publicationKey || hourlySlot;
  const withId: Record<string, unknown> = { ...doc, publication_key: key, _id: outlookSlotId(account, symbol, key) };
  try {
    await outlooks.insertOne(withId as unknown as Document);
    withId["_newly_inserted"] = true;
    return withId;
  } catch (err) {
    if (err instanceof MongoServerError && err.code === 11000) {
      const existing = await outlooks.findOne({ _id: withId["_id"] as unknown as never });
      if (!existing) throw err;
      return { ...existing, _newly_inserted: false };
    }
    throw err;
  }
}

interface HourlyBiasResult {
  direction_label: string;
  direction: number;
  market_regime: string;
  components: ReturnType<typeof computeConfidence>;
  evidence_strength: number;
  confidence: number;
  confidence_category: string;
  directional_conflict: string | null;
  directional_transformation_applied: boolean;
  automated_entry_approved: boolean;
  automated_block_reason: string | null;
}

/** Port of market_outlook.py:1138 `_resolve_hourly_bias` -- pure directional-bias resolver for the Hourly Manual Outlook. */
export function resolveHourlyBias(canonicalM10: Record<string, unknown>, thesis: Record<string, unknown>): HourlyBiasResult {
  const rawDir = String(canonicalM10["direction"] ?? "");
  const actionable = Boolean(canonicalM10["actionable"]);
  const automatedEntryApproved = actionable;
  const automatedBlockReason = actionable ? null : String(canonicalM10["blocker_code"] ?? canonicalM10["execution_status"] ?? "") || null;

  const buyP = Number(thesis["buy_pressure"] ?? 50.0) || 50.0;
  const sellP = Number(thesis["sell_pressure"] ?? 50.0) || 50.0;
  const pressureGap = buyP - sellP;
  const structureState = String(thesis["structure"] ?? "");

  let directionalConflict: string | null = null;
  let directionalTransformationApplied = false;
  let directionLabel: string;
  if (["BUY", "SELL"].includes(rawDir)) directionLabel = rawDir;
  else if (buyP !== sellP) directionLabel = buyP > sellP ? "BUY" : "SELL";
  else directionLabel = "BUY";
  let direction = directionLabel === "BUY" ? 1 : -1;

  const structuralOverrideBearish = ["STRUCTURE_STRONGLY_SUPPORTS", "STRUCTURE_SUPPORTS"].includes(structureState) && direction === -1;
  const structuralOverrideBullish = ["STRUCTURE_STRONGLY_SUPPORTS", "STRUCTURE_SUPPORTS"].includes(structureState) && direction === 1;
  if (directionLabel === "SELL" && pressureGap >= 15.0 && !structuralOverrideBearish) {
    directionalConflict = `buy pressure (${buyP.toFixed(0)}) outweighs sell pressure (${sellP.toFixed(0)}) with no documented bearish structural override`;
  } else if (directionLabel === "BUY" && pressureGap <= -15.0 && !structuralOverrideBullish) {
    directionalConflict = `sell pressure (${sellP.toFixed(0)}) outweighs buy pressure (${buyP.toFixed(0)}) with no documented bullish structural override`;
  }
  if (directionalConflict) {
    directionLabel = pressureGap > 0 ? "BUY" : "SELL";
    direction = directionLabel === "BUY" ? 1 : -1;
    directionalTransformationApplied = true;
  }

  const marketRegime = directionalTransformationApplied
    ? "TRANSITION"
    : String(thesis["market_regime"] ?? thesis["regime"] ?? thesis["direction_stage"] ?? thesis["lifecycle"] ?? "WAITING").toUpperCase();

  const components = computeConfidence(direction, thesis, {});
  const evidenceStrength = confidencePct(components);
  const canonicalConfidence = rawDir === directionLabel && !directionalTransformationApplied ? (canonicalM10["confidence"] as number | null) : null;
  let confidence = canonicalConfidence !== null && canonicalConfidence !== undefined ? Math.round(canonicalConfidence) : evidenceStrength;

  const pressureGapAbs = Math.abs(pressureGap);
  if (pressureGapAbs < 4.0) confidence = Math.min(confidence, 25);
  else if (pressureGapAbs < 12.0) confidence = Math.min(confidence, 45);
  else if (pressureGapAbs < 25.0) confidence = Math.min(confidence, 70);
  if (directionalTransformationApplied) confidence = Math.min(confidence, 65);
  confidence = Math.max(0, Math.min(100, Math.trunc(confidence)));
  const confCategory = confidenceCategory(confidence);

  return {
    direction_label: directionLabel,
    direction,
    market_regime: marketRegime,
    components,
    evidence_strength: evidenceStrength,
    confidence,
    confidence_category: confCategory,
    directional_conflict: directionalConflict,
    directional_transformation_applied: directionalTransformationApplied,
    automated_entry_approved: automatedEntryApproved,
    automated_block_reason: automatedBlockReason,
  };
}

const EMPTY_CONFIDENCE_COMPONENTS = {
  trend_alignment: 0.0,
  structure: 0.0,
  pressure: 0.0,
  location: 0.0,
  exhaustion: 0.0,
  remaining_room: 0.0,
  liquidity_clarity: 0.0,
  session_news_stability: 0.0,
};

const NO_VALID_REASON_TEXT: Record<string, string> = {
  NO_CONNECTED_EA: "No EA has ever reported activity for this account -- connect and run your EA to begin receiving hourly outlooks.",
  STALE_EVIDENCE: "This account's EA has connected before, but has not reported any activity in the last 6 hours -- check that it is still running.",
  INSUFFICIENT_MARKET_EVIDENCE: "The EA is connected and reporting, but its recent events do not yet carry usable market-thesis or entry-readiness data.",
  INTERNAL_GENERATION_ERROR: "No usable live price is available from the EA or the fallback feed right now, so no outlook could be generated this cycle.",
};

/** Port of market_outlook.py:1252 `generate_outlook_for_account` -- generates and persists ONE new immutable outlook document, or null if there is genuinely no usable evidence yet. */
export async function generateOutlookForAccount(opts: {
  license_key: string;
  account: string;
  account_id?: string;
  is_late_catchup?: boolean;
  publication_key?: string;
  publication_mode?: string;
  source_event_id?: string;
}): Promise<Record<string, unknown> | null> {
  const { license_key: licenseKey, account, account_id: accountId = "", is_late_catchup: isLateCatchup = false, publication_mode: publicationMode = "HOURLY", source_event_id: sourceEventId = "" } = opts;
  const db = getDb();

  const { evidence, reason: evidenceReason } = await latestEaEvidence(licenseKey, account, sourceEventId);

  const evidenceQuote = extractEvidenceQuote(evidence ?? {});
  const eaMid = Number(evidenceQuote.mid ?? 0) || 0;
  let currentPrice = 0;
  let priceSource = "NONE";
  if (eaMid > 0) {
    currentPrice = eaMid;
    priceSource = "EA_LIVE_BROKER_PRICE";
  } else {
    const priceInfo = await fetchLiveGoldPrice();
    if (priceInfo.source === "live" && Number(priceInfo.bid ?? 0) > 0) {
      currentPrice = Number(priceInfo.bid);
      priceSource = "EXTERNAL_FALLBACK_FEED";
    }
  }

  let outlookId = newOutlookId("PENDING");
  const now = new Date();
  const hourlySlot = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}T${String(now.getUTCHours()).padStart(2, "0")}:00`;
  const publicationKey = opts.publication_key || hourlySlot;
  const expiryAt = new Date(now.getTime() + OUTLOOK_HORIZON_HOURS * 3600_000).toISOString();

  if (!evidence || currentPrice <= 0) {
    const noValidReason = !evidence ? evidenceReason : "INTERNAL_GENERATION_ERROR";
    const reasonText = NO_VALID_REASON_TEXT[noValidReason] ?? "No recent EA evidence available for this account yet -- nothing to analyze.";
    const doc: Record<string, unknown> = {
      id: outlookId.replace("PENDING", "NO_VALID_OUTLOOK"),
      symbol: OUTLOOK_SYMBOL,
      account,
      license_key: licenseKey,
      generated_at: now.toISOString(),
      hourly_slot: hourlySlot,
      publication_key: publicationKey,
      publication_mode: publicationMode,
      source_event_id: sourceEventId || null,
      late_catchup: isLateCatchup,
      expiry_at: expiryAt,
      current_price: currentPrice,
      primary_direction: "NO_VALID_OUTLOOK",
      outlook_type: "HOURLY_MANUAL_BIAS",
      execution_authority: false,
      no_valid_outlook_reason: noValidReason,
      confidence_pct: 0,
      confidence_components: EMPTY_CONFIDENCE_COMPONENTS,
      status: "PUBLISHED",
      reasoning: reasonText,
      uncertainty: ["NO_CONNECTED_EA", "STALE_EVIDENCE"].includes(noValidReason) ? "Connect and run your EA to begin receiving hourly outlooks." : "Retry next hourly cycle.",
      expected_path: "NO_CLEAR_PATH",
      setup_type: "NONE",
    };
    return insertOutlookAtomically(doc, account, OUTLOOK_SYMBOL, hourlySlot, publicationKey);
  }

  const thesis: Record<string, unknown> = {
    ...((evidence["m10_signal"] as Record<string, unknown> | undefined) ?? {}),
    ...((evidence["entry_readiness"] as Record<string, unknown> | undefined) ?? {}),
    ...((evidence["market_thesis"] as Record<string, unknown> | undefined) ?? {}),
  };
  const canonicalM10 = canonicalM10Signal(evidence);

  const bias = resolveHourlyBias(canonicalM10, thesis);
  let directionLabel = bias.direction_label;
  const direction = bias.direction;

  const ownerPolicy = evaluateOwnerPolicy(canonicalM10);
  let ownerPolicyBlockedDirection: string | null = null;
  if (["BUY", "SELL"].includes(directionLabel) && !ownerPolicy["allowed"]) {
    ownerPolicyBlockedDirection = directionLabel;
    directionLabel = "BLOCKED";
  }
  const effectiveDirection = directionLabel === "BLOCKED" ? 0 : direction;

  const dataStatus = "LIVE";
  const path = expectedPath(effectiveDirection, thesis);
  const setupType = path.startsWith("PULLBACK") || path.startsWith("RALLY")
    ? "WITH_TREND_PULLBACK"
    : path === "DIRECT_CONTINUATION"
      ? "TREND_CONTINUATION"
      : path === "REVERSAL_FORMING"
        ? "OPPOSITE_DIRECTION_REVERSAL"
        : "NONE";

  let zone: Record<string, unknown> = {};
  let priceSanityFailed = false;
  if (effectiveDirection !== 0 && ["BUY", "SELL"].includes(directionLabel)) {
    const eaStructEntry = Number(thesis["structural_entry"] ?? 0) || 0;
    const eaStructSl = Number(thesis["structural_sl"] ?? 0) || 0;
    const eaAtr = Number(thesis["atr_m5"] ?? 0) || 0;
    if (eaStructEntry > 0 && eaStructSl > 0 && eaAtr > 0) {
      zone = {
        preferred_entry_zone_low: Math.round(Math.min(eaStructEntry, eaStructEntry - eaAtr * 0.15) * 100) / 100,
        preferred_entry_zone_high: Math.round(Math.max(eaStructEntry, eaStructEntry + eaAtr * 0.15) * 100) / 100,
        chase_limit: Math.round((eaStructEntry + (effectiveDirection === 1 ? eaAtr * 0.5 : -eaAtr * 0.5)) * 100) / 100,
        invalidation_price: Math.round(eaStructSl * 100) / 100,
        suggested_sl: Math.round(eaStructSl * 100) / 100,
        tp1_price: Math.round((Number(thesis["tp1_price"] ?? 0) || 0) * 100) / 100,
        tp1_r: 1.0,
        tp2_price: Math.round((Number(thesis["tp2_price"] ?? 0) || 0) * 100) / 100,
        tp2_r: 2.0,
        tp3_price: Math.round((Number(thesis["tp3_price"] ?? 0) || 0) * 100) / 100,
        tp3_r: Math.round(Math.max(1.0, Number(thesis["remaining_room_r"] ?? 2.0) || 2.0) * 100) / 100,
      };
    } else {
      const atrEstimate = eaAtr > 0 ? eaAtr : currentPrice * 0.0035;
      zone = computeZoneAndTargets(effectiveDirection, currentPrice, thesis, atrEstimate) as unknown as Record<string, unknown>;
    }

    const entryMid = (Number(zone["preferred_entry_zone_low"] ?? currentPrice) + Number(zone["preferred_entry_zone_high"] ?? currentPrice)) / 2.0;
    const atrForCheck = eaAtr > 0 ? eaAtr : Math.max(1.0, currentPrice * 0.005);
    const maxAllowedDistance = Math.max(atrForCheck * 5.0, currentPrice * 0.02);
    const distance = Math.abs(entryMid - currentPrice);
    if (distance > maxAllowedDistance) priceSanityFailed = true;
  }

  if (priceSanityFailed) {
    const doc: Record<string, unknown> = {
      id: outlookId.replace("PENDING", "NO_VALID_OUTLOOK"),
      symbol: OUTLOOK_SYMBOL,
      account,
      license_key: licenseKey,
      generated_at: now.toISOString(),
      hourly_slot: hourlySlot,
      publication_key: publicationKey,
      publication_mode: publicationMode,
      source_event_id: sourceEventId || null,
      late_catchup: isLateCatchup,
      expiry_at: expiryAt,
      current_price: currentPrice,
      primary_direction: "NO_VALID_OUTLOOK",
      outlook_type: "HOURLY_MANUAL_BIAS",
      execution_authority: false,
      no_valid_outlook_reason: "INTERNAL_DATA_INCONSISTENCY",
      confidence_pct: 0,
      confidence_components: EMPTY_CONFIDENCE_COMPONENTS,
      status: "PUBLISHED",
      reasoning: "Computed entry geometry did not pass price-sanity validation against the account's live market price this cycle.",
      uncertainty: "Retry next hourly cycle.",
      expected_path: "NO_CLEAR_PATH",
      setup_type: "NONE",
    };
    return insertOutlookAtomically(doc, account, OUTLOOK_SYMBOL, hourlySlot, publicationKey);
  }

  const publishedBid = Number(evidenceQuote.bid ?? 0) || 0;
  const publishedAsk = Number(evidenceQuote.ask ?? 0) || 0;
  const publishedQuoteDt = asUtc(evidenceQuote.quote_at);
  const publishedQuoteAt = publishedQuoteDt ? publishedQuoteDt.toISOString() : null;
  const actionable = ["BUY", "SELL"].includes(directionLabel);
  const originalSl = zone["suggested_sl"] as number | undefined;
  let trackingAnchor = actionable ? buildTrackingAnchor(directionLabel, publishedBid, publishedAsk, originalSl) : null;

  if (actionable && trackingAnchor) {
    const [fixedTp1, fixedTp2, fixedTp3] = fixedTpPrices(directionLabel, trackingAnchor.tracking_entry_price);
    zone = { ...zone, tp1_price: fixedTp1, tp1_r: HALF_R_WIN_THRESHOLD, tp2_price: fixedTp2, tp2_r: 1.0, tp3_price: fixedTp3, tp3_r: 2.0 };
  }

  const quoteAgeSeconds = publishedQuoteDt ? (now.getTime() - publishedQuoteDt.getTime()) / 1000 : null;
  const quoteFresh = quoteAgeSeconds !== null && quoteAgeSeconds >= -MAX_PUBLICATION_QUOTE_FUTURE_SKEW_SECONDS && quoteAgeSeconds <= MAX_PUBLICATION_QUOTE_AGE_SECONDS;
  const targetGeometryValid = actionable
    ? Boolean(trackingAnchor && targetsHaveValidGeometry(directionLabel, trackingAnchor.tracking_entry_price, zone["tp1_price"], zone["tp2_price"], zone["tp3_price"]))
    : true;

  if (actionable && trackingAnchor && !quoteFresh) {
    return null;
  }

  const quoteValid = Boolean(trackingAnchor && targetGeometryValid);
  if (actionable && !quoteValid) {
    const invalidReason = trackingAnchor && !targetGeometryValid ? "PUBLISHED_TARGET_GEOMETRY_INVALID" : "EXECUTABLE_PUBLICATION_QUOTE_OR_SL_INVALID";
    const doc: Record<string, unknown> = {
      id: outlookId.replace("PENDING", "NO_VALID_OUTLOOK"),
      symbol: OUTLOOK_SYMBOL,
      account,
      license_key: licenseKey,
      generated_at: now.toISOString(),
      published_at: now.toISOString(),
      hourly_slot: hourlySlot,
      late_catchup: isLateCatchup,
      expiry_at: expiryAt,
      current_price: currentPrice,
      primary_direction: "NO_VALID_OUTLOOK",
      outlook_type: "HOURLY_MANUAL_BIAS",
      execution_authority: false,
      no_valid_outlook_reason: invalidReason,
      confidence_pct: 0,
      confidence_components: EMPTY_CONFIDENCE_COMPONENTS,
      status: "INFORMATIONAL",
      signal_state: SIGNAL_INFORMATIONAL,
      reasoning: "No complete broker Bid/Ask snapshot was available, so no actionable signal or performance record was created.",
      uncertainty: "Wait for a fresh EA quote.",
      expected_path: "NO_CLEAR_PATH",
      setup_type: "NONE",
      analytics_outcome: null,
      excluded_from_signal_analytics: true,
    };
    return insertOutlookAtomically(doc, account, OUTLOOK_SYMBOL, hourlySlot, publicationKey);
  }

  const trackingEntry = trackingAnchor ? trackingAnchor.tracking_entry_price : null;
  const riskDistance = trackingAnchor ? trackingAnchor.risk_distance : null;

  const narrative = await synthesizeNarrative(directionLabel, bias.confidence, thesis, path, zone as never, accountId);

  outlookId = newOutlookId(directionLabel);
  const publishedAt = now.toISOString();
  const doc: Record<string, unknown> = {
    id: outlookId,
    symbol: OUTLOOK_SYMBOL,
    account,
    license_key: licenseKey,
    generated_at: publishedAt,
    published_at: publishedAt,
    hourly_slot: hourlySlot,
    publication_key: publicationKey,
    publication_mode: publicationMode,
    source_event_id: sourceEventId || null,
    late_catchup: isLateCatchup,
    expiry_at: expiryAt,
    current_price: currentPrice,
    price_source: priceSource,
    primary_direction: directionLabel,
    actionable_signal: ["BUY", "SELL"].includes(directionLabel) ? directionLabel : "NO_TRADE_RIGHT_NOW",
    market_regime: bias.market_regime,
    data_status: dataStatus,
    evidence_strength_pct: bias.evidence_strength,
    direction: effectiveDirection,
    directional_conflict: bias.directional_conflict,
    directional_transformation_applied: bias.directional_transformation_applied,
    source_regime: evidence["regime"] ?? "",
    signal_source: canonicalM10["source"],
    source_m10_decision: canonicalM10["decision"],
    source_m10_bar_time: canonicalM10["bar_time"],
    setup_type: setupType,
    confidence_pct: bias.confidence,
    confidence_category: bias.confidence_category,
    confidence_components: bias.components,
    outlook_type: "HOURLY_MANUAL_BIAS",
    execution_authority: false,
    automated_entry_approved: bias.automated_entry_approved,
    automated_block_reason: bias.automated_block_reason,
    owner_policy: ownerPolicy,
    owner_policy_blocked: !ownerPolicy["allowed"],
    owner_policy_blocked_direction: ownerPolicyBlockedDirection,
    expected_path: path,
    preferred_entry_zone_low: zone["preferred_entry_zone_low"] ?? null,
    preferred_entry_zone_high: zone["preferred_entry_zone_high"] ?? null,
    chase_limit: zone["chase_limit"] ?? null,
    invalidation_price: zone["invalidation_price"] ?? null,
    suggested_sl: zone["suggested_sl"] ?? null,
    tp1_price: zone["tp1_price"] ?? null,
    tp1_r: zone["tp1_r"] ?? null,
    tp2_price: zone["tp2_price"] ?? null,
    tp2_r: zone["tp2_r"] ?? null,
    tp3_price: zone["tp3_price"] ?? null,
    tp3_r: zone["tp3_r"] ?? null,
    raw_structural_sl: thesis["raw_structural_sl"] ?? null,
    raw_sl_distance: thesis["raw_sl_distance"] ?? null,
    sl_widening_factor: thesis["sl_widening_factor"] ?? null,
    final_structural_sl: thesis["final_structural_sl"] ?? null,
    final_sl_distance: thesis["final_sl_distance"] ?? null,
    configured_risk_pct: thesis["configured_risk_pct"] ?? null,
    buy_pressure: thesis["buy_pressure"] ?? null,
    sell_pressure: thesis["sell_pressure"] ?? null,
    exhaustion_pct: thesis["exhaustion_pct"] ?? null,
    movement_consumed_pct: thesis["movement_consumed_pct"] ?? null,
    remaining_room_r: thesis["remaining_room_r"] ?? null,
    trend_state: thesis["lifecycle"] ?? thesis["direction_stage"] ?? "",
    structure_state: thesis["structure"] ?? "",
    liquidity_destination: thesis["primary_destination"] ?? thesis["first_destination"] ?? null,
    session: evidence["session"] ?? "",
    expected_holding_horizon: setupType !== "NONE" ? "hours" : "n/a",
    reasoning: narrative.reasoning,
    uncertainty: narrative.uncertainty,
    status: actionable ? "TRACKING" : "INFORMATIONAL",
    signal_state: actionable ? SIGNAL_TRACKING : SIGNAL_INFORMATIONAL,
    signal_tracking_version: 2,
    published_bid: publishedBid > 0 ? publishedBid : null,
    published_ask: publishedAsk > 0 ? publishedAsk : null,
    published_spread: publishedBid > 0 && publishedAsk >= publishedBid ? publishedAsk - publishedBid : null,
    published_quote_at: publishedQuoteAt,
    tracking_entry_price: actionable ? trackingEntry : null,
    original_sl: actionable ? originalSl : null,
    risk_distance: actionable ? riskDistance : null,
    evaluation_deadline: actionable ? new Date(now.getTime() + OUTLOOK_EVALUATION_MINUTES * 60_000).toISOString() : null,
    activation: { activated: actionable, activated_at: actionable ? publishedAt : null, activated_price: actionable ? trackingEntry : null },
    milestones_hit: [],
    final_result: null,
    final_r: null,
    analytics_outcome: null,
    analytics_r: null,
    current_r: actionable ? trackingAnchor!.current_r : null,
    mfe_r: actionable ? trackingAnchor!.mfe_r : null,
    mae_r: actionable ? trackingAnchor!.mae_r : null,
    highest_tracked_price: actionable ? trackingAnchor!.highest_tracked_price : null,
    lowest_tracked_price: actionable ? trackingAnchor!.lowest_tracked_price : null,
    last_bid: actionable ? trackingAnchor!.last_bid : null,
    last_ask: actionable ? trackingAnchor!.last_ask : null,
    last_tracked_price: actionable ? trackingAnchor!.last_tracked_price : null,
    first_half_r_at: null,
    tp1_hit_at: null,
    tp2_hit_at: null,
    tp3_hit_at: null,
    sl_hit_at: null,
    classification_at: null,
    latest_path_event: actionable ? "TRACKING_STARTED" : "INFORMATIONAL_UPDATE",
    notification_flags: {},
    last_monitored_at: actionable ? publishedQuoteAt : null,
    event_snapshots: actionable
      ? { TRACKING_STARTED: { event_at: publishedAt, hit_price: trackingEntry, achieved_r: trackingAnchor!.current_r } }
      : {},
    excluded_from_signal_analytics: !actionable,
    highest_tp_reached: null,
    mfe: actionable ? trackingAnchor!.mfe_r : 0.0,
    mae: actionable ? trackingAnchor!.mae_r : 0.0,
    color_state: "AMBER",
  };

  return insertOutlookAtomically(doc, account, OUTLOOK_SYMBOL, hourlySlot, publicationKey);
}
