/** Port of market_outlook.py's core pure functions and constants (lines 64-247). */

export const OUTLOOK_SYMBOL = "XAUUSD";
export const OUTLOOK_HORIZON_HOURS = 4;
export const OUTLOOK_EVALUATION_MINUTES = 60;
export const HALF_R_WIN_THRESHOLD = 0.5;
export const MAX_PUBLICATION_QUOTE_AGE_SECONDS = 30;
export const MAX_PUBLICATION_QUOTE_FUTURE_SKEW_SECONDS = 30;
export const MAX_HISTORICAL_ANCHOR_AGE_SECONDS = 90;
export const MAX_HISTORICAL_QUOTE_GAP_SECONDS = 10;
export const ROOM_COLLAPSE_R = 0.3;

export const XAUCLOUD_PIPS_PER_GOLD_MOVE = 10;
export const XAUCLOUD_R_UNIT_GOLD_MOVES = 10.0;
export const XAUCLOUD_TP1_GOLD_MOVES = 5.0;
export const XAUCLOUD_TP2_GOLD_MOVES = 10.0;
export const BREAK_EVEN_R_TOLERANCE = 0.05;

export interface ResultConversion {
  result_r: number | null;
  result_gold_moves: number | null;
  result_pips: number | null;
}

/** Port of market_outlook.py:108 `build_result_conversion` -- THE single authoritative XauCloud result-conversion function. */
export function buildResultConversion(opts: { r?: number | null; price_move?: number | null; risk_distance?: number | null }): ResultConversion {
  let { r = null, price_move: priceMove = null } = opts;
  const riskDistance = opts.risk_distance;
  if (priceMove === null && r !== null && riskDistance) priceMove = r * riskDistance;
  if (r === null && priceMove !== null && riskDistance) r = priceMove / riskDistance;
  const goldMoves = priceMove !== null ? Math.round(priceMove * 100) / 100 : null;
  const pips = priceMove !== null ? Math.round(priceMove * XAUCLOUD_PIPS_PER_GOLD_MOVE * 10) / 10 : null;
  return {
    result_r: r !== null ? Math.round(r * 100) / 100 : null,
    result_gold_moves: goldMoves,
    result_pips: pips,
  };
}

export const PRIMARY_DIRECTIONS = ["BUY", "SELL", "NEUTRAL", "RANGE", "TRANSITION", "NO_VALID_OUTLOOK", "BLOCKED"] as const;
export const EXPECTED_PATHS = ["PULLBACK_FIRST_THEN_BUY", "RALLY_FIRST_THEN_SELL", "DIRECT_CONTINUATION", "RANGE_ROTATION", "REVERSAL_FORMING", "NO_CLEAR_PATH"] as const;
export const LIFECYCLE_STATES = ["INFORMATIONAL", "TRACKING_AMBER", "WIN_GREEN_0_5R", "WIN_GREEN_TP1", "LOSS_RED_SL", "LOSS_RED_TIMEOUT", "PARTIAL_PROFIT", "BREAK_EVEN"] as const;

export const OWNER_POLICY_VERSION = "2026-08-04-v1";
export const OWNER_POLICY_HARD_BLOCK_CODES = new Set([
  "PERM_BLOCK_ASIA_NON_A_PLUS",
  "PERM_BLOCK_ASIA_GRADE_B",
  "PERM_BLOCK_A_PLUS_RESET_PENDING",
  "PERM_BLOCK_GRADE_B_REVERSAL",
  "PERM_BLOCK_RESET_PENDING_GRADE_B",
  "OWNER_LOCATION_EXCELLENT_BLOCK",
  "OWNER_LOCATION_LATE_BLOCK",
]);
const OWNER_POLICY_BLOCK_EXPLANATIONS: Record<string, string> = {
  PERM_BLOCK_ASIA_NON_A_PLUS: "Asia session — only Grade A+ candidates are allowed by owner policy.",
  PERM_BLOCK_ASIA_GRADE_B: "Asia session, Grade B — blocked by owner policy.",
  PERM_BLOCK_A_PLUS_RESET_PENDING: "Grade A+ candidate at a reset-pending location — blocked by owner policy.",
  PERM_BLOCK_GRADE_B_REVERSAL: "Grade B reversal/opposite-discovery setup — blocked by owner policy.",
  PERM_BLOCK_RESET_PENDING_GRADE_B: "Grade B candidate at a reset-pending location — blocked by owner policy.",
  OWNER_LOCATION_EXCELLENT_BLOCK: "Location classified Excellent — an absolute owner-policy execution block.",
  OWNER_LOCATION_LATE_BLOCK: "Location classified Late — an absolute owner-policy execution block.",
};

/** Port of market_outlook.py:175 `evaluate_owner_policy` -- the one shared owner-policy check. */
export function evaluateOwnerPolicy(canonicalM10: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const code = String(canonicalM10?.["blocker_code"] ?? "").trim().toUpperCase();
  const blocked = OWNER_POLICY_HARD_BLOCK_CODES.has(code);
  return {
    allowed: !blocked,
    blocker_code: blocked ? code : null,
    blocker_explanation: blocked ? (OWNER_POLICY_BLOCK_EXPLANATIONS[code] ?? null) : null,
    policy_version: OWNER_POLICY_VERSION,
    evaluated_at: new Date().toISOString(),
    session: canonicalM10?.["session"] ?? null,
    grade: canonicalM10?.["grade"] ?? null,
  };
}

export const FINAL_RESULTS = ["WIN_GREEN_0_5R", "WIN_GREEN_TP1", "LOSS_RED_SL", "LOSS_RED_TIMEOUT", "PARTIAL_PROFIT", "BREAK_EVEN", "HISTORICAL_DATA_UNAVAILABLE"] as const;
export const NOTIFICATION_TIERS = ["OFF", "HOURLY_ONLY", "HOURLY_PLUS_RESULTS", "ALL_UPDATES"] as const;
export const MILESTONES = ["TRACKING_STARTED", "HALF_R_REACHED", "TP1_HIT", "TP2_HIT", "TP3_HIT", "SL_HIT", "TIMEOUT_60M"] as const;

export const SIGNAL_INFORMATIONAL = "INFORMATIONAL";
export const SIGNAL_TRACKING = "TRACKING_AMBER";
export const SIGNAL_WIN_HALF_R = "WIN_GREEN_0_5R";
export const SIGNAL_WIN_TP1 = "WIN_GREEN_TP1";
export const SIGNAL_LOSS_SL = "LOSS_RED_SL";
export const SIGNAL_LOSS_TIMEOUT = "LOSS_RED_TIMEOUT";
export const SIGNAL_PARTIAL_PROFIT = "PARTIAL_PROFIT";
export const SIGNAL_BREAK_EVEN = "BREAK_EVEN";
export const TIMEOUT_TERMINAL_STATES = new Set([SIGNAL_LOSS_TIMEOUT, SIGNAL_PARTIAL_PROFIT, SIGNAL_BREAK_EVEN]);
export const ANALYTICS_WIN = "WIN";
export const ANALYTICS_LOSS = "LOSS";
export const ANALYTICS_PARTIAL = "PARTIAL_PROFIT";
export const ANALYTICS_BREAKEVEN = "BREAK_EVEN";
export const ANALYTICS_UNAVAILABLE = "HISTORICAL_DATA_UNAVAILABLE";
export const ANALYTICS_TERMINAL_OUTCOMES = new Set([ANALYTICS_WIN, ANALYTICS_LOSS, ANALYTICS_PARTIAL, ANALYTICS_BREAKEVEN]);

export const OUTLOOK_ACTIONABLE = "ACTIONABLE_SIGNAL";
export const OUTLOOK_WATCHING = "WATCHING";
export const OUTLOOK_NO_SIGNAL = "NO_SIGNAL";
export const OUTLOOK_DATA_UNAVAILABLE = "DATA_UNAVAILABLE";
export const OUTLOOK_BLOCKED = "BLOCKED";
export const OUTLOOK_EXPIRED = "EXPIRED";

export const EXECUTION_READY_DECISIONS = new Set(["ALLOW", "ALLOW_CORE", "ALLOWED", "READY", "EXECUTION_READY", "EXECUTED", "FILLED", "BROKER_CONFIRMED"]);
export const BLOCKED_DECISIONS = new Set(["BLOCKED", "REJECTED", "DENIED", "ERROR"]);
export const EXPIRED_DECISIONS = new Set(["EXPIRED", "CANCELLED", "CANCELED", "TIMED_OUT", "TIMEOUT"]);
