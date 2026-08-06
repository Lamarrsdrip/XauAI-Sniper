/** Port of server.py:6971-7271 -- the conversational "AI thought card" builder shared by decision-feed and current-opinion. */

const REGIME_PHRASES: Record<string, string> = {
  STRONG_TREND: "the trend is strong",
  WEAK_TREND: "a trend is present but weak",
  RANGE: "the market is ranging",
  COMPRESSION: "volatility is compressing",
  EXPANSION: "volatility is expanding",
  MOMENTUM_CONT: "momentum continuation is in play",
  REVERSAL_ENV: "conditions favor a possible reversal",
  HIGH_VOLATILITY: "volatility is elevated",
  BULL_TREND: "the trend is bullish",
  BEAR_TREND: "the trend is bearish",
};
const SESSION_PHRASES: Record<string, string> = {
  LONDON: "London session",
  NEW_YORK: "New York session",
  NY: "New York session",
  ASIA: "Asian session",
  ASIAN: "Asian session",
  OVERLAP: "the London/NY overlap",
};
const GRADE_PHRASES: Record<string, string> = {
  "A+": "highest-quality setup",
  A: "high-quality setup",
  B: "moderate-quality setup",
  "B+": "moderate-quality setup",
};
const BLOCK_REASON_PHRASES: [string, string][] = [
  ["GROWTH_RR_BLOCK", "Blocked because the reward-to-risk ratio is too low for this setup"],
  ["SMC_HARD_CONFLICT", "Blocked because market structure (order blocks / BOS) strongly disagrees with this direction"],
  ["B-CONFIDENT-SKIP", "Blocked because AI confidence is weak on this setup"],
  ["AI-CONFIDENT-SKIP", "Blocked because AI confidence is weak on this setup"],
  ["HTF-CONSENSUS-OVERRIDE", "Blocked because the higher timeframe trend disagrees with this entry"],
  ["HTF_OVERRIDE", "Blocked because the higher timeframe trend disagrees with this entry"],
  ["WEAK-DISAGREE", "Blocked because AI disagrees with this setup, even if only mildly"],
  ["LOW-CONF-SKIP", "Blocked because AI confidence was too low to confirm this setup"],
  ["NO-CONF-SKIP", "Blocked because AI could not confirm this setup with any real confidence"],
  ["PERSONALITY", "Blocked because this setup type doesn't fit current market conditions"],
  ["TRI_REENTRY_WATCH", "Blocked because this direction recently bailed out of a weak recovery — waiting for a fresh, better-quality entry instead of repeating the same read"],
  ["POST_NEWS_AVOID", "Blocked because price is still reacting to recent news — waiting for it to settle"],
  ["SPREAD", "Blocked because the spread is too wide right now"],
  ["NEWS", "Blocked because a high-impact news event is near"],
  ["REGIME_DEAD", "Blocked because the market is too quiet/directionless right now"],
  ["STRETCHED", "Blocked because price is already extended after a strong move — entry would be late"],
  ["OVEREXTENDED", "Blocked because price is already extended after a strong move — entry would be late"],
  ["RESISTANCE", "Blocked because price is too close to resistance"],
  ["SUPPORT", "Blocked because price is too close to support"],
  ["ANTI-TREND", "Blocked because this direction is fighting the higher timeframe trend"],
  ["ANTI_TREND", "Blocked because this direction is fighting the higher timeframe trend"],
];

export function aiBiasWord(direction: unknown): string {
  const d = String(direction ?? "").toUpperCase().trim();
  if (["1", "+1", "BUY", "BULL", "BULLISH", "LONG"].includes(d)) return "Bullish";
  if (["-1", "SELL", "BEAR", "BEARISH", "SHORT"].includes(d)) return "Bearish";
  return "";
}

export function aiSplitReasonClauses(...texts: unknown[]): string[] {
  const clauses: string[] = [];
  const seen = new Set<string>();
  for (const raw of texts) {
    const t = String(raw ?? "").trim();
    if (!t) continue;
    const parts = t.split(/\s*(?:;|\||\.\s+|\n)\s*/);
    for (let p of parts) {
      p = p.trim().replace(/^[. ]+|[. ]+$/g, "");
      if (p.length < 4) continue;
      const key = p.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      clauses.push(p.charAt(0).toUpperCase() + p.slice(1));
    }
  }
  return clauses.slice(0, 6);
}

export function aiClassifyCardType(ev: Record<string, unknown>): string {
  const category = String(ev["event_category"] ?? "").toLowerCase();
  const eventType = String(ev["event_type"] ?? "").toUpperCase();
  const decision = String(ev["decision"] ?? "").toUpperCase();
  const details = (ev["details"] as Record<string, unknown>) ?? {};
  const finalDecision = String(ev["final_decision"] ?? details["final_decision"] ?? "").toUpperCase();
  const finalAllowed = ev["final_execution_allowed"];
  const allowed = ev["allowed"];
  const ticket = String(ev["ticket"] ?? "").trim();

  if (["PRIMARY_DECISION", "M5_DECISION"].includes(eventType)) {
    if (["EXECUTED", "FILLED"].includes(finalDecision) || finalAllowed === true) return "TRADE_EXECUTED";
    if (finalDecision === "BLOCKED" || (finalAllowed === false && String(ev["candidate_allowed"] ?? "").toLowerCase() !== "true")) return "TRADE_BLOCKED";
    return "MARKET_ANALYSIS";
  }
  if (eventType === "EXECUTION_FUNNEL") {
    if (finalDecision === "EXECUTED" || finalAllowed === true) return "TRADE_EXECUTED";
    if (["BLOCKED", "ERROR"].includes(finalDecision) || finalAllowed === false) return "TRADE_BLOCKED";
    return "MARKET_ANALYSIS";
  }
  if (category === "entries" || eventType.includes("TRADE_EXECUTED") || eventType.includes("FIRE") || eventType.includes("PYR")) return "TRADE_EXECUTED";
  if (category === "exits" || eventType.includes("EXIT") || eventType.includes("CLOSE")) return "TRADE_CLOSED";
  if (category === "blocks" || allowed === false || eventType.includes("BLOCK") || decision.includes("VETO")) return "TRADE_BLOCKED";
  if (!ticket && (category === "ai" || eventType.includes("DIRECTOR") || eventType.includes("SIGNAL") || eventType.includes("SETUP"))) return "MARKET_ANALYSIS";
  if (ticket) return "LIVE_THOUGHT";
  return "INFO";
}

export function aiHumanizeBlockReason(code: unknown): string {
  const c = String(code ?? "").toUpperCase();
  if (!c) return "";
  for (const [needle, phrase] of BLOCK_REASON_PHRASES) {
    if (c.includes(needle)) return phrase;
  }
  const cleaned = String(code ?? "").replace(/[_-]+/g, " ").trim();
  if (!cleaned) return "";
  return `Blocked: ${cleaned.toLowerCase()}`;
}

export interface ThoughtCard {
  id: unknown;
  ticket: string;
  ts: unknown;
  type: string;
  tone: string;
  headline: string;
  bias: string;
  confidence: number | null;
  confidence_delta: number | null;
  decision_text: string;
  reason_bullets: string[];
  action_text: string;
  grade: string | null;
  result_usd: number | null;
  simple_text: string;
  advanced: Record<string, unknown>;
  repeated_at?: unknown[];
  repeat_count?: number;
}

/** Port of server.py:7058 `_ai_build_thought_card`. */
export function aiBuildThoughtCard(ev: Record<string, unknown>, prevConfByTicket: Map<string, number>): ThoughtCard {
  const details = (ev["details"] as Record<string, unknown>) ?? {};
  const ticket = String(ev["ticket"] ?? "").trim();
  const grade = String(ev["grade"] ?? details["grade"] ?? "").trim();
  const regime = String(details["regime"] ?? ev["mode"] ?? "").trim().toUpperCase();
  const session = String(details["session"] ?? "").trim().toUpperCase();
  let confidence: number | null = null;
  const rawConf = ev["ai_confidence"];
  if (typeof rawConf === "number") confidence = Math.trunc(rawConf);
  const bias = aiBiasWord(ev["market_bias"] ?? ev["signal_direction"]);
  const reasonRaw = ev["reason"] ?? "";
  const finalDecision = String(ev["final_decision"] ?? details["final_decision"] ?? "").trim();
  const finalBlocker = String(ev["final_blocker"] ?? details["final_blocker"] ?? "").trim();
  const thesis = String(details["thesis"] ?? "");

  const cardType = aiClassifyCardType(ev);

  const prevConf = ticket ? prevConfByTicket.get(ticket) : undefined;
  let confidenceDelta: number | null = null;
  if (confidence !== null && prevConf !== undefined && confidence !== prevConf) {
    confidenceDelta = confidence - prevConf;
  }
  if (ticket && confidence !== null) prevConfByTicket.set(ticket, confidence);

  let bullets = aiSplitReasonClauses(reasonRaw, thesis);
  if (regime && REGIME_PHRASES[regime] && !bullets.some((b) => b.toLowerCase().includes(regime.toLowerCase()))) {
    const phrase = REGIME_PHRASES[regime]!;
    bullets.push(phrase.charAt(0).toUpperCase() + phrase.slice(1));
  }
  if (session && SESSION_PHRASES[session] && !bullets.some((b) => b.toLowerCase().includes("session"))) {
    bullets.push(`${SESSION_PHRASES[session]} conditions`);
  }
  bullets = bullets.slice(0, 6);

  let tone = "neutral";
  let headline = "AI Update";
  let decisionText = String(ev["decision"] ?? ev["message"] ?? "").trim();
  let actionText = "";
  let resultUsd: number | null = null;

  if (cardType === "MARKET_ANALYSIS") {
    headline = "AI Market Analysis";
    tone = bias === "Bullish" ? "bullish" : bias === "Bearish" ? "bearish" : "neutral";
    const actionWord = bias === "Bullish" ? "BUY" : bias === "Bearish" ? "SELL" : "";
    decisionText = actionWord ? `Preparing ${actionWord}` : "Analyzing setup";
    actionText = "Waiting for confirmation...";
  } else if (cardType === "TRADE_EXECUTED") {
    headline = "Trade Executed";
    tone = "success";
    const direction = ev["position_direction"] ?? bias;
    decisionText = direction ? `${direction} executed` : decisionText || "Trade executed";
    if (confidenceDelta) {
      bullets.unshift(
        `Confidence ${confidenceDelta > 0 ? "increased" : "decreased"} ${prevConf === undefined ? "to" : `from ${prevConf}% to`} ${confidence}%`,
      );
    }
  } else if (cardType === "LIVE_THOUGHT") {
    const weakening = confidence !== null && confidence < 65;
    const dropping = confidenceDelta !== null && confidenceDelta <= -20;
    if (weakening || dropping) {
      headline = "Warning";
      tone = "warning";
      decisionText = decisionText || "Watching carefully";
      actionText = "Not exiting yet — need confirmation.";
    } else {
      headline = "Live Thoughts";
      tone = "neutral";
      decisionText = decisionText || "Holding position";
      actionText = "No exit signal yet.";
    }
  } else if (cardType === "TRADE_CLOSED") {
    headline = "Trade Closed";
    const profit = ev["profit"];
    if (typeof profit === "number") {
      resultUsd = Math.round(profit * 100) / 100;
      tone = resultUsd >= 0 ? "success" : "danger";
    }
    decisionText = String(ev["close_reason_exact"] ?? decisionText ?? "Position closed");
    if (bullets.length === 0) bullets = aiSplitReasonClauses(ev["message"]);
  } else if (cardType === "TRADE_BLOCKED") {
    headline = "Trade Blocked";
    tone = "danger";
    const blockedBy = finalBlocker || String(ev["blocked_by"] ?? "").trim();
    if (blockedBy && !bullets.some((b) => b.toLowerCase().includes(blockedBy.toLowerCase()))) {
      bullets.unshift(blockedBy);
    }
    decisionText = aiHumanizeBlockReason(blockedBy) || bullets[0] || "Waiting for higher quality setup";
  }
  if (cardType === "MARKET_ANALYSIS" && finalDecision) {
    decisionText = finalDecision !== "WAITING" ? finalDecision : "Waiting for execution gates";
  }

  const simpleParts = [headline];
  if (bias) simpleParts.push(`${bias} bias`);
  if (confidence !== null) simpleParts.push(`${confidence}% confidence`);
  if (decisionText) simpleParts.push(decisionText);

  return {
    id: ev["id"],
    ticket,
    ts: ev["ts"],
    type: cardType,
    tone,
    headline,
    bias,
    confidence,
    confidence_delta: confidenceDelta,
    decision_text: decisionText,
    reason_bullets: bullets,
    action_text: actionText,
    grade: grade || null,
    result_usd: resultUsd,
    simple_text: simpleParts.join(" — "),
    advanced: {
      event_type: ev["event_type"],
      severity: ev["severity"],
      module: ev["module"],
      score: ev["score"],
      regime: regime || null,
      session: session || null,
      market_bias: ev["market_bias"],
      signal_direction: ev["signal_direction"],
      symbol: ev["symbol"],
      message: ev["message"],
      close_reason_exact: ev["close_reason_exact"],
      candidate_allowed: ev["candidate_allowed"] ?? details["candidate_allowed"],
      final_execution_allowed: ev["final_execution_allowed"] ?? details["final_execution_allowed"],
      final_decision: finalDecision || null,
      final_blocker: finalBlocker || null,
      open_trade_called: ev["open_trade_called"] ?? details["open_trade_called"],
      broker_retcode: ev["broker_retcode"] ?? details["broker_retcode"],
      details,
    },
  };
}

/** Port of server.py:7255 `_ai_would_enter_again`. */
export function aiWouldEnterAgain(latestCard: Partial<ThoughtCard>): { answer: string; reason: string } {
  const conf = latestCard.confidence;
  const tone = latestCard.tone;
  const delta = latestCard.confidence_delta ?? 0;
  if (conf === null || conf === undefined) {
    return { answer: "WAIT", reason: "No live confidence reading yet — wait for the next evaluation." };
  }
  if (tone === "danger" || conf < 45) {
    return { answer: "NO", reason: "Confidence is too weak to justify entering here." };
  }
  if (tone === "warning" || conf < 65) {
    const why = delta < 0 ? "Confidence has dropped and hasn't recovered yet" : "Confidence is in a borderline zone — not clearly good or bad";
    return { answer: "WAIT", reason: `${why}; wait for a clearer read before acting.` };
  }
  return { answer: "YES", reason: "Thesis still holds at current confidence." };
}

/** Port of server.py:6944 `_ai_group_repeated_cards`. */
export function aiGroupRepeatedCards(cards: ThoughtCard[]): ThoughtCard[] {
  const grouped: ThoughtCard[] = [];
  for (const card of cards) {
    const key = `${card.type}|${card.headline}|${card.decision_text}`;
    const prev = grouped.at(-1);
    if (prev) {
      const prevKey = `${prev.type}|${prev.headline}|${prev.decision_text}`;
      if (key === prevKey) {
        prev.repeated_at ??= [];
        prev.repeated_at.push(card.ts);
        prev.repeat_count = (prev.repeat_count ?? 1) + 1;
        continue;
      }
    }
    card.repeated_at = [];
    card.repeat_count = 1;
    grouped.push(card);
  }
  return grouped;
}

export { GRADE_PHRASES };
