import { getDb } from "../db.js";
import { LicenseError } from "./license.js";

/**
 * Port of server.py:5900 -- explicit remote-command state machine (v6.25.6
 * XAU-027). Terminal statuses are immutable: once a command reaches one of
 * these, no further acknowledgement may change it, regardless of what a
 * late/replayed/cross-terminal EA request claims. This map is the single
 * source of truth for which transitions may ever be attempted.
 */
export const COMMAND_TERMINAL_STATUSES = new Set(["EXECUTED", "FAILED", "SKIPPED", "EXPIRED"]);

export const COMMAND_ALLOWED_SOURCE_STATUSES: Record<string, Set<string>> = {
  ACKED: new Set(["PENDING"]),
  EXECUTED: new Set(["PENDING", "ACKED"]),
  FAILED: new Set(["PENDING", "ACKED"]),
  SKIPPED: new Set(["PENDING", "ACKED"]),
};

/** Port of server.py:5918 `SAFE_REMOTE_COMMANDS`. */
export const SAFE_REMOTE_COMMANDS: Record<string, string> = {
  PAUSE_NEW_TRADES: "Pause new trades",
  RESUME_TRADING: "Resume trading",
  STOP_TRADING: "Stop trading",
  CLOSE_ALL_TRADES: "Close all trades",
  FORCE_CLOSE_TRADE: "Force-close one exact ticket",
  FORCE_SYNC: "Force startup intelligence sync",
  FORCE_REPORT_UPLOAD: "Force report upload marker",
  UPDATE_PROP_FIRM_CONFIG: "Update prop firm protection",
  FORCE_OPEN_TRADE: "Manually force-open a blocked candidate",
  MANUAL_OPEN_NOW: "Manually open a fresh trade immediately (owner override, no candidate required)",
};

/** Port of server.py:5931 `REMOTE_COMMAND_EXPIRY_MINUTES`. */
export const REMOTE_COMMAND_EXPIRY_MINUTES: Record<string, number> = {
  FORCE_OPEN_TRADE: 15,
  FORCE_CLOSE_TRADE: 5,
  CLOSE_ALL_TRADES: 5,
  PAUSE_NEW_TRADES: 15,
  STOP_TRADING: 15,
  RESUME_TRADING: 15,
  FORCE_SYNC: 30,
  FORCE_REPORT_UPLOAD: 30,
  UPDATE_PROP_FIRM_CONFIG: 60,
  MANUAL_OPEN_NOW: 3,
};

/** Port of server.py:5976 `_normalize_force_open_payload`. */
export function normalizeForceOpenPayload(payload: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const raw = payload ?? {};
  const direction = String(raw["direction"] ?? "").trim().toUpperCase();
  if (direction !== "BUY" && direction !== "SELL") {
    throw new LicenseError(400, "Force-open requires a valid BUY or SELL direction.");
  }
  const setup = String(raw["setup"] ?? "").trim();
  if (!setup) throw new LicenseError(400, "Force-open requires the original setup name.");
  const grade = String(raw["grade"] ?? "").trim().toUpperCase() || "B";
  const originalBlocker = String(raw["original_blocker"] ?? "").trim() || "UNKNOWN";
  const candleTime = Number(raw["candle_time"] ?? 0) || 0;
  if (candleTime <= 0) throw new LicenseError(400, "Force-open requires the original candle timestamp.");
  const ageSeconds = Date.now() / 1000 - candleTime;
  if (ageSeconds > 15 * 60) {
    throw new LicenseError(400, "This blocked signal is too old to force-open (over 15 minutes). It may no longer reflect current market conditions.");
  }
  const signalPrice = Number(raw["signal_price"] ?? 0) || 0;
  const score = Number(raw["score"] ?? 0) || 0;
  const symbol = String(raw["symbol"] ?? "").trim().toUpperCase();
  if (symbol.length > 24) throw new LicenseError(400, "Force-open symbol is too long.");
  return {
    direction,
    symbol,
    setup,
    grade,
    original_blocker: originalBlocker,
    candle_time: candleTime,
    signal_price: signalPrice,
    score,
    event_time: String(raw["event_time"] ?? "").trim().slice(0, 40),
    signal_id: String(raw["signal_id"] ?? "").trim(),
  };
}

/** Port of server.py:6021 `_normalize_manual_open_now_payload` -- deliberately near-empty (no candle_time/signal_price/setup/grade) so it can never be rejected for reusing a stale blocked candidate. */
export function normalizeManualOpenNowPayload(payload: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const raw = payload ?? {};
  const direction = String(raw["direction"] ?? "").trim().toUpperCase();
  if (direction !== "BUY" && direction !== "SELL") {
    throw new LicenseError(400, "Manual open requires an explicit BUY or SELL direction.");
  }
  return { direction };
}

/** Port of server.py:6032 `_normalize_force_close_payload`. */
export function normalizeForceClosePayload(payload: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const raw = payload ?? {};
  const ticket = String(raw["ticket"] ?? "").trim();
  if (!ticket || !/^\d+$/.test(ticket)) throw new LicenseError(400, "Force-close requires the exact open MT5 ticket id.");
  const symbol = String(raw["symbol"] ?? "").trim().toUpperCase();
  if (symbol.length > 24) throw new LicenseError(400, "Force-close symbol is too long.");
  const reason = String(raw["reason"] ?? "USER_FORCE_CLOSE_TRADE").trim().slice(0, 120) || "USER_FORCE_CLOSE_TRADE";
  return { ticket, symbol, reason };
}

/** Port of server.py:5948 `_expire_stale_pending_commands`. */
export async function expireStalePendingCommands(now: Date = new Date()): Promise<number> {
  const db = getDb();
  const commands = db.collection("cloud_bot_commands");
  let expiredTotal = 0;
  for (const [action, minutes] of Object.entries(REMOTE_COMMAND_EXPIRY_MINUTES)) {
    const cutoff = new Date(now.getTime() - minutes * 60_000).toISOString();
    const res = await commands.updateMany(
      { status: "PENDING", action, requested_at: { $lt: cutoff } },
      {
        $set: {
          status: "EXPIRED",
          ack_status: "EXPIRED",
          ack_at: now.toISOString(),
          ack_message: `Command expired before EA acknowledgement after ${minutes} minutes.`,
        },
      },
    );
    expiredTotal += res.modifiedCount ?? 0;
  }
  return expiredTotal;
}
