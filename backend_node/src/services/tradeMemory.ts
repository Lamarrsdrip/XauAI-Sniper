import { createHash } from "node:crypto";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

// Port of server.py:144-145 TRADE_MEMORY_PATH/TRADE_MEMORY_REPORT_PATH --
// same convention (files live next to the running backend process).
const TRADE_MEMORY_PATH = path.join(process.cwd(), "ai_trade_memory.jsonl");
const TRADE_MEMORY_REPORT_PATH = path.join(process.cwd(), "ai_trade_memory_report.md");
const AI_FEEDBACK_PATH = path.join(process.cwd(), "ai_feedback_log.jsonl");

export { TRADE_MEMORY_PATH, TRADE_MEMORY_REPORT_PATH, AI_FEEDBACK_PATH };

/** Port of server.py:4680 `_trade_memory_state_hash`. */
export function tradeMemoryStateHash(data: Record<string, unknown>): string {
  const fields: Record<string, string> = {
    symbol: String(data["symbol"] ?? "").toUpperCase(),
    account: String(data["account"] ?? ""),
    broker: String(data["broker"] ?? "").toUpperCase(),
    strategy: String(data["strategy"] ?? "").toUpperCase(),
    direction: String(data["direction"] ?? "").toUpperCase(),
    session: String(data["session"] ?? "").toUpperCase(),
    grade: String(data["grade"] ?? "").toUpperCase(),
    regime: String(data["market_regime"] ?? data["volatility"] ?? "").toUpperCase(),
    spread_state: String(data["spread_state"] ?? "").toUpperCase(),
    htf_trend: String(data["htf_trend"] ?? "").toUpperCase(),
    news_state: String(data["news_state"] ?? "").toUpperCase(),
  };
  return createHash("sha256").update(JSON.stringify(fields, Object.keys(fields).sort()), "utf8").digest("hex").slice(0, 24);
}

/** Port of server.py:4699 `_load_trade_memory`. */
export async function loadTradeMemory(limit = 5000): Promise<Record<string, unknown>[]> {
  if (!existsSync(TRADE_MEMORY_PATH)) return [];
  const content = await readFile(TRADE_MEMORY_PATH, "utf8");
  const rows: Record<string, unknown>[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch {
      continue;
    }
  }
  return rows.slice(-limit);
}

export async function appendTradeMemory(data: Record<string, unknown>): Promise<void> {
  await appendFile(TRADE_MEMORY_PATH, `${JSON.stringify(data)}\n`, "utf8");
}

/** Port of server.py:4735 `_memory_confidence_weight`. */
export function memoryConfidenceWeight(samples: number): string {
  if (samples >= 50) return "trusted pattern";
  if (samples >= 20) return "strong influence";
  if (samples >= 5) return "weak influence";
  return "information only";
}

/** Port of server.py:4748 `_build_memory_recommendation`. */
export function buildMemoryRecommendation(
  query: Record<string, unknown>,
  matches: Record<string, unknown>[],
): Record<string, unknown> {
  const samples = matches.length;
  const wins = matches.filter((r) => Number(r["profit_at_close"] ?? 0) > 0).length;
  const losses = matches.filter((r) => Number(r["profit_at_close"] ?? 0) < 0).length;
  const wr = samples ? Math.round((wins / samples) * 1000) / 10 : 0.0;
  const avg = (key: string): number =>
    samples ? Math.round((matches.reduce((s, r) => s + Number(r[key] ?? 0), 0) / samples) * 100) / 100 : 0.0;
  const avgMfe = avg("max_floating_profit");
  const avgMae = avg("max_floating_loss");
  const avgLeft = avg("profit_left_after_exit");
  const early = matches.filter(
    (r) => Boolean(r["should_hold_longer"]) || String(r["exit_quality"] ?? "").toUpperCase().includes("EARLY"),
  ).length;
  const earlyRate = samples ? Math.round((early / samples) * 1000) / 10 : 0.0;
  const influence = memoryConfidenceWeight(samples);

  let recommendation = "record only; not enough aggregate evidence";
  if (samples >= 5) {
    if (earlyRate >= 60.0 && avgLeft > 0) {
      recommendation = "reduce early-exit pressure; similar trades often left profit after close";
    } else if (wr <= 35.0 && losses > wins) {
      recommendation = "reduce lot or require stronger confirmation; similar setups have weak expectancy";
    } else if (wr >= 62.0 && avgMfe > Math.abs(avgMae)) {
      recommendation = "allow normal trade management; similar setups show positive follow-through";
    } else {
      recommendation = "neutral memory influence; keep local rules in control";
    }
  }

  const text =
    `AI-MEMORY: Found ${samples} similar ${query["strategy"] ?? "UNKNOWN"} ` +
    `${query["direction"] ?? ""} setups. Win rate: ${wr}%. Avg MFE: ${avgMfe}. ` +
    `Avg MAE: ${avgMae}. Early-exit rate: ${earlyRate}%. ` +
    `Confidence: ${influence}. Recommendation: ${recommendation}.`;

  return {
    similar_memories: samples,
    wins,
    losses,
    win_rate: wr,
    avg_mfe: avgMfe,
    avg_mae: avgMae,
    avg_profit_left_after_exit: avgLeft,
    early_exit_rate: earlyRate,
    confidence_weight: influence,
    recommendation,
    text,
  };
}

export async function writeTradeMemoryReport(content: string): Promise<void> {
  await writeFile(TRADE_MEMORY_REPORT_PATH, content, "utf8");
}
