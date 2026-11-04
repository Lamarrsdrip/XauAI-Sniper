import { createHash, timingSafeEqual } from "node:crypto";

/** Source selection uses the existing XauCloud MT5 heartbeat/evidence network. */
export interface ExistingMt5Source {
  account: string;
  heartbeat_at: string;
  quote_at: string;
  bid: number;
  ask: number;
}

export interface HeartbeatRow {
  account_number?: unknown;
  ts?: unknown;
}
export interface EvidenceRow {
  account?: unknown;
  observed_at?: unknown;
  bid?: unknown;
  ask?: unknown;
}

function positive(x: unknown): number | null {
  return typeof x === "number" && Number.isFinite(x) && x > 0 ? x : null;
}

/** Pure assembly of the latest quote per account that also has a heartbeat. */
export function assembleApprovedSources(heartbeats: readonly HeartbeatRow[], evidence: readonly EvidenceRow[]): ExistingMt5Source[] {
  const latestHeartbeat = new Map<string, string>();
  for (const h of heartbeats) {
    const id = String(h.account_number ?? "");
    if (!latestHeartbeat.has(id)) latestHeartbeat.set(id, String(h.ts ?? ""));
  }
  const latestQuotes = new Map<string, ExistingMt5Source>();
  for (const e of evidence) {
    const account = String(e.account ?? "");
    if (latestQuotes.has(account) || !latestHeartbeat.has(account)) continue;
    const bid = positive(e.bid);
    const ask = positive(e.ask);
    if (bid === null || ask === null) continue;
    latestQuotes.set(account, {
      account,
      heartbeat_at: latestHeartbeat.get(account)!,
      quote_at: String(e.observed_at ?? ""),
      bid,
      ask,
    });
  }
  return [...latestQuotes.values()];
}

export function selectConnectedMt5Source(
  candidates: ExistingMt5Source[], now = Date.now(),
  limits = { heartbeatMs: 90_000, quoteMs: 75_000 },
): ExistingMt5Source | null {
  const fresh = candidates.filter((x) => {
    const hb = Date.parse(x.heartbeat_at), qt = Date.parse(x.quote_at);
    return /^\d{3,20}$/.test(x.account) && Number.isFinite(hb) && Number.isFinite(qt)
      && hb <= now + 5000 && qt <= now + 5000 && now - hb >= -5000 && now - qt >= -5000
      && now - hb <= limits.heartbeatMs && now - qt <= limits.quoteMs
      && Number.isFinite(x.bid) && Number.isFinite(x.ask)
      && x.bid > 0 && x.ask >= x.bid && x.ask - x.bid < 30;
  });
  fresh.sort((a, b) => Date.parse(b.quote_at) - Date.parse(a.quote_at));
  return fresh[0] ?? null;
}

export interface NativeSignalDecision {
  status: "ACTIONABLE" | "NO_TRADE";
  direction: "BUY" | "SELL" | "NO_TRADE";
  engine: string;
  signalId: string;
  entry: number | null;
  stop: number | null;
  takeProfit: number | null;
  rationale: string;
}

/**
 * The publisher's native signal only. Missing, stale, expired or level-less
 * evidence stays NO_TRADE. This never invents an entry, stop or take-profit.
 */
export function decideNativeSignal(latest: Record<string, unknown> | null | undefined, now = Date.now()): NativeSignalDecision {
  const age = latest ? now - Date.parse(String(latest["updated_at"] ?? "")) : Infinity;
  const signalFresh = latest && Number.isFinite(age) && age >= -5000 && age <= 90_000 ? latest : null;
  const direction = String(signalFresh?.["direction"] ?? "").toUpperCase();
  const validLevels = positive(signalFresh?.["entry"]) !== null && positive(signalFresh?.["stop"]) !== null
    && positive(signalFresh?.["tp1"]) !== null;
  const expiresRaw = signalFresh?.["expires_at"];
  const unexpired = !expiresRaw || Date.parse(String(expiresRaw)) > now;
  const actionable = signalFresh?.["status"] === "ACTIONABLE"
    && (direction === "BUY" || direction === "SELL")
    && validLevels && unexpired;
  return {
    status: actionable ? "ACTIONABLE" : "NO_TRADE",
    direction: actionable ? direction : "NO_TRADE",
    engine: String(signalFresh?.["engine"] ?? "XauCloud"),
    signalId: String(signalFresh?.["signal_id"] ?? "").slice(0, 90),
    entry: actionable ? positive(signalFresh?.["entry"]) : null,
    stop: actionable ? positive(signalFresh?.["stop"]) : null,
    takeProfit: actionable ? positive(signalFresh?.["tp1"]) : null,
    rationale: String(signalFresh?.["rationale"] ?? "No fresh native actionable signal").slice(0, 600),
  };
}

/** Quote payload expiry. A non-positive remaining window is not deliverable. */
export function quoteExpiresAt(quoteAt: string, now = Date.now()): string | null {
  const quoteMs = Date.parse(quoteAt);
  if (!Number.isFinite(quoteMs)) return null;
  const expiresMs = Math.min(now + 60_000, quoteMs + 75_000);
  if (expiresMs <= now) return null;
  return new Date(expiresMs).toISOString();
}

export function agentFamilyReadAuthorized(auth: unknown, token = process.env["XAUCLOUD_AGENT_FAMILY_READ_TOKEN"] || ""): boolean {
  const expectedToken = token.trim();
  if (expectedToken.length < 32 || !/^Bearer [^\s]+$/.test(String(auth ?? ""))) return false;
  const presented = createHash("sha256").update(String(auth).slice(7)).digest();
  const expected = createHash("sha256").update(expectedToken).digest();
  return timingSafeEqual(presented, expected);
}

export function approvedAgentFamilyAccounts(settings: Record<string, unknown>, extrasEnv = process.env["XAUCLOUD_AGENT_FAMILY_SOURCE_ACCOUNTS"] || ""): string[] {
  const existing = [settings["subscriber_signal_source_account"], settings["subscriber_signal_backup_source_account"]];
  const extras = String(extrasEnv).split(",");
  return [...new Set([...existing, ...extras].map((x) => String(x || "").trim()))]
    .filter((x) => /^\d{3,20}$/.test(x)).slice(0, 12);
}
