import { z } from "zod";

/** Port of server.py:6717 `class BotActivityReq(BaseModel)`. */
export const BotActivityReqSchema = z.object({
  pin: z.string().optional().default(""),
  license_key: z.string().optional().default(""),
  event_type: z.string().optional().default("INFO"),
  severity: z.string().optional().default("INFO"),
  account: z.string().optional().default(""),
  symbol: z.string().optional().default(""),
  message: z.string().optional().default(""),
  details: z.record(z.string(), z.unknown()).nullable().optional(),
  timeframe: z.string().optional().default(""),
  mode: z.string().optional().default(""),
  market_bias: z.string().optional().default(""),
  signal_direction: z.string().optional().default(""),
  ai_confidence: z.number().nullable().optional(),
  score: z.number().nullable().optional(),
  trade_allowed: z.boolean().nullable().optional(),
  allowed: z.boolean().nullable().optional(),
  decision: z.string().optional().default(""),
  reason: z.string().optional().default(""),
  blocked_by: z.string().optional().default(""),
  current_trade_status: z.string().optional().default(""),
  exit_decision: z.string().optional().default(""),
  risk_lot_decision: z.string().optional().default(""),
  module: z.string().optional().default(""),
  ticket: z.string().optional().default(""),
  profit: z.number().nullable().optional(),
  price: z.number().nullable().optional(),
  close_reason_exact: z.string().optional().default(""),
  closed_by_module: z.string().optional().default(""),
  was_broker_sl: z.boolean().nullable().optional(),
  was_manual: z.boolean().nullable().optional(),
  was_emergency_margin: z.boolean().nullable().optional(),
  was_ea_forced_close: z.boolean().nullable().optional(),
  position_direction: z.string().optional().default(""),
  candidate_allowed: z.boolean().nullable().optional(),
  final_execution_allowed: z.boolean().nullable().optional(),
  final_decision: z.string().optional().default(""),
  final_blocker: z.string().optional().default(""),
  open_trade_called: z.boolean().nullable().optional(),
  trade_buy_called: z.boolean().nullable().optional(),
  trade_sell_called: z.boolean().nullable().optional(),
  broker_retcode: z.number().nullable().optional(),
  broker_error: z.number().nullable().optional(),
  pipeline_stage: z.string().optional().default(""),
  market_thesis: z.record(z.string(), z.unknown()).nullable().optional(),
  post_trade_state: z.record(z.string(), z.unknown()).nullable().optional(),
  entry_readiness: z.record(z.string(), z.unknown()).nullable().optional(),
  m10_signal: z.record(z.string(), z.unknown()).nullable().optional(),
  m30_consensus: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type BotActivityReq = z.infer<typeof BotActivityReqSchema>;

/** Fields copied into `details` verbatim when present -- port of server.py:7348's field tuple. */
export const ACTIVITY_DETAIL_FIELDS = [
  "timeframe", "mode", "market_bias", "signal_direction", "ai_confidence",
  "score", "trade_allowed", "allowed", "decision", "reason", "blocked_by",
  "current_trade_status", "exit_decision", "risk_lot_decision", "module",
  "ticket", "profit", "price", "close_reason_exact", "closed_by_module",
  "was_broker_sl", "was_manual", "was_emergency_margin", "was_ea_forced_close",
  "position_direction", "candidate_allowed", "final_execution_allowed",
  "final_decision", "final_blocker", "open_trade_called", "trade_buy_called",
  "trade_sell_called", "broker_retcode", "broker_error", "pipeline_stage",
  "market_thesis", "post_trade_state", "entry_readiness", "m10_signal",
  "m30_consensus",
] as const;

/** Port of server.py:7482 `class DirectionReservationClaimReq(BaseModel)`. */
export const DirectionReservationClaimReqSchema = z.object({
  pin: z.string().optional().default(""),
  license_key: z.string().optional().default(""),
  broker_server: z.string().optional().default(""),
  account: z.string().optional().default(""),
  symbol: z.string().optional().default(""),
  direction: z.number().optional().default(0),
  requesting_family: z.string().optional().default(""),
  execution_key: z.string().optional().default(""),
  terminal_identity: z.string().optional().default(""),
  ttl_seconds: z.number().optional().default(30),
});

/** Port of server.py `class DirectionReservationReleaseReq(BaseModel)`. */
export const DirectionReservationReleaseReqSchema = z.object({
  pin: z.string().optional().default(""),
  license_key: z.string().optional().default(""),
  broker_server: z.string().optional().default(""),
  account: z.string().optional().default(""),
  symbol: z.string().optional().default(""),
  reservation_id: z.string().optional().default(""),
});
