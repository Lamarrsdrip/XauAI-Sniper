import type { FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import { appendFile, readFile } from "node:fs/promises";
import { z } from "zod";
import { getDb } from "../db.js";
import { env } from "../env.js";
import { normalizeLicenseKey, resolveMonitorLicense } from "../services/license.js";
import { LlmChat } from "../services/llmClient.js";
import {
  aiBudgetAllows,
  aiCacheGet,
  aiCachePut,
  aiCostSnapshot,
  aiCostStateHash,
  recordAiCost,
} from "../services/aiCostBudget.js";
import {
  AI_FEEDBACK_PATH,
  appendTradeMemory,
  buildMemoryRecommendation,
  loadTradeMemory,
  tradeMemoryStateHash,
  writeTradeMemoryReport,
} from "../services/tradeMemory.js";
import { AIAnalysisRequestSchema, PositionCheckRequestSchema, TradeMemoryRecordSchema } from "../models/ai.js";

const LLM_KEY = env.EMERGENT_LLM_KEY;

interface AiVerdict {
  action: string;
  confidence: number;
  reason: string;
  thesis?: string;
  bearish_case?: string;
  skip_if?: string;
  invalidation?: string;
  target?: string;
  sl_adjust: number;
  tp_adjust: number;
  available?: boolean;
  ai_status?: string;
  [key: string]: unknown;
}

function parseEntryJson(response: string): AiVerdict {
  let cleaned = (response || "").trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(cleaned);
  if (fence?.[1]) cleaned = fence[1].trim();
  if (!cleaned.startsWith("{")) {
    const m = /\{[\s\S]*\}/.exec(cleaned);
    if (m) cleaned = m[0];
  }
  try {
    const r = JSON.parse(cleaned) as Record<string, unknown>;
    let action = String(r["action"] ?? "SKIP").toUpperCase();
    if (!["BUY", "SELL", "SKIP"].includes(action)) action = "SKIP";
    const confidence = Math.max(0, Math.min(100, Math.trunc(Number(r["confidence"] ?? 50))));
    return {
      action,
      confidence,
      reason: String(r["reason"] ?? "").slice(0, 200),
      thesis: String(r["thesis"] ?? "").slice(0, 500),
      bearish_case: String(r["bearish_case"] ?? "").slice(0, 400),
      skip_if: String(r["skip_if"] ?? "").slice(0, 200),
      invalidation: String(r["invalidation"] ?? "").slice(0, 200),
      target: String(r["target"] ?? "").slice(0, 200),
      sl_adjust: Number(r["sl_adjust"] ?? 0) || 0,
      tp_adjust: Number(r["tp_adjust"] ?? 0) || 0,
    };
  } catch {
    const up = (response || "").toUpperCase();
    const base: AiVerdict = {
      action: "SKIP",
      confidence: 0,
      reason: "Invalid AI Response",
      thesis: "",
      bearish_case: "",
      skip_if: "",
      invalidation: "",
      target: "",
      sl_adjust: 0,
      tp_adjust: 0,
      ai_status: "Invalid AI Response",
      available: false,
    };
    if (up.includes('"BUY"')) return { ...base, action: "BUY", confidence: 55, reason: "parser fallback" };
    if (up.includes('"SELL"')) return { ...base, action: "SELL", confidence: 55, reason: "parser fallback" };
    return base;
  }
}

function providerLabel(provider: string): string {
  return provider === "anthropic" ? "Claude" : "GPT";
}

const ENTRY_SYSTEM_PROMPT = `You are the AI Director for an XAUUSD M10 evidence system with an optional three-snapshot M30 execution authority. You are an advisory probability scorer. The local EA rule engine and selected Decision Mode own final execution authority. You review full market context and recommend ALLOW, BLOCK, or ADJUST, but only true danger should be treated as a hard veto.

You receive complete context: price, indicators, H1/HTF trend, session, open positions, basket P/L, account state, recent win/loss streak, trade grade, and setup scores. Use ALL of it.

You MUST respond in EXACTLY this JSON format (NO markdown fences, NO extra fields):
{"action":"BUY","confidence":75,"reason":"short reason","thesis":"detailed trader narrative","bearish_case":"counter-argument","skip_if":"cancel condition pre-entry","invalidation":"what proves thesis wrong post-entry","target":"realistic price target","claude":{"action":"BUY","confidence":75},"gpt":{"action":"BUY","confidence":72},"sl_adjust":0,"tp_adjust":0}

Rules:
- action: BUY, SELL, or SKIP (only these 3). This is the FINAL decision — the EA will execute or block based on it.
- confidence: 0-100. BE HONEST:
    • 90-100: textbook setup, every confluent factor aligned, HTF agrees, session right — full size
    • 75-89: strong, 4/5 factors — normal size
    • 60-74: decent but something's off — reduced size
    • 50-59: marginal — flag as low confidence, EA will reduce size further
    • <50: SKIP — do not send to execution
  Do NOT inflate. A downstream gate blocks trades below the configured minimum.
- reason: max 30 words
- thesis: 50-90 words — explain SETUP, HTF CONTEXT, SESSION TIMING, and WHY this edge exists NOW
- bearish_case: 30-60 words — genuine counter-argument. What would make this fail? What are you ignoring? MANDATORY even for 90%+ confidence.
- skip_if: 15-25 words — specific pre-entry cancellation condition
- invalidation: 15-25 words — post-entry thesis failure signal
- target: realistic target price or level grounded in the supplied completed M10 evidence
- claude: your own vote as Claude (action + confidence)
- gpt: simulate a GPT-style second opinion (action + confidence) — independent, can disagree
- sl_adjust: -1 to 1 (negative=tighter, positive=wider, 0=default)
- tp_adjust: -1 to 1 (negative=tighter, positive=wider, 0=default)

Key decision factors (in order of importance):
1. HTF consensus (H1+HTF both agree?) — strongest filter. Counter-consensus trades need 80%+ confidence.
2. Market regime — RANGING/LOW_VOL need HTF support. TRENDING allows more setups.
3. Session — London/NY overlap setups carry much higher weight.
4. Account state — if basket_float_pl is deeply negative, tighten standards. If on a loss streak, require 75%+ confidence.
5. Grade/score — A+ grade from the rule engine is a precondition, not a guarantee.
6. Spread — if spread > 2.5× ATR fraction, SKIP.

Be a professional. If the market is choppy with no consensus and you're on a 3-loss streak, SKIP. If HTF is clearly bullish and price is pulling back with RSI < 50, BUY with conviction. Think like the best human trader who never chases and never freezes.`;

function buildEntryPrompt(req: z.infer<typeof AIAnalysisRequestSchema>): string {
  const basketSign = req.basket_float_pl >= 0 ? "+" : "";
  const htfLine = `H1: ${req.h1_trend} | HTF Consensus: ${req.htf_consensus}`;
  const accountLine =
    `Account Equity: $${req.account_equity.toLocaleString()} | Daily P/L: ${req.daily_pct >= 0 ? "+" : ""}${req.daily_pct.toFixed(1)}% | ` +
    `Basket Float: ${basketSign}${req.basket_float_pl.toFixed(0)} USD`;
  const streakLine = `Last 10 trades: ${req.recent_wins}W / ${req.recent_losses}L | Open Positions: ${req.open_positions}`;
  const scoreLine = `Grade: ${req.grade || "N/A"} | Setup Score: ${req.setup_score.toFixed(1)} | Combined Score: ${req.combined_score.toFixed(1)}`;

  let candlesSection = "";
  if (req.recent_candles?.trim()) {
    const entries = req.recent_candles.trim().split(/\s+/);
    const total = Math.min(entries.length, 5);
    const labeled: string[] = [];
    entries.slice(-total).forEach((c, idx) => {
      const barOffset = total - idx;
      const parts = c.split("/");
      if (parts.length === 4) {
        const [o, h, l, cl] = parts as [string, string, string, string];
        const body = Number(cl) - Number(o);
        const direction = body >= 0 ? "bull" : "bear";
        const label = barOffset === 1 ? "most recent closed" : `${barOffset} bars ago`;
        labeled.push(`  [${label}]: O=${o} H=${h} L=${l} C=${cl} (${direction})`);
      }
    });
    if (labeled.length > 0) {
      candlesSection = "\nRECENT PRICE ACTION (completed M10 bars, oldest→newest)\n" + labeled.join("\n");
    }
  }

  return `XAUUSD M10 — AI DIRECTOR REVIEW

PRICE & INDICATORS
- Price: ${req.price} | ATR(14): ${req.atr} | Spread: ${req.spread.toFixed(0)} pts
- EMA Fast: ${req.ema_fast.toFixed(2)} | EMA Slow: ${req.ema_slow.toFixed(2)} (${req.ema_fast > req.ema_slow ? "ABOVE" : "BELOW"})
- RSI(14): ${req.rsi.toFixed(1)} | Stoch: ${req.stoch.toFixed(1)} | Momentum: ${req.mom >= 0 ? "+" : ""}${req.mom.toFixed(2)}
${candlesSection}
TREND & CONTEXT
- ${htfLine}
- Regime: ${req.regime || "unknown"} | Session: ${req.session || "unknown"} (quality: ${(req.session_quality * 100).toFixed(0)}%)

SETUP
- Strategy: ${req.setup || "unknown"} | Signature: ${req.signature}
- ${scoreLine}

ACCOUNT & RISK STATE
- ${accountLine}
- ${streakLine}

Your decision as AI Director (JSON only):`;
}

async function askEntryAi(provider: "anthropic" | "openai", model: string, req: z.infer<typeof AIAnalysisRequestSchema>): Promise<AiVerdict> {
  try {
    const chat = new LlmChat({ apiKey: LLM_KEY, sessionId: `entry-${provider}-${Math.random().toString(16).slice(2, 10)}`, systemMessage: ENTRY_SYSTEM_PROMPT });
    chat.withModel(provider, model);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let response: string;
    try {
      response = await chat.sendMessage(buildEntryPrompt(req));
    } finally {
      clearTimeout(timeout);
    }
    const result = parseEntryJson(response);
    if (result.ai_status === "Invalid AI Response") {
      result.available = false;
    } else {
      result.available = true;
      result.ai_status = "AI Decision";
    }
    return result;
  } catch (err) {
    const status = `${providerLabel(provider)} Error`;
    return {
      action: "SKIP",
      confidence: 0,
      reason: `${provider} error`,
      thesis: "",
      bearish_case: "",
      skip_if: "",
      invalidation: "",
      target: "",
      sl_adjust: 0,
      tp_adjust: 0,
      available: false,
      ai_status: err instanceof Error && err.name === "AbortError" ? `${providerLabel(provider)} Timeout` : status,
    };
  }
}

function shouldCallDualAi(req: z.infer<typeof AIAnalysisRequestSchema>, primary?: AiVerdict): boolean {
  const grade = (req.grade || "").toUpperCase();
  const highGrade = ["A", "A+", "B+"].includes(grade);
  const highScore = req.combined_score >= 6.0 || req.setup_score >= 5.0;
  let ambiguousPrimary = false;
  if (primary) {
    const conf = Math.trunc(primary.confidence || 0);
    ambiguousPrimary =
      (["BUY", "SELL"].includes(primary.action) && Math.abs(conf - Math.trunc(req.combined_score * 10)) >= env.AI_COST_DUAL_AI_CONFIDENCE_GAP) ||
      (conf >= 55 && conf <= 70);
  }
  const accountPressure = req.basket_float_pl < -75 || req.daily_pct < -1.5 || req.open_positions >= 2;
  return highGrade && (highScore || accountPressure || ambiguousPrimary);
}

function entryLocalOnlyResponse(reason: string, cacheKey: string): Record<string, unknown> {
  const status = reason.toLowerCase().includes("key not configured") ? "Provider Unavailable" : "Local Decision (Budget Guard)";
  return {
    action: "SKIP",
    confidence: 0,
    reason: reason.slice(0, 240),
    thesis: "",
    bearish_case: "",
    skip_if: "",
    invalidation: "",
    target: "",
    claude: null,
    gpt: null,
    sl_adjust: 0,
    tp_adjust: 0,
    consensus_source: "local_only_cost_guard",
    ai_status: status,
    provider_status: { claude: status, gpt: status },
    ai_cost: { ...aiCostSnapshot(), cache_key: cacheKey, reason },
  };
}

function combinedEntryAiStatus(claude: AiVerdict, gpt: AiVerdict, action: string, consensusSource: string): string {
  const cStatus = claude.ai_status ?? "AI Decision";
  const gStatus = gpt.ai_status ?? "AI Decision";
  const cOk = claude.available ?? true;
  const gOk = gpt.available ?? true;
  if (consensusSource === "local_only_cost_guard") return "Local Decision (Budget Guard)";
  if (["BUY", "SELL"].includes(action)) {
    if (!cOk && cStatus !== "Local Decision (Budget Guard)") return `AI Decision (${cStatus})`;
    if (!gOk && gStatus !== "Local Decision (Budget Guard)") return `AI Decision (${gStatus})`;
    return "AI Decision";
  }
  if (!cOk && cStatus !== "Local Decision (Budget Guard)") return cStatus;
  if (!gOk && gStatus !== "Local Decision (Budget Guard)") return gStatus;
  return "AI Decision";
}

/** Port of server.py's AI endpoints (lines 4409-5435). */
export async function registerAiRoutes(app: FastifyInstance): Promise<void> {
  // POST /ai/manage-position -- server.py:4409
  app.post("/ai/manage-position", async (request, reply) => {
    const req = PositionCheckRequestSchema.parse(request.body);
    if (!req.account_id) return reply.code(400).send({ detail: "account_id is required" });
    await resolveMonitorLicense(req.pin, req.account_id);

    try {
      if (!LLM_KEY) return { action: "HOLD", reason: "AI not configured", consensus_source: "local_only_cost_guard" };

      const { pin: _pin, ...payload } = req;
      const cacheKey = aiCostStateHash("exit", payload);
      const cached = aiCacheGet(cacheKey);
      if (cached) return cached;

      const highImpact = Boolean(req.pending_exit_reason) || Math.abs(req.profit) >= 75 || req.peak_profit >= 150;
      const [allowed, budgetReason] = aiBudgetAllows("exit", cacheKey, highImpact, req.account_id);
      if (!allowed) {
        return {
          action: "HOLD",
          reason: budgetReason,
          consensus_source: "local_only_cost_guard",
          ai_cost: { ...aiCostSnapshot(), cache_key: cacheKey, reason: budgetReason },
        };
      }

      const isVeto = Boolean(req.pending_exit_reason);
      const hasThesis = Boolean(req.thesis && req.thesis.length > 20);

      const systemMsg = isVeto
        ? `You are a XAUUSD M10 trade auditor. The bot's rule-based logic wants to CLOSE this position because of: ${req.pending_exit_reason}.

Your job: VETO the close if the original thesis is still intact, OR confirm if the rule is right.

RESPOND IN EXACTLY THIS JSON (no markdown fences):
{"action":"HOLD","reason":"short reason"}

Rules:
- action: HOLD (veto the close — let trade run) or CLOSE (confirm rule was right) or LOCK (close half OR move SL into profit by lock_usd amount).
- If action is LOCK include "lock_usd": <number> — the $ profit you want SL to bank as floor (the EA will move SL there).
- reason: max 30 words — reference whether the original thesis is still true.
- BIAS toward HOLD/LOCK over CLOSE — give winners room. Only CLOSE if the original thesis is invalidated or trend has clearly flipped against position.
- LOCK is your friend: if the trade is up but momentum is uncertain, LOCK $X (a fraction of current profit) to bank the win without giving up the runner.`
        : `You are a XAUUSD M10 trade auditor for an open position. Decide HOLD, CLOSE, or LOCK.

RESPOND IN EXACTLY THIS JSON (no markdown fences):
{"action":"HOLD","reason":"short reason"}

Rules:
- action: HOLD, CLOSE, or LOCK.
- If action is LOCK include "lock_usd": <number> — the $ profit you want SL to bank.
- reason: max 30 words.
- HOLD is the default — give trades time to work. Only CLOSE if the original thesis is invalidated or trend has clearly flipped against position.
- Use LOCK when profit is meaningful but you want to bank a floor without exiting. Example: profit $700 peak, now $600 with momentum slowing → LOCK $300.`;

      const chat = new LlmChat({ apiKey: LLM_KEY, sessionId: `manage-${Math.random().toString(16).slice(2, 10)}`, systemMessage: systemMsg });
      chat.withModel("anthropic", "claude-sonnet-4-5-20250929");

      const pnlStr = req.profit > 0 ? `+$${req.profit.toFixed(2)}` : `-$${Math.abs(req.profit).toFixed(2)}`;
      const peakStr = req.peak_profit > 0 ? `+$${req.peak_profit.toFixed(2)}` : "n/a";
      const giveback = req.peak_profit > req.profit ? req.peak_profit - req.profit : 0;
      let thesisBlock = "";
      if (hasThesis) {
        thesisBlock = `
ORIGINAL ENTRY THESIS:
"${req.thesis.slice(0, 400)}"

ORIGINAL INVALIDATION: "${req.invalidation ? req.invalidation.slice(0, 200) : "not specified"}"
ORIGINAL CONFIDENCE: ${req.confidence}/100
`;
      }
      const vetoBlock = isVeto ? `\n⚠️  RULE WANTS TO CLOSE: '${req.pending_exit_reason}'. Veto this if thesis is still intact.` : "";
      const htfLine = `HTF Consensus: ${req.htf_consensus} | Regime: ${req.regime || "unknown"} | Session: ${req.session || "unknown"}`;
      const perfLine = `R-Multiple: ${req.r_mult.toFixed(1)}R | Giveback from peak: $${giveback.toFixed(0)} | Daily P/L: ${req.daily_pct >= 0 ? "+" : ""}${req.daily_pct.toFixed(1)}% | Positions: ${req.open_positions}`;
      const prompt = `OPEN ${req.direction} POSITION — XAUUSD M10

POSITION STATE
- Entry: ${req.entry_price} | Now: ${req.current_price} | Lots: ${req.lots}
- P/L: ${pnlStr} | Peak: ${peakStr} | ${perfLine}
- Open: ${req.minutes_open} min | SL: ${req.sl} | TP: ${req.tp}
- Setup: ${req.setup_name || "unknown"}

MARKET STATE
- ${htfLine}
- EMA Fast: ${req.ema_fast.toFixed(2)} | EMA Slow: ${req.ema_slow.toFixed(2)} (${req.ema_fast > req.ema_slow ? "BULL" : "BEAR"})
- RSI: ${req.rsi.toFixed(1)} | ATR: ${req.atr.toFixed(2)}${vetoBlock}
${thesisBlock}
Decision (HOLD / CLOSE / LOCK)? JSON only.`;

      const response = await chat.sendMessage(prompt);
      const costMeta = recordAiCost(
        "anthropic",
        "claude-sonnet-4-5-20250929",
        `${systemMsg}\n${prompt}`,
        response,
        "exit",
        cacheKey,
        "exit conflict/news/profit-management audit",
        req.account_id,
      );

      let cleaned = response.trim();
      const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(cleaned);
      if (fence?.[1]) cleaned = fence[1].trim();
      if (!cleaned.startsWith("{")) {
        const m = /\{[\s\S]*\}/.exec(cleaned);
        if (m) cleaned = m[0];
      }
      try {
        const result = JSON.parse(cleaned) as Record<string, unknown>;
        result["action"] = String(result["action"] ?? "HOLD").toUpperCase();
        if (!["HOLD", "CLOSE", "LOCK"].includes(result["action"] as string)) result["action"] = "HOLD";
        result["reason"] = String(result["reason"] ?? "").slice(0, 200);
        if (result["action"] === "LOCK") {
          let lockUsd = Number(result["lock_usd"] ?? 0);
          if (!Number.isFinite(lockUsd)) lockUsd = 0;
          result["lock_usd"] = lockUsd;
          if (lockUsd <= 0) {
            result["action"] = "HOLD";
            result["reason"] = "LOCK requested but no lock_usd → HOLD";
          }
        }
        result["ai_cost"] = costMeta;
        aiCachePut(cacheKey, result, "exit", Number(costMeta["tokens"] ?? 0));
        return result;
      } catch {
        const up = response.toUpperCase();
        if (up.includes('"CLOSE"') || up.replace(/ /g, "").includes("ACTION:CLOSE")) {
          const result = { action: "CLOSE", reason: "parser fallback", ai_cost: costMeta };
          aiCachePut(cacheKey, result, "exit", Number(costMeta["tokens"] ?? 0));
          return result;
        }
        const result = { action: "HOLD", reason: "AI response unclear", ai_cost: costMeta };
        aiCachePut(cacheKey, result, "exit", Number(costMeta["tokens"] ?? 0));
        return result;
      }
    } catch (e) {
      return { action: "HOLD", reason: `Error: ${String(e).slice(0, 50)}` };
    }
  });

  // POST /ai/analyze -- server.py:4986
  app.post("/ai/analyze", async (request, reply) => {
    const req = AIAnalysisRequestSchema.parse(request.body);
    if (!req.account_id) return reply.code(400).send({ detail: "account_id is required" });
    await resolveMonitorLicense(req.pin, req.account_id);

    try {
      const { pin: _pin, ...payload } = req;
      const cacheKey = aiCostStateHash("entry", payload);
      const cached = aiCacheGet(cacheKey);
      if (cached) return cached;

      if (!LLM_KEY) return entryLocalOnlyResponse("AI key not configured", cacheKey);

      const grade = (req.grade || "").toUpperCase();
      const highImpact = ["A", "A+"].includes(grade) || req.combined_score >= 6.0 || req.basket_float_pl < -100;
      if (["", "SKIP"].includes(grade) || (req.combined_score > 0 && req.combined_score < 3.0)) {
        return entryLocalOnlyResponse("AI_COST_SKIP low-quality/no-trade state handled locally", cacheKey);
      }

      const [allowed, budgetReason] = aiBudgetAllows("entry", cacheKey, highImpact, req.account_id);
      if (!allowed) return entryLocalOnlyResponse(budgetReason, cacheKey);

      const promptForCost = ENTRY_SYSTEM_PROMPT + "\n" + buildEntryPrompt(req);
      const claude = await askEntryAi("anthropic", "claude-sonnet-4-5-20250929", req);
      const costEntries: Record<string, unknown>[] = [
        recordAiCost("anthropic", "claude-sonnet-4-5-20250929", promptForCost, JSON.stringify(claude), "entry", cacheKey, "primary entry confirmation", req.account_id),
      ];

      let gpt: AiVerdict;
      if (shouldCallDualAi(req, claude)) {
        const [secondAllowed, secondReason] = aiBudgetAllows("entry_dual", cacheKey, true, req.account_id);
        if (secondAllowed) {
          gpt = await askEntryAi("openai", "gpt-4o", req);
          costEntries.push(recordAiCost("openai", "gpt-4o", promptForCost, JSON.stringify(gpt), "entry_dual", cacheKey, "high-impact/ambiguous dual check", req.account_id));
        } else {
          gpt = {
            action: "SKIP", confidence: 0, reason: secondReason, thesis: "", bearish_case: "", skip_if: "",
            invalidation: "", target: "", sl_adjust: 0, tp_adjust: 0, available: false, ai_status: "Local Decision (Budget Guard)",
          };
        }
      } else {
        gpt = {
          action: "SKIP", confidence: 0, reason: "dual AI skipped to save cost", thesis: "", bearish_case: "", skip_if: "",
          invalidation: "", target: "", sl_adjust: 0, tp_adjust: 0, available: false, ai_status: "Local Decision (Budget Guard)",
        };
      }

      const cAct = claude.action;
      const gAct = gpt.action;
      const cConf = claude.confidence;
      const gConf = gpt.confidence;
      const cOk = claude.available ?? true;
      const gOk = gpt.available ?? true;

      let action: string;
      let confidence: number;
      let reason: string;
      let thesis: string;
      let bearishCase: string;
      let skipIf: string;
      let invalidation: string;
      let target: string;
      let slAdj: number;
      let tpAdj: number;

      if (cOk && gOk && cAct === gAct && ["BUY", "SELL"].includes(cAct)) {
        action = cAct;
        confidence = Math.min(100, Math.trunc((cConf + gConf) / 2) + 5);
        reason = `Both AIs agree: ${(claude.reason ?? "").slice(0, 60)} / ${(gpt.reason ?? "").slice(0, 60)}`;
        thesis = (claude.thesis ?? "").length >= (gpt.thesis ?? "").length ? (claude.thesis ?? "") : (gpt.thesis ?? "");
        bearishCase = `${claude.bearish_case ?? ""} | ${gpt.bearish_case ?? ""}`.replace(/^[ |]+|[ |]+$/g, "").slice(0, 500);
        skipIf = claude.skip_if || gpt.skip_if || "";
        invalidation = claude.invalidation || gpt.invalidation || "";
        target = claude.target || gpt.target || "";
        slAdj = (claude.sl_adjust + gpt.sl_adjust) / 2;
        tpAdj = (claude.tp_adjust + gpt.tp_adjust) / 2;
      } else if (cOk && gOk && ["BUY", "SELL"].includes(cAct) && ["BUY", "SELL"].includes(gAct) && cAct !== gAct) {
        action = "SKIP";
        confidence = 50;
        reason = `Disagreement: Claude=${cAct}(${cConf}) GPT=${gAct}(${gConf}) — safety SKIP`;
        thesis = `Claude wanted ${cAct}: ${(claude.thesis ?? "").slice(0, 120)}. GPT wanted ${gAct}: ${(gpt.thesis ?? "").slice(0, 120)}. Conflicting reads — staying flat.`;
        bearishCase = "";
        skipIf = "";
        invalidation = "";
        target = "";
        slAdj = 0;
        tpAdj = 0;
      } else if (cOk && ["BUY", "SELL"].includes(cAct) && (!gOk || gAct === "SKIP")) {
        const penalty = !gOk ? 1.0 : 0.8;
        action = cAct;
        confidence = Math.max(0, Math.min(100, Math.trunc(cConf * penalty)));
        reason = `Claude says ${cAct} (${cConf}%), ${!gOk ? "GPT unavailable" : "GPT SKIP"}: ${(claude.reason ?? "").slice(0, 80)}`;
        thesis = claude.thesis ?? "";
        bearishCase = claude.bearish_case ?? "";
        skipIf = claude.skip_if ?? "";
        invalidation = claude.invalidation ?? "";
        target = claude.target ?? "";
        slAdj = claude.sl_adjust;
        tpAdj = claude.tp_adjust;
      } else if (gOk && ["BUY", "SELL"].includes(gAct) && (!cOk || cAct === "SKIP")) {
        const penalty = !cOk ? 1.0 : 0.8;
        action = gAct;
        confidence = Math.max(0, Math.min(100, Math.trunc(gConf * penalty)));
        reason = `GPT says ${gAct} (${gConf}%), ${!cOk ? "Claude unavailable" : "Claude SKIP"}: ${(gpt.reason ?? "").slice(0, 80)}`;
        thesis = gpt.thesis ?? "";
        bearishCase = gpt.bearish_case ?? "";
        skipIf = gpt.skip_if ?? "";
        invalidation = gpt.invalidation ?? "";
        target = gpt.target ?? "";
        slAdj = gpt.sl_adjust;
        tpAdj = gpt.tp_adjust;
      } else {
        action = "SKIP";
        if (cOk && gOk) {
          confidence = 50;
          reason = `Both AIs genuinely say SKIP (claude=${cConf}%, gpt=${gConf}%)`;
        } else {
          confidence = 0;
          reason = `Both SKIP/unavailable (claude_ok=${cOk}, gpt_ok=${gOk}) — no real AI judgment made`;
        }
        thesis = ((claude.thesis || gpt.thesis) ?? "").slice(0, 400);
        bearishCase = "";
        skipIf = "";
        invalidation = "";
        target = "";
        slAdj = 0;
        tpAdj = 0;
      }

      let consensusSource: string;
      if (cOk && gOk && cAct === gAct && ["BUY", "SELL"].includes(cAct)) consensusSource = "dual_consensus";
      else if (cOk && ["BUY", "SELL"].includes(cAct) && (!gOk || gAct === "SKIP")) consensusSource = "claude_only";
      else if (gOk && ["BUY", "SELL"].includes(gAct) && (!cOk || cAct === "SKIP")) consensusSource = "gpt_only";
      else consensusSource = "none";

      const aiStatus = combinedEntryAiStatus(claude, gpt, action, consensusSource);
      const providerStatus = { claude: claude.ai_status ?? "AI Decision", gpt: gpt.ai_status ?? "AI Decision" };

      const result: Record<string, unknown> = {
        action,
        confidence,
        reason: reason.slice(0, 240),
        ai_status: aiStatus,
        provider_status: providerStatus,
        thesis: (thesis || "").slice(0, 500),
        bearish_case: (bearishCase || "").slice(0, 500),
        skip_if: (skipIf || "").slice(0, 200),
        invalidation: (invalidation || "").slice(0, 200),
        target: (target || "").slice(0, 200),
        sl_adjust: slAdj,
        tp_adjust: tpAdj,
        consensus_source: consensusSource,
        claude: { action: cAct, confidence: cConf, reason: claude.reason, available: cOk },
        gpt: { action: gAct, confidence: gConf, reason: gpt.reason, available: gOk },
        ai_cost: { ...aiCostSnapshot(), cache_hit: false, cache_key: cacheKey, call_reasons: costEntries },
      };

      const noCacheStatuses = new Set(["Claude Timeout", "GPT Timeout", "Claude Error", "GPT Error", "Invalid AI Response", "Provider Unavailable"]);
      if (!noCacheStatuses.has(aiStatus)) {
        aiCachePut(cacheKey, result, "entry", costEntries.reduce((s, x) => s + (Number(x["tokens"]) || 0), 0));
      }

      try {
        await getDb().collection("ai_analyses").insertOne({
          symbol: req.symbol,
          account: req.account_id,
          request: payload,
          response: result,
          signature: req.signature,
          created_at: new Date().toISOString(),
        });
      } catch {
        /* best-effort, matches Python's bare except: pass */
      }

      return result;
    } catch (e) {
      return {
        action: "SKIP",
        confidence: 0,
        reason: `AI error: ${String(e).slice(0, 60)} — no real AI judgment made`,
        thesis: "",
        bearish_case: "",
        skip_if: "",
        invalidation: "",
        target: "",
        claude: null,
        gpt: null,
        sl_adjust: 0,
        tp_adjust: 0,
        consensus_source: "none",
        ai_status: "Provider Unavailable",
        provider_status: { claude: "Provider Unavailable", gpt: "Provider Unavailable" },
      };
    }
  });

  // GET /ai/cost/stats -- server.py:5184
  app.get("/ai/cost/stats", async () => aiCostSnapshot());

  // POST /ai/memory/record -- server.py:5188
  app.post("/ai/memory/record", async (request, reply) => {
    const record = TradeMemoryRecordSchema.parse(request.body);
    if (!record.account) return reply.code(400).send({ detail: "account is required" });
    const lic = await resolveMonitorLicense(record.pin, record.account);
    try {
      const { pin: _pin, ...rest } = record;
      const data: Record<string, unknown> = { ...rest };
      data["license_id"] = lic?.["id"] ?? "";
      data["recorded_at"] = new Date().toISOString();
      data["memory_hash"] = tradeMemoryStateHash(data);
      data["bad_data_ignored"] = false;
      if (!data["symbol"] || !data["strategy"] || Number(data["lot_size"] ?? 0) < 0) {
        data["bad_data_ignored"] = true;
        return { status: "ignored", reason: "bad memory data" };
      }
      await appendTradeMemory(data);
      try {
        await getDb().collection("ai_trade_memory").insertOne({ ...data });
      } catch {
        /* best-effort */
      }
      return { status: "ok", memory_hash: data["memory_hash"] };
    } catch (e) {
      return { status: "error", detail: String(e) };
    }
  });

  // POST /ai/memory/query -- server.py:5214 (retired, 410)
  app.post("/ai/memory/query", async (_request, reply) => {
    return reply.code(410).send({ detail: "This endpoint is retired." });
  });

  // GET /ai/memory/report -- server.py:5225
  app.get("/ai/memory/report", async (request) => {
    const q = z.object({ pin: z.string().optional().default(""), account: z.string().optional().default(""), limit: z.coerce.number().optional().default(2000) }).parse(request.query);
    const lic = await resolveMonitorLicense(q.pin, q.account);
    try {
      let rows = await loadTradeMemory(Math.max(100, Math.min(q.limit, 10000)));
      rows = rows.filter(
        (row) => row["license_id"] === (lic?.["id"] ?? "") || normalizeLicenseKey(String(row["pin"] ?? "")) === normalizeLicenseKey(q.pin),
      );
      const buckets = new Map<string, Record<string, unknown>[]>();
      for (const row of rows) {
        const key = [row["strategy"] ?? "UNKNOWN", row["direction"] ?? "NA", row["session"] ?? "NA", row["grade"] ?? "NA"].join("|");
        const arr = buckets.get(key) ?? [];
        arr.push(row);
        buckets.set(key, arr);
      }
      const lines = [
        "# XauCloud Conscious Memory Report",
        "",
        `Generated: ${new Date().toISOString()}`,
        `Records: ${rows.length}`,
        "",
        "Memory influence tiers: 1 similar memory = information only; 5 similar memories = weak influence; 20+ similar memories = strong influence; 50+ similar memories = trusted pattern.",
        "",
      ];
      const summaries: [number, number, string, Record<string, unknown>][] = [];
      for (const [key, vals] of buckets) {
        const parts = key.split("|");
        const rec = buildMemoryRecommendation({ strategy: parts[0], direction: parts[1] }, vals);
        summaries.push([Number(rec["similar_memories"]), Number(rec["win_rate"]), key, rec]);
      }
      summaries.sort((a, b) => (b[0] - a[0]) || (b[1] - a[1]));
      for (const [, , key, rec] of summaries.slice(0, 30)) {
        lines.push(
          `## ${key}`,
          `- Samples: ${rec["similar_memories"]} (${rec["confidence_weight"]})`,
          `- Win rate: ${rec["win_rate"]}%`,
          `- Avg MFE/MAE: ${rec["avg_mfe"]} / ${rec["avg_mae"]}`,
          `- Early-exit rate: ${rec["early_exit_rate"]}%`,
          `- Recommendation: ${rec["recommendation"]}`,
          "",
        );
      }
      const report = lines.join("\n");
      await writeTradeMemoryReport(report);
      return { status: "ok", records: rows.length, report_path: "ai_trade_memory_report.md", report };
    } catch (e) {
      return { status: "error", detail: String(e) };
    }
  });

  // POST /ai/feedback -- server.py:5276
  app.post("/ai/feedback", async (request, reply) => {
    const data = (request.body ?? {}) as Record<string, unknown>;
    const pin = String(data["pin"] ?? "");
    const account = String(data["account_id"] ?? data["account"] ?? "");
    if (!account) return reply.code(400).send({ detail: "account_id is required" });
    const lic = await resolveMonitorLicense(pin, account);
    try {
      const { pin: _pin, ...rest } = data;
      const record = { ...rest, license_id: lic?.["id"] ?? "", account_id: account, recorded_at: new Date().toISOString() };
      await appendFile(AI_FEEDBACK_PATH, `${JSON.stringify(record)}\n`, "utf8");
      try {
        await getDb().collection("ai_feedback").insertOne({ ...record });
      } catch {
        /* best-effort */
      }
      return { status: "ok" };
    } catch (e) {
      return { status: "error", detail: String(e) };
    }
  });

  // GET /ai/feedback/stats -- server.py:5302
  app.get("/ai/feedback/stats", async (request) => {
    const q = z.object({ pin: z.string().optional().default(""), account: z.string().optional().default("") }).parse(request.query);
    const lic = await resolveMonitorLicense(q.pin, q.account);
    try {
      if (!existsSync(AI_FEEDBACK_PATH)) return { total: 0, message: "no feedback recorded yet" };
      const content = await readFile(AI_FEEDBACK_PATH, "utf8");
      let records: Record<string, unknown>[] = [];
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          records.push(JSON.parse(trimmed));
        } catch {
          continue;
        }
      }
      records = records.filter(
        (r) => r["license_id"] === (lic?.["id"] ?? "") || normalizeLicenseKey(String(r["pin"] ?? "")) === normalizeLicenseKey(q.pin),
      );
      const total = records.length;
      if (total === 0) return { total: 0, message: "no feedback recorded yet" };

      const isCorrect = (r: Record<string, unknown>) => ["CORRECT", "CONSERVATIVE_CORRECT"].includes(String(r["outcome"] ?? ""));
      const correct = records.filter(isCorrect).length;
      const accuracy = total > 0 ? correct / total : 0.0;

      const bands: Record<string, { total: number; correct: number }> = {
        "0-49": { total: 0, correct: 0 },
        "50-64": { total: 0, correct: 0 },
        "65-79": { total: 0, correct: 0 },
        "80-100": { total: 0, correct: 0 },
      };
      const byStrategy: Record<string, { total: number; correct: number }> = {};
      const bySession: Record<string, { total: number; correct: number }> = {};
      const byDirection: Record<string, { total: number; correct: number }> = {};

      for (const r of records) {
        const c = Math.trunc(Number(r["ai_confidence"] ?? 0));
        const band = c < 50 ? "0-49" : c < 65 ? "50-64" : c < 80 ? "65-79" : "80-100";
        const ok = isCorrect(r);
        bands[band]!.total += 1;
        if (ok) bands[band]!.correct += 1;

        const strat = String(r["strategy"] ?? "UNKNOWN");
        const sess = String(r["session"] ?? "UNKNOWN");
        const dirn = String(r["direction"] ?? "UNKNOWN");
        byStrategy[strat] ??= { total: 0, correct: 0 };
        bySession[sess] ??= { total: 0, correct: 0 };
        byDirection[dirn] ??= { total: 0, correct: 0 };
        byStrategy[strat].total += 1;
        bySession[sess].total += 1;
        byDirection[dirn].total += 1;
        if (ok) {
          byStrategy[strat].correct += 1;
          bySession[sess].correct += 1;
          byDirection[dirn].correct += 1;
        }
      }

      const withAccuracy = (d: Record<string, { total: number; correct: number }>) =>
        Object.fromEntries(
          Object.entries(d).map(([k, v]) => [k, { ...v, accuracy: v.total > 0 ? Math.round((v.correct / v.total) * 10000) / 10000 : 0.0 }]),
        );

      return {
        total,
        correct,
        accuracy: Math.round(accuracy * 10000) / 10000,
        by_confidence: withAccuracy(bands),
        by_strategy: withAccuracy(byStrategy),
        by_session: withAccuracy(bySession),
        by_direction: withAccuracy(byDirection),
      };
    } catch (e) {
      return { error: String(e) };
    }
  });

  // GET /ai/calibration -- server.py:5380
  app.get("/ai/calibration", async () => {
    if (!existsSync(AI_FEEDBACK_PATH)) {
      return { calibrated: false, multipliers: {}, sample_counts: {}, message: "insufficient data" };
    }
    const bands: Record<string, boolean[]> = { "0-49": [], "50-64": [], "65-79": [], "80-100": [] };
    try {
      const content = await readFile(AI_FEEDBACK_PATH, "utf8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const r = JSON.parse(trimmed) as Record<string, unknown>;
          const conf = Math.trunc(Number(r["ai_confidence"] ?? 0));
          const correct = ["CORRECT", "CONSERVATIVE_CORRECT"].includes(String(r["outcome"] ?? ""));
          if (conf < 50) bands["0-49"]!.push(correct);
          else if (conf < 65) bands["50-64"]!.push(correct);
          else if (conf < 80) bands["65-79"]!.push(correct);
          else bands["80-100"]!.push(correct);
        } catch {
          continue;
        }
      }
    } catch (e) {
      return { calibrated: false, multipliers: {}, sample_counts: {}, message: String(e) };
    }

    const midMap: Record<string, number> = { "0-49": 25, "50-64": 57, "65-79": 72, "80-100": 88 };
    const result: { calibrated: boolean; multipliers: Record<string, number>; sample_counts: Record<string, number>; message?: string } = {
      calibrated: true,
      multipliers: {},
      sample_counts: {},
    };
    let anyCalibrated = false;
    for (const [band, outcomes] of Object.entries(bands)) {
      const n = outcomes.length;
      result.sample_counts[band] = n;
      if (n >= 10) {
        const actualWr = outcomes.filter(Boolean).length / n;
        const claimedWr = midMap[band]! / 100.0;
        let calibrationRatio = claimedWr > 0 ? actualWr / claimedWr : 1.0;
        calibrationRatio = Math.max(0.7, Math.min(1.3, calibrationRatio));
        result.multipliers[band] = Math.round(calibrationRatio * 1000) / 1000;
        anyCalibrated = true;
      } else {
        result.multipliers[band] = 1.0;
      }
    }
    if (!anyCalibrated) {
      result.calibrated = false;
      result.message = "insufficient data (need >= 10 samples per band)";
    } else {
      result.message = "ok";
    }
    return result;
  });
}
