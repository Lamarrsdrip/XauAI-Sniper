import { randomBytes } from "node:crypto";
import { LlmChat } from "./llmClient.js";
import { env } from "../env.js";
import { aiBudgetAllows, recordAiCost } from "./aiCostBudget.js";
import { OUTLOOK_SYMBOL } from "./marketOutlookCore.js";

export interface ConfidenceComponents {
  trend_alignment: number;
  structure: number;
  pressure: number;
  location: number;
  exhaustion: number;
  remaining_room: number;
  liquidity_clarity: number;
  session_news_stability: number;
}

/** Port of market_outlook.py:807 `_score_component`. */
function scoreComponent(value: number, goodAt: number, badAt: number): number {
  if (goodAt === badAt) return 50.0;
  const t = (value - badAt) / (goodAt - badAt);
  return Math.max(0.0, Math.min(100.0, t * 100.0));
}

/** Port of market_outlook.py:816 `_compute_confidence`. */
export function computeConfidence(direction: number, thesis: Record<string, unknown>, _readiness: Record<string, unknown>): ConfidenceComponents {
  const buyP = Number(thesis["buy_pressure"] ?? 50.0) || 50.0;
  const sellP = Number(thesis["sell_pressure"] ?? 50.0) || 50.0;
  const pressureForUs = direction === 1 ? buyP : sellP;
  const location = String(thesis["location"] ?? "");
  const structure = String(thesis["structure"] ?? "");
  const exhaustionPct = Number(thesis["exhaustion_pct"] ?? 40.0) || 40.0;
  const remainingRoom = Number(thesis["remaining_room_r"] ?? 1.0) || 1.0;
  let trendHealth = 60.0;
  if ("action" in thesis) trendHealth = thesis["action"] === "ALLOW_CORE" ? 75.0 : 45.0;

  const locationScores: Record<string, number> = {
    LOCATION_EXCELLENT: 95.0,
    LOCATION_GOOD: 78.0,
    LOCATION_ACCEPTABLE: 55.0,
    LOCATION_LATE: 30.0,
    LOCATION_EXTREME: 10.0,
    LOCATION_RESET_PENDING: 40.0,
    LOCATION_RESET_CONFIRMED: 70.0,
  };
  const structureScores: Record<string, number> = {
    STRUCTURE_STRONGLY_SUPPORTS: 95.0,
    STRUCTURE_SUPPORTS: 75.0,
    STRUCTURE_MIXED: 50.0,
    STRUCTURE_OPPOSES: 20.0,
    STRUCTURE_INVALIDATED: 0.0,
  };

  return {
    trend_alignment: trendHealth,
    structure: structureScores[structure] ?? 50.0,
    pressure: pressureForUs,
    location: locationScores[location] ?? 50.0,
    exhaustion: scoreComponent(exhaustionPct, 0.0, 100.0),
    remaining_room: scoreComponent(remainingRoom, 3.0, 0.0),
    liquidity_clarity: ![null, undefined, "", "NO_VALID_TRADE"].includes(thesis["action"] as string | null | undefined) ? 70.0 : 35.0,
    session_news_stability: 80.0,
  };
}

/** Port of market_outlook.py:850 `_confidence_pct`. */
export function confidencePct(c: ConfidenceComponents): number {
  const weights: Record<keyof ConfidenceComponents, number> = {
    trend_alignment: 0.2,
    structure: 0.15,
    pressure: 0.2,
    location: 0.15,
    exhaustion: 0.1,
    remaining_room: 0.1,
    liquidity_clarity: 0.05,
    session_news_stability: 0.05,
  };
  let total = 0;
  for (const k of Object.keys(weights) as (keyof ConfidenceComponents)[]) total += c[k] * weights[k];
  return Math.round(Math.max(0.0, Math.min(100.0, total)));
}

/** Port of market_outlook.py:864 `_confidence_category`. */
export function confidenceCategory(pct: number): string {
  if (pct < 35) return "VERY_LOW";
  if (pct < 55) return "LOW";
  if (pct < 75) return "MODERATE";
  return "HIGH";
}

export interface ZoneAndTargets {
  preferred_entry_zone_low: number;
  preferred_entry_zone_high: number;
  chase_limit: number;
  invalidation_price: number;
  suggested_sl: number;
  tp1_price: number;
  tp1_r: number;
  tp2_price: number;
  tp2_r: number;
  tp3_price: number;
  tp3_r: number;
}

/** Port of market_outlook.py:879 `_compute_zone_and_targets`. */
export function computeZoneAndTargets(direction: number, currentPrice: number, thesis: Record<string, unknown>, atrEstimate: number): ZoneAndTargets {
  const atr = Math.max(0.01, Number(atrEstimate ?? 0) || 0);
  const consumedPct = Number(thesis["movement_consumed_pct"] ?? thesis["move_consumed_pct"] ?? 40.0) || 40.0;
  const pullbackDepthAtr = consumedPct < 60 ? 0.6 : 1.0;

  let zoneLow: number, zoneHigh: number, chaseLimit: number, sl: number;
  if (direction === 1) {
    zoneLow = Math.round((currentPrice - pullbackDepthAtr * atr) * 100) / 100;
    zoneHigh = Math.round((currentPrice - pullbackDepthAtr * 0.4 * atr) * 100) / 100;
    chaseLimit = Math.round((currentPrice + 0.5 * atr) * 100) / 100;
    sl = Math.round((zoneLow - 0.5 * atr) * 100) / 100;
  } else {
    zoneLow = Math.round((currentPrice + pullbackDepthAtr * 0.4 * atr) * 100) / 100;
    zoneHigh = Math.round((currentPrice + pullbackDepthAtr * atr) * 100) / 100;
    chaseLimit = Math.round((currentPrice - 0.5 * atr) * 100) / 100;
    sl = Math.round((zoneHigh + 0.5 * atr) * 100) / 100;
  }

  const midEntry = Math.round(((zoneLow + zoneHigh) / 2) * 100) / 100;
  let riskDist = Math.abs(midEntry - sl);
  if (riskDist <= 0) riskDist = atr;

  let remainingRoomR = Number(thesis["remaining_room_r"] ?? 2.0) || 2.0;
  remainingRoomR = Math.max(0.5, remainingRoomR);
  const tp1R = Math.min(1.0, remainingRoomR * 0.4);
  const tp2R = Math.min(2.0, remainingRoomR * 0.75);
  const tp3R = remainingRoomR;

  const tpPrice = (rMult: number): number => (direction === 1 ? Math.round((midEntry + riskDist * rMult) * 100) / 100 : Math.round((midEntry - riskDist * rMult) * 100) / 100);

  return {
    preferred_entry_zone_low: Math.min(zoneLow, zoneHigh),
    preferred_entry_zone_high: Math.max(zoneLow, zoneHigh),
    chase_limit: chaseLimit,
    invalidation_price: sl,
    suggested_sl: sl,
    tp1_price: tpPrice(tp1R),
    tp1_r: Math.round(tp1R * 100) / 100,
    tp2_price: tpPrice(tp2R),
    tp2_r: Math.round(tp2R * 100) / 100,
    tp3_price: tpPrice(tp3R),
    tp3_r: Math.round(tp3R * 100) / 100,
  };
}

/** Port of market_outlook.py:928 `_expected_path`. */
export function expectedPath(direction: number, thesis: Record<string, unknown>): string {
  const location = String(thesis["location"] ?? "");
  const action = String(thesis["action"] ?? "");
  if (direction === 0) return location === "LOCATION_ACCEPTABLE" || location === "" ? "RANGE_ROTATION" : "NO_CLEAR_PATH";
  if (["TRANSITION_WATCH", "OPPOSITE_DISCOVERY"].includes(action)) return "REVERSAL_FORMING";
  if (["LOCATION_LATE", "LOCATION_EXTREME"].includes(location)) return direction === 1 ? "PULLBACK_FIRST_THEN_BUY" : "RALLY_FIRST_THEN_SELL";
  if (action === "ALLOW_CORE") return "DIRECT_CONTINUATION";
  return "NO_CLEAR_PATH";
}

/** Port of market_outlook.py:946 `_synthesize_narrative` -- LLM narrative synthesis, advisory text only, never a decision input. */
export async function synthesizeNarrative(
  directionLabel: string,
  confidence: number,
  thesis: Record<string, unknown>,
  path: string,
  zone: ZoneAndTargets,
  accountId: string,
): Promise<{ reasoning: string; uncertainty: string }> {
  const cacheKey = `outlook:${directionLabel}:${confidence}:${thesis["action"] ?? ""}`;
  const fallback = {
    reasoning: `${directionLabel} bias with ${confidence}% confidence. Location: ${thesis["location"] ?? "unknown"}. Structure: ${thesis["structure"] ?? "unknown"}. Expected path: ${path.replace(/_/g, " ").toLowerCase()}.`,
    uncertainty: "Template fallback (AI narrative unavailable this cycle) -- numbers above are still real evidence, not fabricated.",
  };
  if (!env.EMERGENT_LLM_KEY) return fallback;
  const [allowed] = aiBudgetAllows("outlook", cacheKey, false, accountId);
  if (!allowed) return fallback;

  try {
    const chat = new LlmChat({
      apiKey: env.EMERGENT_LLM_KEY,
      sessionId: `outlook-${Math.random().toString(16).slice(2, 10)}`,
      systemMessage:
        'You are writing a concise, honest hourly XAUUSD market outlook for manual traders. You are NOT deciding a trade -- only explaining evidence that was already computed. Use probability language, never certainty. JSON only: {"reasoning": "<= 80 words", "uncertainty": "<= 40 words describing what would prove this wrong"}',
    });
    chat.withModel("anthropic", "claude-sonnet-4-5-20250929");
    const prompt =
      `Direction: ${directionLabel} | Confidence: ${confidence}%\n` +
      `Location: ${thesis["location"]} | Structure: ${thesis["structure"]} | Pressure buy=${thesis["buy_pressure"]} sell=${thesis["sell_pressure"]}\n` +
      `Exhaustion: ${thesis["exhaustion_pct"]}% | Movement consumed: ${thesis["movement_consumed_pct"]}%\n` +
      `Expected path: ${path}\n` +
      `Preferred zone: ${zone.preferred_entry_zone_low}-${zone.preferred_entry_zone_high} | SL: ${zone.suggested_sl} | TP1/2/3: ${zone.tp1_price}/${zone.tp2_price}/${zone.tp3_price}\n` +
      "Write the outlook explanation. JSON only.";
    const response = await chat.sendMessage(prompt);
    recordAiCost("anthropic", "claude-sonnet-4-5-20250929", prompt, response, "outlook", cacheKey, "hourly market outlook narrative", accountId);
    let cleaned = response.trim();
    if (cleaned.startsWith("```")) cleaned = cleaned.replace(/^`+/, "").split("\n").slice(1).join("\n");
    const parsed = JSON.parse(cleaned) as { reasoning?: string; uncertainty?: string };
    return {
      reasoning: String(parsed.reasoning ?? fallback.reasoning).slice(0, 600),
      uncertainty: String(parsed.uncertainty ?? fallback.uncertainty).slice(0, 300),
    };
  } catch {
    return fallback;
  }
}

/** Port of market_outlook.py:1005 `_new_outlook_id`. */
export function newOutlookId(directionLabel: string): string {
  const now = new Date();
  const ts = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}-${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}`;
  const suffix = randomBytes(4).toString("hex").slice(0, 6);
  return `OUTLOOK-${OUTLOOK_SYMBOL}-${ts}-${directionLabel}-${suffix}`;
}
