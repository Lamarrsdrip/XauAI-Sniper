import { getDb } from "../../db.js";
import { getSettings } from "../settings.js";
import { isMarketOpen } from "../marketCalendar.js";
import { MARKET_EVIDENCE_COLLECTION } from "../marketIntelligenceConfig.js";
import {
  approvedAgentFamilyAccounts,
  assembleApprovedSources,
  decideNativeSignal,
  quoteExpiresAt,
  selectConnectedMt5Source,
  type ExistingMt5Source,
} from "../agentFamilySource.js";
import type { MarketContext, QuotePoint } from "./fulfillment.js";

export interface SourceHealth {
  approved: number;
  fresh: boolean;
  quoteTime: string | null;
  spread: number | null;
  accountTail: string | null;
  spreadSamples: number;
}

export async function loadMarketContext(now = new Date()): Promise<{ context: MarketContext; health: SourceHealth; selected: ExistingMt5Source | null }> {
  const settings = await getSettings();
  const accounts = approvedAgentFamilyAccounts(settings);
  const empty: MarketContext = { fresh: false, quote: null, nativeSignal: null, spreadSamples: [], marketOpen: isMarketOpen(now), capturedAt: now.toISOString() };
  if (!accounts.length) return { context: empty, health: { approved: 0, fresh: false, quoteTime: null, spread: null, accountTail: null, spreadSamples: 0 }, selected: null };
  const db = getDb();
  const heartbeatRows = await db.collection("cloud_bot_heartbeats").find(
    { account_number: { $in: accounts } },
    { projection: { _id: 0, account_number: 1, ts: 1 }, sort: { ts: -1 }, limit: 200 },
  ).toArray();
  const evidence = await db.collection(MARKET_EVIDENCE_COLLECTION).find(
    { account: { $in: accounts }, normalized_symbol: "XAUUSD", quote_valid: true },
    { projection: { _id: 0, account: 1, observed_at: 1, bid: 1, ask: 1 }, sort: { observed_at: -1 }, limit: 400 },
  ).toArray();
  const assembled = assembleApprovedSources(heartbeatRows as never, evidence as never);
  const selected = selectConnectedMt5Source(assembled, now.getTime());
  const samples: QuotePoint[] = [];
  if (selected) {
    for (const row of evidence) {
      if (String(row["account"] ?? "") !== selected.account) continue;
      const bid = typeof row["bid"] === "number" ? row["bid"] : null;
      const ask = typeof row["ask"] === "number" ? row["ask"] : null;
      if (bid === null || ask === null) continue;
      samples.push({ bid, ask, time: String(row["observed_at"] ?? "") });
      if (samples.length >= 200) break;
    }
  }
  if (!selected || !quoteExpiresAt(selected.quote_at, now.getTime())) {
    return {
      context: { ...empty, spreadSamples: samples },
      health: { approved: accounts.length, fresh: false, quoteTime: selected?.quote_at ?? null, spread: null, accountTail: selected ? selected.account.slice(-4) : null, spreadSamples: samples.length },
      selected: null,
    };
  }
  const latest = await db.collection("subscriber_signals").findOne(
    { source_account: selected.account, symbol: { $regex: "^(XAUUSD|GOLD)", $options: "i" } },
    { projection: { _id: 0, signal_id: 1, engine: 1, status: 1, direction: 1, entry: 1, stop: 1, tp1: 1, rationale: 1, expires_at: 1, updated_at: 1 }, sort: { updated_at: -1 } },
  );
  const context: MarketContext = {
    fresh: true,
    quote: { bid: selected.bid, ask: selected.ask, time: selected.quote_at },
    nativeSignal: decideNativeSignal(latest, now.getTime()),
    spreadSamples: samples,
    marketOpen: isMarketOpen(now),
    capturedAt: now.toISOString(),
  };
  return {
    context,
    health: {
      approved: accounts.length,
      fresh: true,
      quoteTime: selected.quote_at,
      spread: Math.round((selected.ask - selected.bid) * 10000) / 10000,
      accountTail: selected.account.slice(-4),
      spreadSamples: samples.length,
    },
    selected,
  };
}
